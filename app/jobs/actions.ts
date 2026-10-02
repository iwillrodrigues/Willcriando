"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { dbErrorMessage } from "@/lib/errors";
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

export async function saveBriefing(_prev: SaveBriefingState, formData: FormData): Promise<SaveBriefingState> {
  const jobId = String(formData.get("jobId") ?? "");
  await requireUser(`/jobs/${encodeURIComponent(jobId)}`);

  if (!jobIdSchema.safeParse(jobId).success) {
    return { status: "error", message: "Job não encontrado ou sem acesso." };
  }
  const parsed = briefingSchema.safeParse(String(formData.get("content") ?? ""));
  if (!parsed.success) return { status: "error", message: fieldErrors(parsed.error).form };

  const supabase = await createSupabaseServerClient();
  // The database function checks ownership, numbers the revision under a row
  // lock and appends it. Existing revisions are never changed.
  const { data, error } = await supabase
    .rpc("save_briefing_revision", { p_job_id: jobId, p_content: parsed.data })
    .single<{ revision_number: number; created_at: string }>();
  if (error || !data) return { status: "error", message: dbErrorMessage(error) };

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { status: "saved", revisionNumber: data.revision_number, savedAt: data.created_at };
}

export type DeleteJobState = { status: "idle" | "error"; message?: string };

/**
 * Permanently deletes one of the user's jobs. The form must carry the
 * confirmation field that only the confirmation step sends. The database
 * function checks ownership and deletes the whole job graph in one
 * transaction, so a failure deletes nothing.
 */
export async function deleteJob(_prev: DeleteJobState, formData: FormData): Promise<DeleteJobState> {
  await requireUser("/jobs");
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobIdSchema.safeParse(jobId).success) return { status: "error", message: "Job não encontrado ou sem acesso." };
  if (formData.get("confirm") !== "excluir") return { status: "error", message: "Confirme a exclusão para continuar." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_job", { p_job_id: jobId });
  if (error) {
    if (error.message?.trim() === "TRILHA_JOB_NOT_FOUND") {
      revalidatePath("/jobs");
      return { status: "error", message: "Este job já foi excluído ou não está acessível. Atualize a página." };
    }
    return { status: "error", message: `Não foi possível excluir o job. Nada foi apagado. ${dbErrorMessage(error)}` };
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  redirect("/jobs?excluido=1");
}
