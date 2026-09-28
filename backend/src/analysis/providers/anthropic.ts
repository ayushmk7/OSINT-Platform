import {
  parseModelJson,
  ProviderError,
  readJson,
  type CompletionRequest,
  type FetchLike,
  type LlmProvider
} from './types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * Claude via the Messages API (`POST /v1/messages`), called with plain fetch. Structured output
 * uses `output_config.format` with a JSON schema, so the reply's text block is guaranteed to be
 * JSON matching the schema — no tool-use round trip and no prefill.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model || ANTHROPIC_DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  buildRequest(req: CompletionRequest): { url: string; init: RequestInit } {
    return {
      url: `${this.baseUrl}/v1/messages`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 8000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: { type: 'json_schema', schema: req.schema } }
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

    const stop = body.stop_reason;
    if (stop === 'refusal') throw new ProviderError('anthropic declined the request (refusal)');
    if (stop === 'max_tokens') throw new ProviderError('anthropic output hit max_tokens');

    const content = Array.isArray(body.content) ? (body.content as Record<string, unknown>[]) : [];
    const text = content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    if (!text) throw new ProviderError('anthropic response has no text block');
    return parseModelJson(text, this.name);
  }
}
