"use client";

import { useActionState, useState } from "react";

import type { PresentationContent } from "@/lib/ai/schemas";

import styles from "../../ui.module.css";
import ws from "./workspace.module.css";
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

/**
 * One idea. AI text, the creative's edits and the finalist mark are labeled
 * apart. Dismissing only hides the card on this device; finalists cannot be
 * dismissed until they are taken out of the finalists.
 */
export function ConceptCard({ jobId, concept, onDismiss }: { jobId: string; concept: ConceptView; onDismiss?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState(saveConcept, idle);
  const [finalistState, finalistAction, marking] = useActionState(setFinalist, idle);
  const edited = concept.edited_at != null;

  return (
    <article className={`${ws.concept} ${concept.is_finalist ? ws.conceptFinalist : ""}`}>
      <div className={styles.row}>
        <span className={`${styles.badge} ${styles.badgeAi}`}>IA</span>
        {edited && <span className={`${styles.badge} ${styles.badgeUser}`}>Editado por você</span>}
        {concept.is_finalist && <span className={`${styles.badge} ${styles.badgeUser}`}>Finalista</span>}
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
          <h4 className={ws.conceptTitle}>{concept.title}</h4>
          <p className={ws.conceptLine}>{concept.line}</p>
          <p className={styles.prose}>{concept.body}</p>
        </>
      )}

      {edited && !editing && (
        <details className={styles.details}>
          <summary>Ver a versão original da IA</summary>
          <h4 className={ws.conceptTitle}>{concept.ai_title}</h4>
          <p className={ws.conceptLine}>{concept.ai_line}</p>
          <p className={styles.prose}>{concept.ai_body}</p>
        </details>
      )}

      <div className={ws.actions}>
        <form action={finalistAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="conceptId" value={concept.id} />
          <input type="hidden" name="value" value={concept.is_finalist ? "false" : "true"} />
          <button className={concept.is_finalist ? styles.secondaryButton : styles.button} type="submit" disabled={marking}>
            {marking ? "Salvando…" : concept.is_finalist ? "Tirar das finalistas" : "Marcar como finalista"}
          </button>
        </form>
        {!editing && (
          <button className={styles.secondaryButton} type="button" onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
        {onDismiss && !concept.is_finalist && !editing && (
          <button className={styles.linkButton} type="button" onClick={onDismiss}>
            Descartar
          </button>
        )}
        {finalistState.status === "error" && (
          <span className={styles.error} role="alert">
            {finalistState.message}
          </span>
        )}
      </div>
    </article>
  );
}

/** A presentation version: read it as slides, or edit its text. */
export function PresentationVersion(props: {
  jobId: string;
  presentationId: string;
  content: PresentationContent;
  conceptTitles: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(savePresentation, idle);
  const { content } = props;

  if (!editing) {
    return (
      <div className={styles.stack}>
        <div className={ws.deck}>
          <section className={`${ws.slide} ${ws.slideCover}`}>
            <span className={ws.slideLabel}>Abertura</span>
            <h4 className={ws.slideHeading}>{content.title}</h4>
            <p className={styles.prose}>{content.intro}</p>
          </section>
          {content.slides.map((slide, index) => (
            <section key={slide.concept_id} className={ws.slide}>
              <span className={ws.slideLabel}>
                Ideia {index + 1}
                {props.conceptTitles[slide.concept_id] ? ` · ${props.conceptTitles[slide.concept_id]}` : ""}
              </span>
              <h4 className={ws.slideHeading}>{slide.heading}</h4>
              <p className={styles.prose}>{slide.text}</p>
            </section>
          ))}
          <section className={ws.slide}>
            <span className={ws.slideLabel}>Fechamento</span>
            <p className={styles.prose}>{content.closing}</p>
          </section>
        </div>
        <div className={styles.row}>
          <button className={styles.secondaryButton} type="button" onClick={() => setEditing(true)}>
            Editar esta versão
          </button>
          {state.status === "done" && <span className={styles.success}>{state.message}</span>}
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="jobId" value={props.jobId} />
      <input type="hidden" name="presentationId" value={props.presentationId} />
      <label className={styles.field}>
        Título
        <input className={styles.input} name="title" defaultValue={content.title} maxLength={200} required />
      </label>
      <label className={styles.field}>
        Abertura
        <textarea className={`${styles.textarea} ${styles.smallTextarea}`} name="intro" defaultValue={content.intro} maxLength={2000} required />
      </label>
      {content.slides.map((slide, index) => (
        <fieldset key={slide.concept_id} className={styles.item}>
          <legend className={styles.muted}>
            Ideia {index + 1} · {props.conceptTitles[slide.concept_id] ?? "finalista"}
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
        <textarea className={`${styles.textarea} ${styles.smallTextarea}`} name="closing" defaultValue={content.closing} maxLength={2000} required />
      </label>
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar esta versão"}
        </button>
        <button className={styles.linkButton} type="button" onClick={() => setEditing(false)} disabled={pending}>
          Ver como slides
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
