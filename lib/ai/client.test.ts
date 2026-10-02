import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError, generateStructured } from "./client";

const API_KEY = "sk-ant-test-SECRET-KEY";
const BRIEFING = "Briefing confidencial do cliente Fictício";
const SYSTEM = "Prompt de sistema interno";

const call = () =>
  generateStructured({
    model: "claude-test",
    system: SYSTEM,
    user: BRIEFING,
    wire: z.object({ ok: z.boolean() }),
    strict: z.object({ ok: z.boolean() }),
  });

const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

describe("provider failure logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER_API_KEY", API_KEY);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs only status, error type, message and request id on a non-success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "model: not found" },
            request_id: "req_body_1",
            echoed: BRIEFING,
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "request-id": "req_header_1",
              "set-cookie": "session=SECRET-COOKIE",
              "x-supabase-key": "SECRET-SUPABASE",
            },
          },
        ),
      ),
    );

    await expect(call()).rejects.toMatchObject(new AiError("AI_ERROR"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toEqual({
      event: "anthropic_request_failed",
      status: 400,
      error_type: "invalid_request_error",
      error_message: "model: not found",
      request_id: "req_header_1",
    });
    const output = logged(errorSpy);
    for (const secret of [API_KEY, BRIEFING, SYSTEM, "SECRET-COOKIE", "SECRET-SUPABASE", "Authorization", "x-api-key"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("logs only the error name and message when the request throws before a response", async () => {
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
      error_message: "Connection error.",
    });
    expect(logged(errorSpy)).not.toContain(API_KEY);
  });
});
