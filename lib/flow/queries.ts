import "server-only";

import type { AnalysisOutput, PresentationContent } from "@/lib/ai/schemas";
import { DataAccessError, getOwnJob, type JobDetail } from "@/lib/jobs/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jobIdSchema } from "@/lib/validation";

/**
 * Read model for the creative flow. Every query runs with the user's session,
 * so RLS limits it to the user's own jobs; the job itself is loaded first
 * through getOwnJob, which returns null for missing and foreign ids alike.
 */

export type SelectionOrigin = "recommended" | "manual" | "random";
export type GenerationStatus = "pending" | "succeeded" | "failed";

/**
 * A catalog node. editorial_code is the visible code ("9.3"); path_number is
 * only the internal order. Group headers (selectable false) are shown for
 * orientation but never recommended, drawn or applied.
 */
export type CatalogPath = {
  id: string;
  path_number: number;
  editorial_code: string;
  selectable: boolean;
  title: string;
  section: string | null;
  content: string;
  prompt_text: string | null;
};

export type Catalog = { snapshotId: string; importedAt: string; paths: CatalogPath[] } | null;

const PATH_COLUMNS = "id, path_number, editorial_code, selectable, title, section, content, prompt_text";

export async function getCurrentCatalog(): Promise<Catalog> {
  const supabase = await createSupabaseServerClient();
  const { data: snapshot, error } = await supabase
    .from("catalog_snapshots")
    .select("id, imported_at")
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new DataAccessError();
  if (!snapshot) return null;

  const { data: paths, error: pathsError } = await supabase
    .from("creative_paths")
    .select(PATH_COLUMNS)
    .eq("snapshot_id", snapshot.id)
    .order("path_number");
  if (pathsError) throw new DataAccessError();
  return { snapshotId: snapshot.id, importedAt: snapshot.imported_at, paths: paths as CatalogPath[] };
}

export type RequestSummary = {
  id: string;
  status: GenerationStatus;
  error_code: string | null;
  model: string;
  served_model: string | null;
  prompt_version: string;
  created_at: string;
  completed_at: string | null;
};

export type Recommendation = { id: string; rank: number; reasoning: string; path: CatalogPath };

export type Analysis = {
  id: string;
  briefing_revision_id: string;
  created_at: string;
  output: Omit<AnalysisOutput, "recommendations">;
  recommendations: Recommendation[];
  request: RequestSummary;
};

export type Selection = {
  id: string;
  origin: SelectionOrigin;
  created_at: string;
  briefing_revision_id: string;
  revision_number: number;
  recommendation_id: string | null;
  path: CatalogPath;
};

export type Concept = {
  id: string;
  generation_request_id: string;
  selection_id: string;
  seq: number;
  ai_title: string;
  ai_line: string;
  ai_body: string;
  title: string;
  line: string;
  body: string;
  edited_at: string | null;
  is_finalist: boolean;
  created_at: string;
  path_title: string | null;
};

export type Presentation = {
  id: string;
  concept_ids: string[];
  ai_content: PresentationContent;
  content: PresentationContent;
  edited_at: string | null;
  created_at: string;
  request: RequestSummary;
};

export type JobFlow = {
  job: JobDetail;
  analysis: Analysis | null;
  analysisRequest: RequestSummary | null;
  selection: Selection | null;
  conceptRequest: RequestSummary | null;
  concepts: Concept[];
  finalists: Concept[];
  presentation: Presentation | null;
  presentationRequest: RequestSummary | null;
};

const REQUEST_COLUMNS = "id, status, error_code, model, served_model, prompt_version, created_at, completed_at";

