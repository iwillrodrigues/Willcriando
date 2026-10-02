import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError, generateStructured, providerFailureLog } from "./client";

const API_KEY = "sk-ant-test-SECRET-KEY";
const BRIEFING = "Briefing confidencial do cliente Fictício";
const SYSTEM = "Prompt de sistema interno";
const SCHEMA_VALUE = "campo_secreto_do_schema";
const MODEL = "claude-modelo-privado";
const COOKIE = "session=SECRET-COOKIE";
const SUPABASE = "SECRET-SUPABASE";

/** Everything that must never reach a log line. */
const FORBIDDEN = [API_KEY, BRIEFING, SYSTEM, SCHEMA_VALUE, MODEL, "SECRET-COOKIE", SUPABASE, "Authorization", "x-api-key", "set-cookie"];

const call = () =>
  generateStructured({
    model: MODEL,
    system: SYSTEM,
    user: BRIEFING,
    wire: z.object({ [SCHEMA_VALUE]: z.boolean() }),
    strict: z.object({ [SCHEMA_VALUE]: z.boolean() }),
  });

const headers = (extra: Record<string, string> = {}) =>
  new Headers({ "request-id": "req_header_1", "set-cookie": COOKIE, "x-supabase-key": SUPABASE, ...extra });

const statusError = (status: number, message: string, extraHeaders?: Record<string, string>) =>
  Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: "invalid_request_error", message }, request_id: "req_body_1", echoed: BRIEFING },
    undefined,
    headers(extraHeaders),
  );

const expectClean = (text: string, extra: string[] = []) => {
  for (const value of [...FORBIDDEN, ...extra]) expect(text).not.toContain(value);
};

describe("provider failure logging through generateStructured", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const logged = () => errorSpy.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");

  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER_API_KEY", API_KEY);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs status, type, category and request id, never the provider message or body", async () => {
    const providerMessage = `model: ${MODEL} rejected "${BRIEFING}" in ${SCHEMA_VALUE}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "error",
              error: { type: "not_found_error", message: providerMessage },
              request_id: "req_body_1",
              echoed: BRIEFING,
            }),
            {
              status: 404,
              headers: { "content-type": "application/json", "request-id": "req_header_1", "set-cookie": COOKIE, "x-supabase-key": SUPABASE },
            },
          ),
      ),
    );

    await expect(call()).rejects.toMatchObject(new AiError("AI_ERROR"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toEqual({
      event: "anthropic_request_failed",
      status: 404,
      error_type: "not_found_error",
      error_category: "model_not_found",
      request_id: "req_header_1",
    });
    expectClean(logged(), [providerMessage, "rejected", "echoed"]);
  });

  it("logs only a fixed name and category when the request throws before a response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`fetch failed for ${API_KEY}`);
      }),
    );

    await expect(call()).rejects.toMatchObject(new AiError("AI_UNAVAILABLE"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toEqual({
      event: "anthropic_request_threw",
      error_name: "APIConnectionError",
      error_category: "connection",
    });
    expectClean(logged(), ["Connection error", "fetch failed"]);
  });
});

describe("providerFailureLog", () => {
  it.each([
    { message: "invalid x-api-key", status: 401, category: "authentication" },
    { message: "Your API key does not have permission to use the specified resource.", status: 403, category: "permission" },
    { message: "Your credit balance is too low to access the Anthropic API.", status: 400, category: "billing" },
    { message: "This request would exceed your organization's rate limit of 50 requests per minute.", status: 429, category: "rate_limit" },
    { message: "Overloaded", status: 529, category: "overloaded" },
    { message: `model: ${MODEL}`, status: 404, category: "model_not_found" },
    { message: "prompt is too long: 250000 tokens > 200000 maximum", status: 400, category: "token_limit" },
    { message: `output_config.format.schema: property '${SCHEMA_VALUE}' is not supported`, status: 400, category: "structured_output" },
    { message: `fallbacks: Extra inputs are not permitted ("${BRIEFING}")`, status: 400, category: "invalid_parameter" },
    { message: `Something new happened with ${BRIEFING}`, status: 400, category: "unknown" },
  ])("categorises a $category message without logging its text", ({ message, status, category }) => {
    const fields = providerFailureLog(statusError(status, message));
    expect(fields).toMatchObject({ event: "anthropic_request_failed", status, error_category: category });
    expect(Object.keys(fields!).sort()).toEqual(["error_category", "error_type", "event", "request_id", "status"]);
    expectClean(JSON.stringify(fields), [message]);
  });

  it("drops a type or request id that is not token-shaped", () => {
    const error = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: `bad type ${BRIEFING}`, message: "x" }, request_id: `req ${BRIEFING}` },
      undefined,
      new Headers({ "request-id": `${API_KEY} ${BRIEFING}` }),
    );
    const fields = providerFailureLog(error);
    expect(fields).toMatchObject({ error_type: null, request_id: null });
    expectClean(JSON.stringify(fields));
  });

  it("logs nothing derived from a non-JSON body", () => {
    const error = Anthropic.APIError.generate(502, undefined, `<html>${BRIEFING} ${API_KEY}</html>`, headers());
    const fields = providerFailureLog(error);
    expect(fields).toEqual({
      event: "anthropic_request_failed",
      status: 502,
      error_type: null,
      error_category: "unknown",
      request_id: "req_header_1",
    });
    expectClean(JSON.stringify(fields), ["<html>"]);
  });

  it.each([
    { error: new Anthropic.APIConnectionTimeoutError(), name: "APIConnectionTimeoutError", category: "timeout" },
    { error: new Anthropic.APIConnectionError({ message: `Connection error ${API_KEY}` }), name: "APIConnectionError", category: "connection" },
    { error: new Anthropic.APIUserAbortError({ message: `aborted ${BRIEFING}` }), name: "APIUserAbortError", category: "aborted" },
  ])("maps a statusless $name to a fixed name and category", ({ error, name, category }) => {
    const fields = providerFailureLog(error);
    expect(fields).toEqual({ event: "anthropic_request_threw", error_name: name, error_category: category });
    expectClean(JSON.stringify(fields), [error.message]);
  });

  it("never logs the message of a statusless generic APIError carrying a whole response body", () => {
    // Same construction as the SDK's streaming error path: the message
    // becomes the JSON of the complete body.
    const body = {
      type: "error",
      error: { type: "invalid_request_error", message: `model: ${MODEL} saw "${BRIEFING}"` },
      request_id: "req_stream_1",
      echoed: { system: SYSTEM, schema: SCHEMA_VALUE, key: API_KEY, cookie: COOKIE, supabase: SUPABASE },
    };
    const error = new Anthropic.APIError(undefined, body, undefined, headers(), "invalid_request_error");
    expect(error.message).toContain(BRIEFING); // the hazard is real

    const fields = providerFailureLog(error);
    expect(fields).toEqual({ event: "anthropic_request_threw", error_name: "APIError", error_category: "unknown" });
    const text = JSON.stringify(fields);
    expectClean(text, [error.message, JSON.stringify(body), "req_stream_1", "invalid_request_error", "echoed"]);
  });

  it("ignores errors that are not provider API errors", () => {
    expect(providerFailureLog(new SyntaxError(`Unexpected token in "${BRIEFING}"`))).toBeNull();
  });
});
