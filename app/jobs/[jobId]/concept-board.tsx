"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import styles from "../../ui.module.css";
import { ConceptCard, type ConceptView } from "./flow-forms";
import ws from "./workspace.module.css";

/**
 * Dismissed ideas are a per-device working state: the database has no field
 * for them, and nothing is deleted. They are kept in this browser's storage,
 * which can be unavailable (private mode, blocked storage); then nothing is
 * hidden and every idea stays visible.
 */
const listeners = new Set<() => void>();

function storageKey(jobId: string): string {
  return `trilha:descartados:${jobId}`;
}

function readRaw(jobId: string): string {
  try {
    return window.localStorage.getItem(storageKey(jobId)) ?? "[]";
  } catch {
    return "[]";
  }
}

function writeIds(jobId: string, ids: string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(storageKey(jobId));
    else window.localStorage.setItem(storageKey(jobId), JSON.stringify(ids));
  } catch {
    // Storage unavailable: the idea simply stays visible.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function parseIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export type ConceptRun = {
  id: string;
  /** Editorial code ("9.3") and title of the path the run applied. */
  pathCode: string | null;
  pathTitle: string;
  /** Origin of the path choice, revision, time and model. */
  provenance: string;
  concepts: ConceptView[];
};

export function ConceptBoard({ jobId, runs }: { jobId: string; runs: ConceptRun[] }) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(jobId),
    () => "[]",
  );
  const dismissed = useMemo(() => new Set(parseIds(raw)), [raw]);

  const dismiss = useCallback((id: string) => writeIds(jobId, [...new Set([...parseIds(readRaw(jobId)), id])]), [jobId]);
  const recover = useCallback(
    (id: string) => writeIds(jobId, parseIds(readRaw(jobId)).filter((v) => v !== id)),
    [jobId],
  );

  // A finalist is never hidden, even if it was dismissed on this device before.
  const isHidden = (c: ConceptView) => dismissed.has(c.id) && !c.is_finalist;
  const hidden = runs.flatMap((run) => run.concepts.filter(isHidden));

  return (
    <div className={styles.stack}>
      {runs.map((run, index) => {
        const visible = run.concepts.filter((c) => !isHidden(c));
        return (
          <section key={run.id} className={ws.run} aria-label={`Rodada ${runs.length - index}`}>
            <div className={ws.runHead}>
              <h3 className={ws.runTitle}>
                Rodada {runs.length - index} ·{" "}
                {run.pathCode && <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {run.pathCode}</span>}{" "}
                {run.pathTitle}
              </h3>
              <p className={styles.muted}>{run.provenance}</p>
            </div>
            {visible.length === 0 ? (
              <p className={styles.muted}>Todas as ideias desta rodada foram descartadas neste aparelho.</p>
            ) : (
              <div className={ws.cards}>
                {visible.map((concept) => (
                  <ConceptCard key={concept.id} jobId={jobId} concept={concept} onDismiss={() => dismiss(concept.id)} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {hidden.length > 0 && (
        <details className={`${styles.details} ${ws.dismissed}`}>
          <summary>
            Descartadas ({hidden.length}) · guardadas só neste aparelho
          </summary>
          <ul className={styles.list}>
            {hidden.map((concept) => (
              <li key={concept.id} className={ws.dismissedItem}>
                <span>
                  <strong>{concept.title}</strong> <span className={styles.muted}>{concept.line}</span>
                </span>
                <button className={styles.secondaryButton} type="button" onClick={() => recover(concept.id)}>
                  Recuperar
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
