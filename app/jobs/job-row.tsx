"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import styles from "../ui.module.css";
import { deleteJob, type DeleteJobState } from "./actions";

const idle: DeleteJobState = { status: "idle" };

/**
 * One job in the list. The ⋯ button opens its menu; right-clicking the row
 * opens the same menu, as a shortcut. Deleting always asks first, naming the
 * job and what goes with it.
 */
export function JobRow({ id, title, updatedLabel }: { id: string; title: string; updatedLabel: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteJob, idle);
  const rowRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Close the menu on a click outside it or on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function askToDelete() {
    setMenuOpen(false);
    dialogRef.current?.showModal();
  }

  return (
    <li
      ref={rowRef}
      className={styles.jobRow}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <Link className={styles.jobLink} href={`/jobs/${id}`}>
        <span className={styles.jobTitle}>{title}</span>
        <span className={styles.muted}>Atualizado em {updatedLabel}</span>
      </Link>

      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label={`Opções de ${title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>

      {menuOpen && (
        <div className={styles.menu} role="menu" aria-label={`Opções de ${title}`}>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={askToDelete}
            autoFocus
          >
            Excluir job
          </button>
        </div>
      )}

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`excluir-${id}`}>
        <form action={formAction} className={styles.form}>
          <input type="hidden" name="jobId" value={id} />
          <h2 id={`excluir-${id}`} className={styles.dialogTitle}>
            Excluir “{title}”?
          </h2>
          <p className={styles.muted}>
            Vão junto o briefing e todas as revisões, as leituras da IA, os caminhos escolhidos, as ideias e as apresentações.
            Não dá para desfazer.
          </p>
          {state.status === "error" && (
            <p className={styles.error} role="alert">
              {state.message}
            </p>
          )}
          <div className={styles.row}>
            <button type="submit" className={styles.dangerButton} disabled={pending}>
              {pending ? "Excluindo…" : "Excluir para sempre"}
            </button>
            <button type="button" className={styles.linkButton} onClick={() => dialogRef.current?.close()} disabled={pending}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </li>
  );
}
