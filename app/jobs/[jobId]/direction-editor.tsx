"use client";

import { useActionState, useState } from "react";

import { DIRECTION_FIELD_MAX, DIRECTION_FIELDS, type Direction } from "@/lib/flow/direction";

import styles from "../../ui.module.css";
import { saveDirection, type SaveBriefingState } from "../actions";

const idle: SaveBriefingState = { status: "idle" };

/**
 * Adjusting the direction writes a new briefing revision: the same brief plus
 * the direction as the creative wrote it. Nothing the AI produced is changed.
 */
export function DirectionEditor(props: {
  jobId: string;
  /** What the form starts from: the creative's direction, else the AI reading, else blank. */
  initial: Direction | null;
  adjusted: boolean;
  nextRevision: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(saveDirection, idle);
  const [clearState, clearAction, clearing] = useActionState(saveDirection, idle);

  // Close the form once a save lands (state adjusted during render, not in an effect).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "saved") setOpen(false);
  }

  if (!open) {
    return (
      <div className={styles.stack}>
        <div className={styles.row}>
          <button className={styles.secondaryButton} type="button" onClick={() => setOpen(true)}>
            {props.adjusted ? "Editar sua direção" : props.initial ? "Ajustar a direção" : "Escrever a direção"}
          </button>
          {props.adjusted && (
            <form action={clearAction}>
              <input type="hidden" name="jobId" value={props.jobId} />
              <input type="hidden" name="intent" value="clear" />
              <button className={styles.linkButton} type="submit" disabled={clearing}>
                {clearing ? "Removendo…" : "Remover seu ajuste"}
              </button>
            </form>
          )}
        </div>
        {state.status === "saved" && (
          <p className={styles.success}>Direção salva na revisão {state.revisionNumber} do briefing.</p>
        )}
        {clearState.status === "saved" && (
          <p className={styles.success}>Ajuste removido. Revisão {clearState.revisionNumber} tem só o briefing.</p>
        )}
        {clearState.status === "error" && (
          <p className={styles.error} role="alert">
            {clearState.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="jobId" value={props.jobId} />
      {DIRECTION_FIELDS.map((field) => (
        <label key={field.key} className={styles.field}>
          {field.label}
          <textarea
            className={`${styles.textarea} ${styles.smallTextarea}`}
            name={field.key}
            defaultValue={props.initial?.[field.key] ?? ""}
            maxLength={DIRECTION_FIELD_MAX}
            required
            rows={3}
          />
        </label>
      ))}
      <p className={styles.notice}>
        Salvar cria a revisão {props.nextRevision} do briefing, com o mesmo texto e esta direção no fim. A IA passa a ler a sua
        direção. Recomendações feitas antes continuam guardadas, mas valem para a revisão anterior.
      </p>
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "Salvando…" : `Salvar como revisão ${props.nextRevision}`}
        </button>
        <button className={styles.linkButton} type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </button>
        {state.status === "error" && (
          <span className={styles.error} role="alert">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