export async function getJobFlow(ownerId: string, jobId: string): Promise<JobFlow | null> {
  if (!jobIdSchema.safeParse(jobId).success) return null;
  const job = await getOwnJob(ownerId, jobId);
  if (!job) return null;

  const supabase = await createSupabaseServerClient();
  const revisionId = job.currentRevision?.id ?? null;

  // Analysis of the current briefing revision, and its latest request.
  let analysis: Analysis | null = null;
  let analysisRequest: RequestSummary | null = null;
  if (revisionId) {
    const { data: req, error } = await supabase
      .from("generation_requests")
      .select(REQUEST_COLUMNS)
      .eq("job_id", jobId)
      .eq("kind", "analysis")
      .eq("briefing_revision_id", revisionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new DataAccessError();
    analysisRequest = req as RequestSummary | null;

    const { data: row, error: analysisError } = await supabase
      .from("briefing_analyses")
      .select(
        `id, briefing_revision_id, created_at, output, generation_request_id,
         path_recommendations (id, rank, reasoning, creative_paths (${PATH_COLUMNS}))`,
      )
      .eq("job_id", jobId)
      .eq("briefing_revision_id", revisionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (analysisError) throw new DataAccessError();
    if (row) {
      const { data: analysisReq, error: reqError } = await supabase
        .from("generation_requests")
        .select(REQUEST_COLUMNS)
        .eq("id", row.generation_request_id)
        .single();
      if (reqError) throw new DataAccessError();
      type RecRow = { id: string; rank: number; reasoning: string; creative_paths: CatalogPath };
      analysis = {
        id: row.id,
        briefing_revision_id: row.briefing_revision_id,
        created_at: row.created_at,
        output: row.output as Analysis["output"],
        recommendations: ((row.path_recommendations ?? []) as unknown as RecRow[])
          .map((r) => ({ id: r.id, rank: r.rank, reasoning: r.reasoning, path: r.creative_paths }))
          .sort((a, b) => a.rank - b.rank),
        request: analysisReq as RequestSummary,
      };
    }
  }

  // Active selection: the most recent explicit choice.
  const { data: sel, error: selError } = await supabase
    .from("path_selections")
    .select(
      `id, origin, created_at, briefing_revision_id, recommendation_id,
       briefing_revisions (revision_number), creative_paths (${PATH_COLUMNS})`,
    )
    .eq("job_id", jobId)
    .order("choice_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selError) throw new DataAccessError();
  type SelRow = {
    id: string;
    origin: SelectionOrigin;
    created_at: string;
    briefing_revision_id: string;
    recommendation_id: string | null;
    briefing_revisions: { revision_number: number };
    creative_paths: CatalogPath;
  };
  const selRow = sel as unknown as SelRow | null;
  const selection: Selection | null = selRow
    ? {
        id: selRow.id,
        origin: selRow.origin,
        created_at: selRow.created_at,
        briefing_revision_id: selRow.briefing_revision_id,
        revision_number: selRow.briefing_revisions.revision_number,
        recommendation_id: selRow.recommendation_id,
        path: selRow.creative_paths,
      }
    : null;

  let conceptRequest: RequestSummary | null = null;
  let concepts: Concept[] = [];
  if (selection) {
    const { data: req, error } = await supabase
      .from("generation_requests")
      .select(REQUEST_COLUMNS)
      .eq("job_id", jobId)
      .eq("kind", "concepts")
      .eq("selection_id", selection.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new DataAccessError();
    conceptRequest = req as RequestSummary | null;
  }

  // All concepts of the job, newest generation first. Concepts from earlier
  // selections stay valid and can still be finalists.
  const { data: conceptRows, error: conceptsError } = await supabase
    .from("concepts")
    .select(
      "id, generation_request_id, selection_id, seq, ai_title, ai_line, ai_body, title, line, body, edited_at, is_finalist, created_at, creative_paths (title)",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("seq", { ascending: true });
  if (conceptsError) throw new DataAccessError();
  type ConceptRow = Omit<Concept, "path_title"> & { creative_paths: { title: string } | null };
  concepts = ((conceptRows ?? []) as unknown as ConceptRow[]).map(({ creative_paths, ...rest }) => ({
    ...rest,
    path_title: creative_paths?.title ?? null,
  }));
  const finalists = concepts.filter((c) => c.is_finalist);

  const { data: presReq, error: presReqError } = await supabase
    .from("generation_requests")
    .select(REQUEST_COLUMNS)
    .eq("job_id", jobId)
    .eq("kind", "presentation")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (presReqError) throw new DataAccessError();

  const { data: pres, error: presError } = await supabase
    .from("presentations")
    .select("id, concept_ids, ai_content, content, edited_at, created_at, generation_request_id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (presError) throw new DataAccessError();
  let presentation: Presentation | null = null;
  if (pres) {
    const { data: r, error } = await supabase.from("generation_requests").select(REQUEST_COLUMNS).eq("id", pres.generation_request_id).single();
    if (error) throw new DataAccessError();
    presentation = {
      id: pres.id,
      concept_ids: pres.concept_ids,
      ai_content: pres.ai_content as PresentationContent,
      content: pres.content as PresentationContent,
      edited_at: pres.edited_at,
      created_at: pres.created_at,
      request: r as RequestSummary,
    };
  }

  return {
    job,
    analysis,
    analysisRequest,
    selection,
    conceptRequest,
    concepts,
    finalists,
    presentation,
    presentationRequest: presReq as RequestSummary | null,
  };
}

/** Proposal from a random draw, for the confirmation screen. */
export async function getOwnDraw(jobId: string, drawId: string): Promise<{ id: string; path: CatalogPath; confirmed: boolean } | null> {
  if (!jobIdSchema.safeParse(drawId).success) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("path_draws")
    .select(`id, creative_paths (${PATH_COLUMNS})`)
    .eq("id", drawId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw new DataAccessError();
  if (!data) return null;
  const { count, error: countError } = await supabase
    .from("path_selections")
    .select("id", { count: "exact", head: true })
    .eq("draw_id", drawId);
  if (countError) throw new DataAccessError();
  return { id: data.id, path: data.creative_paths as unknown as CatalogPath, confirmed: (count ?? 0) > 0 };
}
