import styles from "../ui.module.css";

export default function JobsLoading() {
  return (
    <main className={styles.page} aria-busy="true">
      <p className={styles.muted} role="status">
        Carregando…
      </p>
    </main>
  );
}
