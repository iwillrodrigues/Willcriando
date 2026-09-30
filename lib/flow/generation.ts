import "server-only";

import { AiError, aiModel, generateStructured, type AiErrorCode } from "@/lib/ai/client";
import {
  analysisPrompt,
  conceptsPrompt,
  presentationPrompt,
  PROMPT_VERSIONS,
  type AnalysisForPrompt,
} from "@/lib/ai/prompts";
import {
  analysisStrictSchema,
  analysisWireSchema,
  conceptsStrictSchema,
  conceptsWireSchema,
  presentationStrictSchema,
  presentationWireSchema,
  toPresentationContent,
} from "@/lib/ai/schemas";
import { MissingEnvError } from "@/lib/env/schema";
import { getCurrentCatalog, type CatalogPath } from "@/lib/flow/queries";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * AI generation lifecycle: begin (idempotent) → call the model → complete or
 * fail. The database decides whether a request is new; only the caller that
 * created the request calls the model, so a double submit never pays twice or
 * stores twice.
 *
 * `userId` must come from requireUser(). The service-role functions re-check
 * that this user owns every record involved.
 */

export type GenerationKind = "analysis" | "concepts" | "presentation";

export type GenerationOutcome =
  | { status: "succeeded"; reused: boolean }
  | { status: "pending" }
  | { status: "failed"; code: string; requestId: string | null };

type Begin = {
  request_id: string;
  status: "pending" | "succeeded" | "failed";
  created: boolean;
  payload: {
    briefing_revision_id: string;
    selection_id: string | null;
    catalog_snapshot_id: string | null;
    finalist_ids: string[] | null;
  };
};

class DbError extends Error {
  readonly code: string;
  constructor(message: string | undefined) {
    const key = (message ?? "").trim();
    const code = /^TRILHA_[A-Z_]+$/.test(key) ? key : "DB_ERROR";
    super(code);
    this.code = code;
  }
}

export async function runGeneration(input: {
  userId: string;
  jobId: string;
  kind: GenerationKind;
  selectionId?: string | null;
  retryOf?: string | null;
}): Promise<GenerationOutcome> {
  let model: string;
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    model = aiModel();
    admin = createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof AiError) return { status: "failed", code: error.code, requestId: null };
    if (error instanceof MissingEnvError) return { status: "failed", code: "SERVER_NOT_CONFIGURED", requestId: null };
    throw error;
  }

  const { data, error } = await admin
    .rpc("begin_generation", {
      p_user_id: input.userId,
      p_job_id: input.jobId,
      p_kind: input.kind,
      p_model: model,
      p_prompt_version: PROMPT_VERSIONS[input.kind],
      p_selection_id: input.selectionId ?? null,
      p_retry_of: input.retryOf ?? null,
    })
    .single<Begin>();
  if (error || !data) return { status: "failed", code: new DbError(error?.message).code, requestId: null };

  if (!data.created) {
    if (data.status === "succeeded") return { status: "succeeded", reused: true };
    if (data.status === "pending") return { status: "pending" };
    return { status: "failed", code: "PREVIOUS_ATTEMPT_FAILED", requestId: data.request_id };
  }

  try {
    if (input.kind === "analysis") await runAnalysis(admin, input.userId, input.jobId, data, model);
    else if (input.kind === "concepts") await runConcepts(admin, input.userId, input.jobId, data, model);
    else await runPresentation(admin, input.userId, input.jobId, data, model);
    return { status: "succeeded", reused: false };
  } catch (err) {
    const code: string = err instanceof AiError ? err.code : err instanceof DbError ? err.code : "INTERNAL_ERROR";
    await admin.rpc("fail_generation", { p_user_id: input.userId, p_request_id: data.request_id, p_error_code: code });
    return { status: "failed", code, requestId: data.request_id };
  }
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Briefing text of a revision, read with the user's session (RLS). */
async function readBriefing(jobId: string, revisionId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("briefing_revisions")
    .select("content")
    .eq("id", revisionId)
    .eq("job_id", jobId)
    .single();
  if (error || !data) throw new DbError("TRILHA_NO_BRIEFING");
  return data.content;
}

