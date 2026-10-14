"use client";

import { useActionState, useState } from "react";

import { formatDateTime } from "@/lib/format";
import { BRIEFING_MAX } from "@/lib/validation";

import styles from "../../ui.module.css";
import { saveBriefing, type SaveBriefingState } from "../actions";

const initialState: SaveBriefingState = { status: "idle" };

/**
 * Edits the brief text. When the creative adjusted the direction, the
 * adjustment is not part of this text; the server carries it over.
 */
export function BriefingForm({ jobId, initialContent, keepsDirection }: { jobId: string; initialContent: string; keepsDirection: boolean }) {
  const [state, formAction, pending] = useActionState(saveBriefing, initialState);
  const [content, setContent] = useState(initialContent);
  const dirty = content !== initialContent;
  const blank = content.trim().length === 0;

  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <label className={styles.field}>
        Texto do briefing
        <textarea
          className={styles.textarea}
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={BRIEFING_MAX}
          required
          aria-invalid={state.status === "error"}
          placeholder="Cole o briefing como ele chegou: pedido, marca, público, prazo, verba, mandatórios."
        />
      </label>
      {keepsDirection && (
        <p className={styles.muted}>A direção que você ajustou no momento 2 é mantida ao salvar.</p>
      )}
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending || blank || !dirty}>
          {pending ? "Salvando…" : initialContent ? "Salvar nova revisão" : "Salvar briefing"}
        </button>
        <span aria-live="polite">
          {pending ? null : state.status === "error" ? (
            <span className={styles.error} role="alert">
              {state.message}
            </span>
          ) : dirty ? (
            <span className={styles.muted}>Alterações não salvas.</span>
          ) : state.status === "saved" ? (
            <span className={styles.success}>
              Revisão {state.revisionNumber} salva{state.savedAt ? ` em ${formatDateTime(state.savedAt)}` : ""}.
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
