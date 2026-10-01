import Link from "next/link";

import styles from "../../ui.module.css";

export default function JobNotFound() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Job não encontrado</h1>
      <p className={styles.muted}>Este job não existe ou você não tem acesso a ele.</p>
      <p>
        <Link className={styles.link} href="/jobs">
          Voltar para meus jobs
        </Link>
      </p>
    </main>
  );
}
