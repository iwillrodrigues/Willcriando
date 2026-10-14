import type { CatalogPath } from "@/lib/flow/catalog-path";

import styles from "../../ui.module.css";

/** Editorial text of a catalog path, shown exactly as imported. */
export function PathBody({ path }: { path: CatalogPath }) {
  return (
    <>
      {path.section && <p className={styles.muted}>Seção: {path.section}</p>}
      {path.content && <p className={styles.prose}>{path.content}</p>}
      {path.prompt_text && (
        <details className={styles.details}>
          <summary>Instrução do caminho</summary>
          <p className={styles.prose}>{path.prompt_text}</p>
        </details>
      )}
    </>
  );
}
