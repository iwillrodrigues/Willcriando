"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { conceptFieldsSchema, presentationContentSchema } from "@/lib/ai/schemas";
import { requireUser } from "@/lib/auth/session";
import { dbErrorMessage, generationErrorMessage, isConfigurationError } from "@/lib/errors";
import { runGeneration, type GenerationKind } from "@/lib/flow/generation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Actions of the creative flow. The user id always comes from the session.
 * Ids from the form are only format-checked here; ownership and every
 * relationship are checked by the database functions.
 */

export type FlowActionState = {
  status: "idle" | "error" | "done" | "pending";
  message?: string;
  /** Failed request that the retry button should point at. */
  retryOf?: string | null;
  /** False when retrying cannot help (missing configuration). */
  canRetry?: boolean;
};

const uuid = z.uuid();
const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v));

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function jobPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`;
}

async function generate(kind: GenerationKind, formData: FormData): Promise<FlowActionState> {
  const jobId = field(formData, "jobId");
  const user = await requireUser(jobPath(jobId));
  const ids = z
    .object({ jobId: uuid, selectionId: optionalUuid, retryOf: optionalUuid })
    .safeParse({ jobId, selectionId: field(formData, "selectionId"), retryOf: field(formData, "retryOf") });
  if (!ids.success) return { status: "error", message: "Job não encontrado ou sem acesso." };

  const outcome = await runGeneration({
    userId: user.id,
    jobId: ids.data.jobId,
    kind,
    selectionId: ids.data.selectionId,
    retryOf: ids.data.retryOf,
  });
  revalidatePath(jobPath(ids.data.jobId));

  if (outcome.status === "succeeded") return { status: "done" };
  if (outcome.status === "pending") {
    return { status: "pending", message: "Já existe uma geração em andamento. Atualize a página em instantes." };
  }
  return {
    status: "error",
    message: generationErrorMessage(outcome.code),
    retryOf: outcome.requestId,
    canRetry: !isConfigurationError(outcome.code),
  };
}

export async function analyzeBriefing(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  return generate("analysis", formData);
}

export async function generateConcepts(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  return generate("concepts", formData);
}

export async function generatePresentation(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  return generate("presentation", formData);
}

/** Draws a path (a proposal only) and opens the explorer to confirm it. */
export async function drawRandomPath(formData: FormData): Promise<void> {
  const jobId = field(formData, "jobId");
  await requireUser(jobPath(jobId));
  if (!uuid.safeParse(jobId).success) redirect("/jobs");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("draw_random_path", { p_job_id: jobId }).single<{ id: string }>();
  if (error || !data) {
    redirect(`${jobPath(jobId)}/caminhos?erro=${encodeURIComponent(dbErrorMessage(error))}#sorteio`);
  }
  redirect(`${jobPath(jobId)}/caminhos?sorteio=${data.id}#sorteio`);
}

const selectionInput = z.object({
  jobId: uuid,
  origin: z.enum(["recommended", "manual", "random"]),
  pathId: uuid,
  recommendationId: optionalUuid,
  drawId: optionalUuid,
});

/** The explicit human decision. Nothing else ever creates a selection. */
export async function selectPath(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  const jobId = field(formData, "jobId");
  await requireUser(jobPath(jobId));
  const parsed = selectionInput.safeParse({
    jobId,
    origin: field(formData, "origin"),
    pathId: field(formData, "pathId"),
    recommendationId: field(formData, "recommendationId"),
    drawId: field(formData, "drawId"),
  });
  if (!parsed.success) return { status: "error", message: "Escolha inválida. Recarregue a página." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("select_path", {
    p_job_id: parsed.data.jobId,
    p_origin: parsed.data.origin,
    p_creative_path_id: parsed.data.pathId,
    p_recommendation_id: parsed.data.recommendationId,
    p_draw_id: parsed.data.drawId,
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };

  revalidatePath(jobPath(parsed.data.jobId));
  redirect(`${jobPath(parsed.data.jobId)}#caminho`);
}

export async function saveConcept(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  const jobId = field(formData, "jobId");
  await requireUser(jobPath(jobId));
  const ids = z.object({ jobId: uuid, conceptId: uuid }).safeParse({ jobId, conceptId: field(formData, "conceptId") });
  const fields = conceptFieldsSchema.safeParse({
    title: field(formData, "title"),
    line: field(formData, "line"),
    body: field(formData, "body"),
  });
  if (!ids.success) return { status: "error", message: "Conceito não encontrado ou sem acesso." };
  if (!fields.success) return { status: "error", message: "Preencha título, linha e corpo (sem exceder os limites)." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_concept", {
    p_concept_id: ids.data.conceptId,
    p_title: fields.data.title,
    p_line: fields.data.line,
    p_body: fields.data.body,
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  revalidatePath(jobPath(ids.data.jobId));
  return { status: "done", message: "Edição salva." };
}

export async function setFinalist(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  const jobId = field(formData, "jobId");
  await requireUser(jobPath(jobId));
  const parsed = z
    .object({ jobId: uuid, conceptId: uuid, value: z.enum(["true", "false"]) })
    .safeParse({ jobId, conceptId: field(formData, "conceptId"), value: field(formData, "value") });
  if (!parsed.success) return { status: "error", message: "Conceito não encontrado ou sem acesso." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_concept_finalist", {
    p_concept_id: parsed.data.conceptId,
    p_is_finalist: parsed.data.value === "true",
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  revalidatePath(jobPath(parsed.data.jobId));
  return { status: "done" };
}

export async function savePresentation(_prev: FlowActionState, formData: FormData): Promise<FlowActionState> {
  const jobId = field(formData, "jobId");
  await requireUser(jobPath(jobId));
  const ids = z
    .object({ jobId: uuid, presentationId: uuid })
    .safeParse({ jobId, presentationId: field(formData, "presentationId") });
  if (!ids.success) return { status: "error", message: "Apresentação não encontrada ou sem acesso." };

  const conceptIds = formData.getAll("slideConceptId").map(String);
  const content = presentationContentSchema.safeParse({
    title: field(formData, "title"),
    intro: field(formData, "intro"),
    slides: conceptIds.map((conceptId, index) => ({
      concept_id: conceptId,
      heading: String(formData.getAll("slideHeading")[index] ?? ""),
      text: String(formData.getAll("slideText")[index] ?? ""),
    })),
    closing: field(formData, "closing"),
  });
  if (!content.success) return { status: "error", message: "Preencha todos os campos da apresentação." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_presentation", {
    p_presentation_id: ids.data.presentationId,
    p_content: content.data,
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  revalidatePath(jobPath(ids.data.jobId));
  return { status: "done", message: "Apresentação salva." };
}
