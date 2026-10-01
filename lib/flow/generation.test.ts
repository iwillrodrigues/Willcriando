import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Orchestration rules of runGeneration, with the database and the AI mocked:
 * only a newly created request calls the model; failures are recorded with a
 * code so they can be retried; missing configuration records nothing.
 */

const rpc = vi.fn();
const generateStructured = vi.fn();
const aiModel = vi.fn(() => "modelo-teste");

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));

vi.mock("@/lib/ai/client", async () => {
  class AiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { AiError, aiModel: () => aiModel(), generateStructured: (...a: unknown[]) => generateStructured(...a) };
});

// Fictitious catalog with the approved shape: 9 and 23 are empty group headers.
const codes = [
  ...[2, 3, 4, 5, 6].map((m) => `1.${m}`),
  ...Array.from({ length: 51 }, (_, i) => String(i + 2)),
  ...[1, 2, 3, 4, 5, 6].map((m) => `9.${m}`),
  ...[1, 2, 3, 4, 5].map((m) => `23.${m}`),
];
const catalogPaths = codes.map((code, i) => ({
  id: `path-${code}`,
  path_number: i + 1,
  editorial_code: code,
  selectable: code !== "9" && code !== "23",
  title: `Caminho fictício ${code}`,
  section: null,
  content: code === "9" || code === "23" ? "" : "texto fictício",
  prompt_text: null,
}));

vi.mock("@/lib/flow/queries", () => ({
  getCurrentCatalog: async () => ({ snapshotId: "snap-1", importedAt: "2026-09-30", paths: catalogPaths }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { content: "Briefing fictício." }, error: null }),
      };
      return chain;
    },
  }),
}));

const { runGeneration } = await import("./generation");
const { AiError } = await import("@/lib/ai/client");

const begin = (over: Partial<Record<string, unknown>> = {}) => ({
  data: {
    request_id: "req-1",
    status: "pending",
    created: true,
    payload: { briefing_revision_id: "rev-1", selection_id: null, catalog_snapshot_id: "snap-1", finalist_ids: null },
    ...over,
  },
  error: null,
});

function rpcReturns(beginResult: ReturnType<typeof begin>) {
  rpc.mockImplementation((name: string) => {
    const result = name === "begin_generation" ? beginResult : { data: "ok", error: null };
    return Object.assign(Promise.resolve(result), { single: async () => result });
  });
}

const input = { userId: "user-a", jobId: "job-a", kind: "analysis" as const };

beforeEach(() => {
  rpc.mockReset();
  generateStructured.mockReset();
  aiModel.mockReset().mockReturnValue("modelo-teste");
});

describe("runGeneration", () => {
  it("records nothing when the AI is not configured", async () => {
    aiModel.mockImplementation(() => {
      throw new AiError("AI_NOT_CONFIGURED");
    });
    await expect(runGeneration(input)).resolves.toEqual({ status: "failed", code: "AI_NOT_CONFIGURED", requestId: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never calls the AI for an existing request", async () => {
    rpcReturns(begin({ created: false, status: "succeeded" }));
    await expect(runGeneration(input)).resolves.toEqual({ status: "succeeded", reused: true });
    rpcReturns(begin({ created: false, status: "pending" }));
    await expect(runGeneration(input)).resolves.toEqual({ status: "pending" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("offers a retry for a previous failure without calling the AI", async () => {
    rpcReturns(begin({ created: false, status: "failed" }));
    await expect(runGeneration(input)).resolves.toEqual({ status: "failed", code: "PREVIOUS_ATTEMPT_FAILED", requestId: "req-1" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("records an AI failure with its code", async () => {
    rpcReturns(begin());
    generateStructured.mockRejectedValue(new AiError("AI_TIMEOUT"));
    await expect(runGeneration(input)).resolves.toEqual({ status: "failed", code: "AI_TIMEOUT", requestId: "req-1" });
    expect(rpc).toHaveBeenCalledWith("fail_generation", { p_user_id: "user-a", p_request_id: "req-1", p_error_code: "AI_TIMEOUT" });
  });

  it("stores validated output with the served model and the authenticated user", async () => {
    rpcReturns(begin());
    generateStructured.mockResolvedValue({
      servedModel: "modelo-servido",
      value: {
        summary: "s",
        challenge: "c",
        audience: "a",
        tension: "t",
        human_truth: "h",
        constraints: [],
        open_questions: [],
        recommendations: [{ path_code: "1.2", reasoning: "r" }],
      },
    });
    await expect(runGeneration(input)).resolves.toEqual({ status: "succeeded", reused: false });

    // Group headers never reach the model or the accepted codes.
    const call = generateStructured.mock.calls[0][0] as {
      system: string;
      strict: { safeParse: (v: unknown) => { success: boolean } };
    };
    expect(call.system).toContain('<caminho codigo="9.3">');
    expect(call.system).toContain('<caminho codigo="1.2">');
    expect(call.system).not.toContain('<caminho codigo="9">');
    expect(call.system).not.toContain('<caminho codigo="23">');
    const output = (code: string) => ({
      summary: "s", challenge: "c", audience: "a", tension: "t", human_truth: "h", constraints: [], open_questions: [],
      recommendations: [{ path_code: "1.2", reasoning: "r" }, { path_code: "9.3", reasoning: "r" }, { path_code: code, reasoning: "r" }],
    });
    expect(call.strict.safeParse(output("23.5")).success).toBe(true);
    expect(call.strict.safeParse(output("9")).success).toBe(false);
    expect(call.strict.safeParse(output("23")).success).toBe(false);
    expect(call.strict.safeParse(output("53")).success).toBe(false);
    expect(call.strict.safeParse(output("9.3")).success).toBe(false);

    // A recommendation is only stored; choosing a path stays a user action.
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["begin_generation", "complete_analysis"]);
    expect(rpc).toHaveBeenCalledWith("begin_generation", expect.objectContaining({ p_user_id: "user-a", p_job_id: "job-a", p_kind: "analysis" }));
    expect(rpc).toHaveBeenCalledWith(
      "complete_analysis",
      expect.objectContaining({ p_user_id: "user-a", p_request_id: "req-1", p_served_model: "modelo-servido" }),
    );
  });
});
