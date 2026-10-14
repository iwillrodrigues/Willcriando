"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { dbErrorMessage } from "@/lib/errors";
import { composeBriefing, directionSchema, splitBriefing, type Direction } from "@/lib/flow/direction";
import { getOwnJob } from "@/lib/jobs/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { briefingSchema, fieldErrors, jobIdSchema, jobTitleSchema } from "@/lib/validation";

export type CreateJobState = { status: "idle" | "error"; message?: string; title?: string };

export async function createJob(_prev: CreateJobState, formData: FormData): Promise<CreateJobState> {
  await requireUser("/jobs");
  const raw = String(formData.get("title") ?? "");
  const parsed = jobTitleSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: fieldErrors(parsed.error).form, title: raw };

  const supabase = await createSupabaseServerClient();
  // owner_id is set by the database from the session; clients cannot send it.
  const { data, error } = await supabase.from("jobs").insert({ title: parsed.data }).select("id").single();
  if (error || !data) return { status: "error", message: dbErrorMessage(error), title: raw };

  revalidatePath("/jobs");
  redirect(`/jobs/${data.id}`);
}

export type SaveBriefingState = {
  status: "idle" | "error" | "saved";
  message?: string;
  revisionNumber?: number;
  savedAt?: string;
};

/**
 * Appends a revision through the database function, which checks ownership,
 * numbers the revision under a row lock and appends it. Existing revisions are
 * never changed.
 */
async function appendRevision(jobId: string, content: string): Promise<SaveBriefingState> {
  const parsed = briefingSchema.safeParse(content);
  if (!parsed.success) return { status: "error", message: fieldErrors(parsed.error).form };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("save_briefing_revision", { p_job_id: jobId, p_content: parsed.data })
    .single<{ revision_number: number; created_at: string }>();
  if (error || !data) return { status: "error", message: dbErrorMessage(error) };

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { status: "saved", revisionNumber: data.revision_number, savedAt: data.created_at };
}

/** Saves the brief text. A direction adjusted by the creative is carried over unchanged. */
export async function saveBriefing(_prev: SaveBriefingState, formData: FormData): Promise<SaveBriefingState> {
  const jobId = String(formData.get("jobId") ?? "");
  const user = await requireUser(`/jobs/${encodeURIComponent(jobId)}`);

  const job = await getOwnJob(user.id, jobId);
  if (!job) return { status: "error", message: "Job não encontrado ou sem acesso." };
  const brief = String(formData.get("content") ?? "");
  const parsed = briefingSchema.safeParse(brief);
  if (!parsed.success) return { status: "error", message: fieldErrors(parsed.error).form };

  const { direction } = splitBriefing(job.currentRevision?.content ?? "");
  return appendRevision(jobId, composeBriefing(brief, direction));
}

/**
 * Saves the direction as the creative adjusted it, or removes the adjustment.
 * Either way the result is a new briefing revision with the same brief text.
 */
export async function saveDirection(_prev: SaveBriefingState, formData: FormData): Promise<SaveBriefingState> {
  const jobId = String(formData.get("jobId") ?? "");
  const user = await requireUser(`/jobs/${encodeURIComponent(jobId)}`);

  const job = await getOwnJob(user.id, jobId);
  if (!job) return { status: "error", message: "Job não encontrado ou sem acesso." };
  if (!job.currentRevision) return { status: "error", message: "Salve o briefing antes de ajustar a direção." };

  let direction: Direction | null = null;
  if (formData.get("intent") !== "clear") {
    const parsed = directionSchema.safeParse({
      challenge: String(formData.get("challenge") ?? ""),
      audience: String(formData.get("audience") ?? ""),
      tension: String(formData.get("tension") ?? ""),
      human_truth: String(formData.get("human_truth") ?? ""),
    });
    if (!parsed.success) return { status: "error", message: "Preencha os quatro campos, com até 800 caracteres cada." };
    direction = parsed.data;
  }

  const { brief } = splitBriefing(job.currentRevision.content);
  return appendRevision(jobId, composeBriefing(brief, direction));
}

export type DeleteJobState = { status: "idle" | "error"; message?: string };

/**
 * Deletes the job and everything in it, for good. The database function checks
 * ownership and removes all of the job's rows in one transaction.
 */
export async function deleteJob(_prev: DeleteJobState, formData: FormData): Promise<DeleteJobState> {
  await requireUser("/jobs");
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobIdSchema.safeParse(jobId).success) return { status: "error", message: "Job não encontrado ou sem acesso." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_job", { p_job_id: jobId });
  if (error) {
    // The function arrives with a migration; until it is applied, say so plainly.
    if (error.code === "PGRST202") {
      return { status: "error", message: "A exclusão ainda não foi ativada no banco deste ambiente." };
    }
    return { status: "error", message: dbErrorMessage(error) };
  }

  revalidatePath("/jobs");
  redirect("/jobs");
}
