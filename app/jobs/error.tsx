"use client";

import styles from "../ui.module.css";

export default function JobsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Não foi possível carregar</h1>
      <p className={styles.muted} role="alert">
        Houve uma falha ao buscar seus dados. Nada do que já foi salvo se perdeu.
      </p>
      <div className={styles.row}>
        <button className={styles.button} type="button" onClick={reset}>
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
