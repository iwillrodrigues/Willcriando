import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listOwnJobs } from "@/lib/jobs/queries";

import styles from "../ui.module.css";
import { CreateJobForm } from "./create-job-form";

export const metadata: Metadata = { title: "Meus jobs · Trilha" };

export default async function JobsPage() {
  const user = await requireUser("/jobs");
  const jobs = await listOwnJobs(user.id);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Meus jobs</h1>

      <section className={styles.card} aria-labelledby="novo-job">
        <h2 id="novo-job">Novo job</h2>
        <CreateJobForm />
      </section>

      <section aria-labelledby="lista-jobs" className={styles.form}>
        <h2 id="lista-jobs" className={styles.muted}>
          {jobs.length === 0 ? "Nenhum job ainda" : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
        </h2>
        {jobs.length === 0 ? (
          <p className={styles.notice}>Crie seu primeiro job acima para colar ou escrever o briefing.</p>
        ) : (
          <ul className={styles.list}>
            {jobs.map((job) => (
              <li key={job.id}>
                <Link className={styles.jobLink} href={`/jobs/${job.id}`}>
                  <span className={styles.jobTitle}>{job.title}</span>
                  <span className={styles.muted}>Atualizado em {formatDateTime(job.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
