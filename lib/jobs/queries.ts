import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jobIdSchema } from "@/lib/validation";

/**
 * Read access for jobs and briefing revisions.
 *
 * Queries run with the user's session, so RLS limits them to the user's own
 * rows. The explicit `owner_id` filter is defense in depth, not the boundary.
 */

export type JobSummary = { id: string; title: string; created_at: string; updated_at: string };
export type BriefingRevision = { id: string; revision_number: number; content: string; created_at: string };
export type JobDetail = JobSummary & { currentRevision: BriefingRevision | null };

export class DataAccessError extends Error {
  constructor() {
    super("Data access failed.");
    this.name = "DataAccessError";
  }
}

export async function listOwnJobs(ownerId: string): Promise<JobSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title, created_at, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw new DataAccessError();
  return data;
}

/**
 * Returns the job with its current (highest-numbered) briefing revision, or
 * null when the id is malformed, missing, or owned by someone else. The three
 * cases are indistinguishable on purpose.
 */
export async function getOwnJob(ownerId: string, jobId: string): Promise<JobDetail | null> {
  if (!jobIdSchema.safeParse(jobId).success) return null;

  const supabase = await createSupabaseServerClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, title, created_at, updated_at")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new DataAccessError();
  if (!job) return null;

  const { data: revision, error: revisionError } = await supabase
    .from("briefing_revisions")
    .select("id, revision_number, content, created_at")
    .eq("job_id", jobId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (revisionError) throw new DataAccessError();

  return { ...job, currentRevision: revision };
}
