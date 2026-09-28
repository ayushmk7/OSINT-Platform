import {
  parseModelJson,
  ProviderError,
  readJson,
  type CompletionRequest,
  type FetchLike,
  type LlmProvider
} from './types';

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiOptions {
  /** Optional: local servers (Ollama, LM Studio, llama.cpp) usually need none. */
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /**
   * `json_schema` (default): strict structured outputs. `json_object`: plain JSON mode for
   * servers that do not implement schemas — the schema is then described in the system prompt
   * and enforced only by our own validator.
   */
  responseFormat?: 'json_schema' | 'json_object';
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * Any OpenAI-compatible `POST {base}/chat/completions` endpoint: OpenAI itself, or Ollama
 * (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), vLLM, llama.cpp...
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAiOptions = {}) {
    this.model = options.model || OPENAI_DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  buildRequest(req: CompletionRequest): { url: string; init: RequestInit } {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;

    const jsonObject = this.options.responseFormat === 'json_object';
    const system = jsonObject
      ? `${req.system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(req.schema)}`
      : req.system;
    return {
      url: `${this.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 8000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: req.user }
          ],
          response_format: jsonObject
            ? { type: 'json_object' }
            : {
                type: 'json_schema',
                json_schema: { name: req.schemaName, strict: true, schema: req.schema }
              }
        })
      }
    };
  }

  async complete(req: CompletionRequest): Promise<unknown> {
    const { url, init } = this.buildRequest(req);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000)
    });
    const body = await readJson(res, this.name);
    const choices = Array.isArray(body.choices) ? (body.choices as Record<string, unknown>[]) : [];
    const choice = choices[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    if (typeof message.refusal === 'string' && message.refusal) {
      throw new ProviderError(`openai declined the request: ${message.refusal.slice(0, 200)}`);
    }
    if (choice?.finish_reason === 'length') throw new ProviderError('openai output hit max_tokens');
    if (typeof message.content !== 'string' || !message.content) {
      throw new ProviderError('openai response has no message content');
    }
    return parseModelJson(message.content, this.name);
  }
}
