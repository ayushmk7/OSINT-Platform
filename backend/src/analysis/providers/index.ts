import { AnthropicProvider } from './anthropic';
import { OpenAiCompatibleProvider } from './openai';
import type { FetchLike, LlmProvider } from './types';

export type { LlmProvider, CompletionRequest } from './types';
export { AnthropicProvider } from './anthropic';
export { OpenAiCompatibleProvider } from './openai';

export type ProviderSelection =
  { provider: LlmProvider; reason?: undefined } | { provider: null; reason: string };

/**
 * Picks the LLM backend from the environment:
 *
 * - `MKOSINT_LLM_PROVIDER` = `anthropic` (default) | `openai`
 * - anthropic: `ANTHROPIC_API_KEY` (required), `MKOSINT_ANTHROPIC_BASE_URL`
 * - openai: `OPENAI_API_KEY`, `MKOSINT_OPENAI_BASE_URL` (a base URL alone is enough for keyless
 *   local servers such as Ollama), `MKOSINT_OPENAI_RESPONSE_FORMAT` = json_schema | json_object
 * - `MKOSINT_LLM_MODEL` overrides the model for either; `MKOSINT_LLM_TIMEOUT_MS` the timeout.
 *
 * Returns `provider: null` with a human-readable reason when not configured.
 */
export function createProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike
): ProviderSelection {
  const kind = (env.MKOSINT_LLM_PROVIDER || 'anthropic').trim().toLowerCase();
  const model = env.MKOSINT_LLM_MODEL?.trim() || undefined;
  const timeoutMs =
    Number(env.MKOSINT_LLM_TIMEOUT_MS) > 0 ? Number(env.MKOSINT_LLM_TIMEOUT_MS) : undefined;

  if (kind === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) return { provider: null, reason: 'ANTHROPIC_API_KEY is not set' };
    return {
      provider: new AnthropicProvider({
        apiKey,
        model,
        baseUrl: env.MKOSINT_ANTHROPIC_BASE_URL?.trim() || undefined,
        timeoutMs,
        fetchImpl
      })
    };
  }
  if (kind === 'openai' || kind === 'openai-compatible' || kind === 'ollama') {
    const apiKey = env.OPENAI_API_KEY?.trim() || undefined;
    const baseUrl = env.MKOSINT_OPENAI_BASE_URL?.trim() || undefined;
    if (!apiKey && !baseUrl) {
      return {
        provider: null,
        reason: 'neither OPENAI_API_KEY nor MKOSINT_OPENAI_BASE_URL is set'
      };
    }
    const fmt = env.MKOSINT_OPENAI_RESPONSE_FORMAT?.trim();
    return {
      provider: new OpenAiCompatibleProvider({
        apiKey,
        baseUrl,
        model,
        responseFormat: fmt === 'json_object' ? 'json_object' : 'json_schema',
        timeoutMs,
        fetchImpl
      })
    };
  }
  return { provider: null, reason: `unknown MKOSINT_LLM_PROVIDER "${kind}"` };
}
