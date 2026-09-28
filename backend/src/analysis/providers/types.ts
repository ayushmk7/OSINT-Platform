import type { JsonSchema } from '../json-schema';

export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON Schema the response must follow (strict subset, see json-schema.ts). */
  schema: JsonSchema;
  /** Short identifier for the schema (OpenAI requires a name). */
  schemaName: string;
  maxTokens?: number;
}

/** One LLM backend. `complete` resolves to the parsed JSON object the model returned. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<unknown>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Reads a response body as JSON, raising a ProviderError with a short body excerpt on HTTP errors. */
export async function readJson(res: Response, provider: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(`${provider} HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError(`${provider} returned a non-JSON body`);
  }
}

/** Parses the model's text as JSON, tolerating a ```json fence some local models add. */
export function parseModelJson(text: string, provider: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new ProviderError(`${provider} output is not valid JSON`);
  }
}
