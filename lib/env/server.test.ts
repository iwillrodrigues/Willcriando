import { afterEach, describe, expect, it, vi } from "vitest";

import { MissingEnvError } from "./schema";

const FAKE = "fake-value-for-tests";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server env module", () => {
  it("can be imported with no integration configured", async () => {
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(import("./server")).resolves.toBeDefined();
  });

  it("validates only when a getter is called", async () => {
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    const { getAiEnv } = await import("./server");
    expect(() => getAiEnv()).toThrowError(MissingEnvError);
  });

  it("reads the current process environment on each call", async () => {
    const { getAiEnv } = await import("./server");
    vi.stubEnv("AI_PROVIDER_API_KEY", FAKE);
    expect(getAiEnv()).toEqual({ AI_PROVIDER_API_KEY: FAKE });
  });
});