async function runAnalysis(admin: Admin, userId: string, jobId: string, begin: Begin, model: string) {
  const briefing = await readBriefing(jobId, begin.payload.briefing_revision_id);
  const catalog = await getCurrentCatalog();
  if (!catalog || catalog.snapshotId !== begin.payload.catalog_snapshot_id) throw new DbError("TRILHA_CATALOG_CHANGED");

  const prompt = analysisPrompt(briefing, catalog.paths);
  const result = await generateStructured({
    model,
    system: prompt.system,
    user: prompt.user,
    wire: analysisWireSchema,
    strict: analysisStrictSchema(new Set(catalog.paths.map((p) => p.path_number))),
  });
  const { recommendations, ...output } = result.value;
  const { error } = await admin.rpc("complete_analysis", {
    p_user_id: userId,
    p_request_id: begin.request_id,
    p_served_model: result.servedModel,
    p_output: output,
    p_recommendations: recommendations,
  });
  if (error) throw new DbError(error.message);
}

async function runConcepts(admin: Admin, userId: string, jobId: string, begin: Begin, model: string) {
  const supabase = await createSupabaseServerClient();
  const { data: sel, error } = await supabase
    .from("path_selections")
    .select("id, creative_paths (id, path_number, title, section, content, prompt_text)")
    .eq("id", begin.payload.selection_id ?? "")
    .eq("job_id", jobId)
    .single();
  if (error || !sel) throw new DbError("TRILHA_SELECTION_NOT_ACTIVE");
  const path = sel.creative_paths as unknown as CatalogPath;

  const briefing = await readBriefing(jobId, begin.payload.briefing_revision_id);

  const { data: analysisRow } = await supabase
    .from("briefing_analyses")
    .select("output")
    .eq("job_id", jobId)
    .eq("briefing_revision_id", begin.payload.briefing_revision_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prompt = conceptsPrompt({
    briefing,
    path,
    analysis: (analysisRow?.output as AnalysisForPrompt | undefined) ?? null,
  });
  const result = await generateStructured({
    model,
    system: prompt.system,
    user: prompt.user,
    wire: conceptsWireSchema,
    strict: conceptsStrictSchema,
  });
  const { error: completeError } = await admin.rpc("complete_concepts", {
    p_user_id: userId,
    p_request_id: begin.request_id,
    p_served_model: result.servedModel,
    p_concepts: result.value.concepts,
  });
  if (completeError) throw new DbError(completeError.message);
}

async function runPresentation(admin: Admin, userId: string, jobId: string, begin: Begin, model: string) {
  const finalistIds = begin.payload.finalist_ids ?? [];
  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("concepts")
    .select("id, title, line, body, creative_paths (title)")
    .eq("job_id", jobId)
    .in("id", finalistIds);
  if (error || !rows || rows.length !== finalistIds.length) throw new DbError("TRILHA_NO_FINALISTS");
  // Same order as the payload, which is the order the slides are mapped back to.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const finalists = finalistIds.map((id) => byId.get(id)!);

  const { data: analysisRow } = await supabase
    .from("briefing_analyses")
    .select("output")
    .eq("job_id", jobId)
    .eq("briefing_revision_id", begin.payload.briefing_revision_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const summary = (analysisRow?.output as { summary?: string } | undefined)?.summary ?? null;
  const pathTitles = [...new Set(finalists.map((f) => (f.creative_paths as unknown as { title: string }).title))];

  const prompt = presentationPrompt({
    briefingSummary: summary,
    pathTitle: pathTitles.length === 1 ? pathTitles[0] : null,
    finalists: finalists.map((f) => ({ title: f.title, line: f.line, body: f.body })),
  });
  const result = await generateStructured({
    model,
    system: prompt.system,
    user: prompt.user,
    wire: presentationWireSchema,
    strict: presentationStrictSchema(finalists.length),
  });
  const { error: completeError } = await admin.rpc("complete_presentation", {
    p_user_id: userId,
    p_request_id: begin.request_id,
    p_served_model: result.servedModel,
    p_content: toPresentationContent(result.value, finalistIds),
  });
  if (completeError) throw new DbError(completeError.message);
}

export type { AiErrorCode };
