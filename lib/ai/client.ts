import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

import { getAiEnv } from "@/lib/env/server";
import { MissingEnvError } from "@/lib/env/schema";

/**
 * The only module that talks to the AI provider (Anthropic Messages API).
 *
 * Output is constrained with a structured-output schema, then validated
 * again by the caller's strict schema. Errors become short codes that are
 * safe to store and show; provider messages are never passed through.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_AUTH"
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "AI_UNAVAILABLE"
  | "AI_REFUSAL"
  | "AI_TRUNCATED"
  | "AI_INVALID_OUTPUT"
  | "AI_ERROR";

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode) {
    super(code);
    this.name = "AiError";
    this.code = code;
  }
}

/** Throws AI_NOT_CONFIGURED before any request is recorded. */
export function aiModel(): string {
  try {
    const env = getAiEnv();
    return env.AI_MODEL ?? DEFAULT_MODEL;
  } catch (error) {
    if (error instanceof MissingEnvError) throw new AiError("AI_NOT_CONFIGURED");
    throw error;
  }
}

function client(): Anthropic {
  try {
    const { AI_PROVIDER_API_KEY } = getAiEnv();
    return new Anthropic({ apiKey: AI_PROVIDER_API_KEY, timeout: 170_000, maxRetries: 1 });
  } catch (error) {
    if (error instanceof MissingEnvError) throw new AiError("AI_NOT_CONFIGURED");
    throw error;
  }
}

export type StructuredResult<T> = { value: T; servedModel: string };

/**
 * One structured call. `wire` constrains the response format; `strict`
 * validates it for the product. The large, stable `system` text is cached.
 */
export async function generateStructured<W extends z.ZodType, S extends z.ZodType>(input: {
  model: string;
  system: string;
  user: string;
  wire: W;
  strict: S;
}): Promise<StructuredResult<z.infer<S>>> {
  let response;
  try {
    response = await client().beta.messages.parse({
      model: input.model,
      max_tokens: 16000,
      // Server-side refusal fallback: if the model declines for policy
      // reasons, the API retries on its default fallback model. The model
      // that answered is recorded as served_model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(input.wire) },
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.user }],
    });
  } catch (error) {
    logProviderFailure(error);
    throw new AiError(mapProviderError(error));
  }

  if (response.stop_reason === "refusal") throw new AiError("AI_REFUSAL");
  if (response.stop_reason === "max_tokens") throw new AiError("AI_TRUNCATED");
  if (response.parsed_output == null) throw new AiError("AI_INVALID_OUTPUT");

  const checked = input.strict.safeParse(response.parsed_output);
  if (!checked.success) throw new AiError("AI_INVALID_OUTPUT");
  return { value: checked.data, servedModel: response.model };
}

/** Accept only token-like provider values, so free text can never ride along. */
function token(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

const ERROR_TYPE = /^[a-z_]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Fixed categories matched against the provider message, in order. Only the
 * category name is logged, never the message or what matched in it.
 */
const MESSAGE_CATEGORIES: [string, RegExp][] = [
  // Permission first: its messages often mention the API key too.
  ["permission", /permission|forbidden|not allowed|access denied|does not have access/i],
  ["authentication", /api[ -]?key|authenticat|unauthori[sz]ed|credential/i],
  ["billing", /credit balance|billing|payment|purchase credits/i],
  ["rate_limit", /rate[ _-]?limit|too many requests/i],
  ["overloaded", /overloaded/i],
  ["model_not_found", /^model:|\bmodel\b.*\b(not found|does not exist|not available)\b/i],
  ["token_limit", /prompt is too long|max_tokens|context (window|length)|too many tokens|token limit/i],
  ["structured_output", /output_config\.format|output_format|json schema|structured output|\bschema\b/i],
  ["invalid_parameter", /invalid|unexpected|not supported|unsupported|extra inputs|field required|unknown (parameter|field)|beta/i],
];

function messageCategory(message: unknown): string {
  if (typeof message !== "string") return "unknown";
  const text = message.slice(0, 2000);
  return MESSAGE_CATEGORIES.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}

/**
 * Safe diagnostic fields for a failed provider call, or null when there is
 * nothing to log. No provider or SDK message, body, header, prompt or
 * briefing is ever included, nor any substring of them: only the status,
 * token-shaped type and request id, and an application-owned category.
 * Errors the SDK raises after a response arrives (output parsing) are left
 * out, because their messages can quote the model's output.
 */
export function providerFailureLog(error: unknown): Record<string, string | number | null> | null {
  if (!(error instanceof Anthropic.APIError)) return null;

  if (error.status === undefined) {
    // Thrown before any response (network, timeout, abort), or a statusless
    // APIError whose message can hold a whole response body. Explicit names,
    // because bundling can minify class names.
    const [name, category] =
      error instanceof Anthropic.APIConnectionTimeoutError
        ? ["APIConnectionTimeoutError", "timeout"]
        : error instanceof Anthropic.APIConnectionError
          ? ["APIConnectionError", "connection"]
          : error instanceof Anthropic.APIUserAbortError
            ? ["APIUserAbortError", "aborted"]
            : ["APIError", "unknown"];
    return { event: "anthropic_request_threw", error_name: name, error_category: category };
  }

  // Body shape: { type: "error", error: { type, message }, request_id }.
  const body = (error.error ?? null) as { error?: { type?: unknown; message?: unknown }; request_id?: unknown } | null;
  return {
    event: "anthropic_request_failed",
    status: error.status,
    error_type: token(error.type, ERROR_TYPE) ?? token(body?.error?.type, ERROR_TYPE),
    error_category: messageCategory(body?.error?.message),
    request_id: token(error.requestID, REQUEST_ID) ?? token(body?.request_id, REQUEST_ID),
  };
}

function logProviderFailure(error: unknown): void {
  const fields = providerFailureLog(error);
  if (fields) console.error(JSON.stringify(fields));
}

function mapProviderError(error: unknown): AiErrorCode {
  if (error instanceof AiError) return error.code;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "AI_AUTH";
  if (error instanceof Anthropic.RateLimitError) return "AI_RATE_LIMIT";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "AI_TIMEOUT";
  if (error instanceof Anthropic.APIConnectionError) return "AI_UNAVAILABLE";
  if (error instanceof Anthropic.InternalServerError) return "AI_UNAVAILABLE";
  if (error instanceof Anthropic.APIError) return "AI_ERROR";
  // The SDK's parse helper throws a plain error when the JSON does not match.
  return "AI_INVALID_OUTPUT";
}
