"use client";

import { useActionState, useState } from "react";

import type { PresentationContent } from "@/lib/ai/schemas";

import styles from "../../ui.module.css";
import {
  saveConcept,
  savePresentation,
  selectPath,
  setFinalist,
  type FlowActionState,
} from "./flow-actions";

const idle: FlowActionState = { status: "idle" };

type Action = (prev: FlowActionState, formData: FormData) => Promise<FlowActionState>;

/**
 * Starts an AI generation. While pending the button is disabled, so a double
 * click cannot submit twice (the server deduplicates anyway). A failed
 * attempt, from this action or from the last page load, offers a retry that
 * points at the failed request.
 */
export function GenerateForm(props: {
  action: Action;
  jobId: string;
  selectionId?: string;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
  failed?: { requestId: string; message: string; canRetry: boolean } | null;
}) {
  const [state, formAction, pending] = useActionState(props.action, idle);
  const failed =
    state.status === "error"
      ? { requestId: state.retryOf ?? null, message: state.message ?? "", canRetry: state.canRetry ?? true }
      : state.status === "idle"
        ? (props.failed ?? null)
        : null;
  const retryId = failed?.canRetry ? failed.requestId : null;

  return (
    <form className={styles.stack} action={formAction}>
      <input type="hidden" name="jobId" value={props.jobId} />
      {props.selectionId && <input type="hidden" name="selectionId" value={props.selectionId} />}
      {retryId && <input type="hidden" name="retryOf" value={retryId} />}
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending || props.disabled || (failed != null && !failed.canRetry)}>
          {pending ? props.pendingLabel : retryId ? "Tentar de novo" : props.label}
        </button>
        <span aria-live="polite">
          {pending ? (
            <span className={styles.muted}>A IA está trabalhando. Isso pode levar até 2 minutos; não feche a página.</span>
          ) : state.status === "pending" ? (
            <span className={styles.muted}>{state.message}</span>
          ) : state.status === "done" ? (
            <span className={styles.success}>Pronto.</span>
          ) : null}
        </span>
      </div>
      {!pending && failed && (
        <p className={styles.error} role="alert">
          {failed.message}
        </p>
      )}
    </form>
  );
}

