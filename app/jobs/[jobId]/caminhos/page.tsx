import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { ORIGIN_LABEL } from "@/lib/flow/labels";
import { getCurrentCatalog, getJobFlow, getOwnDraw, type CatalogPath } from "@/lib/flow/queries";

import styles from "../../../ui.module.css";
import { drawRandomPath } from "../flow-actions";
import { SelectPathForm } from "../flow-forms";

export const metadata: Metadata = { title: "Caminhos · Trilha" };

function PathBody({ path }: { path: CatalogPath }) {
  return (
    <>
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

export default async function PathsPage(props: PageProps<"/jobs/[jobId]/caminhos">) {
  const { jobId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/jobs/${jobId}/caminhos`);

  const flow = await getJobFlow(user.id, jobId);
  if (!flow) notFound();
  const catalog = await getCurrentCatalog();

  const drawId = typeof search.sorteio === "string" ? search.sorteio : null;
  const draw = drawId ? await getOwnDraw(jobId, drawId) : null;
  const error = typeof search.erro === "string" ? search.erro.slice(0, 200) : null;
  const active = flow.selection;
  const hasBriefing = flow.job.currentRevision != null;

  const sections = new Map<string, CatalogPath[]>();
  for (const path of catalog?.paths ?? []) {
    const key = path.section ?? "Sem seção";
    sections.set(key, [...(sections.get(key) ?? []), path]);
  }

  return (
    <main className={styles.page}>
      <p className={styles.muted}>
        <Link className={styles.link} href={`/jobs/${jobId}`}>
          ← {flow.job.title}
        </Link>
      </p>
      <h1 className={styles.title}>Caminhos criativos</h1>
      <p className={styles.muted}>
        <span className={`${styles.badge} ${styles.badgeEditorial}`}>Catálogo editorial</span> Textos do catálogo, sem alteração.
        Escolher um caminho é sempre uma decisão sua.
      </p>

      {!catalog ? (
        <p className={styles.notice}>O catálogo de 67 caminhos ainda não foi importado neste ambiente.</p>
      ) : (
        <>
          {!hasBriefing && <p className={styles.notice}>Salve o briefing do job antes de escolher um caminho.</p>}
          {active && (
            <p className={styles.muted}>
              Ativo: caminho {active.path.path_number}, {active.path.title} ·{" "}
              <span className={`${styles.badge} ${styles.badgeUser}`}>{ORIGIN_LABEL[active.origin]}</span>
            </p>
          )}

          <section className={styles.card} aria-labelledby="sorteio" id="sorteio">
            <h2 id="sorteio-titulo">Sortear um caminho</h2>
            <p className={styles.muted}>O sorteio só propõe. O caminho fica ativo quando você confirma.</p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {draw && !draw.confirmed && (
              <div className={`${styles.item} ${styles.itemActive}`}>
                <div className={styles.row}>
                  <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {draw.path.path_number}</span>
                  <h3>{draw.path.title}</h3>
                </div>
                {draw.path.section && <p className={styles.muted}>Seção: {draw.path.section}</p>}
                <PathBody path={draw.path} />
                <SelectPathForm
                  jobId={jobId}
                  origin="random"
                  pathId={draw.path.id}
                  drawId={draw.id}
                  label="Confirmar este caminho sorteado"
                />
              </div>
            )}
            {draw?.confirmed && <p className={styles.success}>Este sorteio já foi confirmado.</p>}
            <form action={drawRandomPath}>
              <input type="hidden" name="jobId" value={jobId} />
              <button className={styles.secondaryButton} type="submit" disabled={!hasBriefing}>
                {draw ? "Sortear outro" : "Sortear um caminho"}
              </button>
            </form>
          </section>

          <section className={styles.card} aria-labelledby="catalogo">
            <h2 id="catalogo">Explorar os {catalog.paths.length} caminhos</h2>
            {[...sections.entries()].map(([section, paths]) => (
              <div key={section} className={styles.stack}>
                <h3 className={styles.sectionTitle}>{section}</h3>
                {paths.map((path) => (
                  <details key={path.id} className={`${styles.item} ${active?.path.id === path.id ? styles.itemActive : ""}`}>
                    <summary>
                      {path.path_number}. {path.title}
                      {active?.path.id === path.id ? " · ativo" : ""}
                    </summary>
                    <PathBody path={path} />
                    {hasBriefing && active?.path.id !== path.id && (
                      <SelectPathForm jobId={jobId} origin="manual" pathId={path.id} label="Escolher este caminho" secondary />
                    )}
                  </details>
                ))}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
