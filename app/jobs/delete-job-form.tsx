"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import styles from "../ui.module.css";
import { deleteJob, type DeleteJobState } from "./actions";

const initialState: DeleteJobState = { status: "idle" };

/**
 * Two steps on purpose: "Excluir" only opens a confirmation that names the
 * job; the deletion happens on "Excluir para sempre".
 */
export function DeleteJobForm({ jobId, title }: { jobId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteJob, initialState);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button className={styles.dangerLink} type="button" onClick={() => setOpen(true)} aria-label={`Excluir o job “${title}”`}>
        Excluir
      </button>
    );
  }

  const headingId = `excluir-${jobId}`;
  return (
    <div className={styles.confirm} role="group" aria-labelledby={headingId}>
      <p id={headingId} className={styles.confirmTitle}>
        Excluir “{title}” para sempre?
      </p>
      <p className={styles.muted}>
        O briefing e suas revisões, as análises, os caminhos escolhidos, os conceitos (inclusive os descartados) e as apresentações guardadas
        deste job serão apagados. Não dá para desfazer. Seus outros jobs não mudam.
      </p>
      <form className={styles.row} action={formAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="confirm" value="excluir" />
        <button className={styles.dangerButton} type="submit" disabled={pending}>
          {pending ? "Excluindo…" : "Excluir para sempre"}
        </button>
        <button ref={cancelRef} className={styles.linkButton} type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </button>
      </form>
      {!pending && state.status === "error" && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