/** The explicit choice of a path. Recommendations and draws only propose. */
export function SelectPathForm(props: {
  jobId: string;
  origin: "recommended" | "manual" | "random";
  pathId: string;
  recommendationId?: string;
  drawId?: string;
  label: string;
  secondary?: boolean;
}) {
  const [state, formAction, pending] = useActionState(selectPath, idle);
  return (
    <form className={styles.row} action={formAction}>
      <input type="hidden" name="jobId" value={props.jobId} />
      <input type="hidden" name="origin" value={props.origin} />
      <input type="hidden" name="pathId" value={props.pathId} />
      <input type="hidden" name="recommendationId" value={props.recommendationId ?? ""} />
      <input type="hidden" name="drawId" value={props.drawId ?? ""} />
      <button className={props.secondary ? styles.secondaryButton : styles.button} type="submit" disabled={pending}>
        {pending ? "Salvando escolha…" : props.label}
      </button>
      {state.status === "error" && (
        <span className={styles.error} role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}

export type ConceptView = {
  id: string;
  ai_title: string;
  ai_line: string;
  ai_body: string;
  title: string;
  line: string;
  body: string;
  edited_at: string | null;
  is_finalist: boolean;
};

export function ConceptCard({ jobId, concept, pathTitle }: { jobId: string; concept: ConceptView; pathTitle: string | null }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState(saveConcept, idle);
  const [finalistState, finalistAction, marking] = useActionState(setFinalist, idle);
  const edited = concept.edited_at != null;

  return (
    <article className={`${styles.item} ${concept.is_finalist ? styles.itemActive : ""}`}>
      <div className={styles.row}>
        <span className={`${styles.badge} ${styles.badgeAi}`}>Gerado por IA</span>
        {edited && <span className={`${styles.badge} ${styles.badgeUser}`}>Editado por você</span>}
        {concept.is_finalist && <span className={`${styles.badge} ${styles.badgeUser}`}>Finalista (sua escolha)</span>}
        {pathTitle && <span className={styles.muted}>Caminho: {pathTitle}</span>}
      </div>

      {editing ? (
        <form className={styles.form} action={saveAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="conceptId" value={concept.id} />
          <label className={styles.field}>
            Título
            <input className={styles.input} name="title" defaultValue={concept.title} maxLength={200} required />
          </label>
          <label className={styles.field}>
            Linha
            <input className={styles.input} name="line" defaultValue={concept.line} maxLength={400} required />
          </label>
          <label className={styles.field}>
            Corpo
            <textarea
              className={`${styles.textarea} ${styles.smallTextarea}`}
              name="body"
              defaultValue={concept.body}
              maxLength={6000}
              required
            />
          </label>
          <div className={styles.row}>
            <button className={styles.button} type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar edição"}
            </button>
            <button className={styles.linkButton} type="button" onClick={() => setEditing(false)} disabled={saving}>
              Fechar
            </button>
            {saveState.status === "error" && (
              <span className={styles.error} role="alert">
                {saveState.message}
              </span>
            )}
            {saveState.status === "done" && <span className={styles.success}>{saveState.message}</span>}
          </div>
        </form>
      ) : (
        <>
          <h3>{concept.title}</h3>
          <p className={styles.prose}>
            <strong>{concept.line}</strong>
          </p>
          <p className={styles.prose}>{concept.body}</p>
        </>
      )}

      {edited && !editing && (
        <details className={styles.details}>
          <summary>Ver versão original da IA</summary>
          <h3>{concept.ai_title}</h3>
          <p className={styles.prose}>
            <strong>{concept.ai_line}</strong>
          </p>
          <p className={styles.prose}>{concept.ai_body}</p>
        </details>
      )}

      <div className={styles.row}>
        {!editing && (
          <button className={styles.secondaryButton} type="button" onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
        <form action={finalistAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="conceptId" value={concept.id} />
          <input type="hidden" name="value" value={concept.is_finalist ? "false" : "true"} />
          <button className={styles.secondaryButton} type="submit" disabled={marking}>
            {marking ? "Salvando…" : concept.is_finalist ? "Tirar dos finalistas" : "Marcar como finalista"}
          </button>
        </form>
        {finalistState.status === "error" && (
          <span className={styles.error} role="alert">
            {finalistState.message}
          </span>
        )}
      </div>
    </article>
  );
}

export function PresentationEditor(props: {
  jobId: string;
  presentationId: string;
  content: PresentationContent;
  conceptTitles: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(savePresentation, idle);
  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="jobId" value={props.jobId} />
      <input type="hidden" name="presentationId" value={props.presentationId} />
      <label className={styles.field}>
        Título
        <input className={styles.input} name="title" defaultValue={props.content.title} maxLength={200} required />
      </label>
      <label className={styles.field}>
        Abertura
        <textarea className={`${styles.textarea} ${styles.smallTextarea}`} name="intro" defaultValue={props.content.intro} maxLength={2000} required />
      </label>
      {props.content.slides.map((slide, index) => (
        <fieldset key={slide.concept_id} className={styles.item}>
          <legend className={styles.muted}>
            Slide {index + 1} · conceito {props.conceptTitles[slide.concept_id] ?? "finalista"}
          </legend>
          <input type="hidden" name="slideConceptId" value={slide.concept_id} />
          <label className={styles.field}>
            Título do slide
            <input className={styles.input} name="slideHeading" defaultValue={slide.heading} maxLength={200} required />
          </label>
          <label className={styles.field}>
            Texto
            <textarea className={`${styles.textarea} ${styles.smallTextarea}`} name="slideText" defaultValue={slide.text} maxLength={3000} required />
          </label>
        </fieldset>
      ))}
      <label className={styles.field}>
        Fechamento
        <textarea className={`${styles.textarea} ${styles.smallTextarea}`} name="closing" defaultValue={props.content.closing} maxLength={2000} required />
      </label>
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar apresentação"}
        </button>
        {state.status === "error" && (
          <span className={styles.error} role="alert">
            {state.message}
          </span>
        )}
        {state.status === "done" && <span className={styles.success}>{state.message}</span>}
      </div>
    </form>
  );
}
