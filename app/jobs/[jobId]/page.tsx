import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getOwnJob } from "@/lib/jobs/queries";

import styles from "../../ui.module.css";
import { BriefingForm } from "./briefing-form";

export const metadata: Metadata = { title: "Job · Trilha" };

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await props.params;
  const user = await requireUser(`/jobs/${jobId}`);

  // Missing, malformed and foreign ids all end here, with the same page.
  const job = await getOwnJob(user.id, jobId);
  if (!job) notFound();

  const revision = job.currentRevision;

  return (
    <main className={styles.page}>
      <p className={styles.muted}>
        <Link className={styles.link} href="/jobs">
          ← Meus jobs
        </Link>
      </p>
      <h1 className={styles.title}>{job.title}</h1>
      <p className={styles.muted}>Criado em {formatDateTime(job.created_at)}</p>

      <section className={styles.card} aria-labelledby="briefing">
        <h2 id="briefing">Briefing bruto</h2>
        <p className={styles.muted}>
          {revision
            ? `Revisão ${revision.revision_number}, salva em ${formatDateTime(revision.created_at)}. Cada salvamento cria uma nova revisão; as anteriores ficam guardadas.`
            : "Nenhuma revisão salva ainda. Cole ou escreva o briefing como você recebeu."}
        </p>
        <BriefingForm
          // Keyed by job, not revision: the form keeps its "saved" message after
          // a save, and compares the text against the newest saved revision.
          key={job.id}
          jobId={job.id}
          initialContent={revision?.content ?? ""}
        />
      </section>

      <p className={styles.notice}>
        Análise com IA, caminhos criativos, conceitos, finalistas e apresentação ainda não fazem parte desta versão.
      </p>
    </main>
  );
}
