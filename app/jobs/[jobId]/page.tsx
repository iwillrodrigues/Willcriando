import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { generationErrorMessage, isConfigurationError } from "@/lib/errors";
import { ORIGIN_LABEL } from "@/lib/flow/labels";
import { getCurrentCatalog, getJobFlow, type RequestSummary } from "@/lib/flow/queries";
import { formatDateTime } from "@/lib/format";

import styles from "../../ui.module.css";
import { BriefingForm } from "./briefing-form";
import { analyzeBriefing, generateConcepts, generatePresentation } from "./flow-actions";
import { ConceptCard, GenerateForm, PresentationEditor, SelectPathForm } from "./flow-forms";

export const metadata: Metadata = { title: "Job · Trilha" };

function failedOf(request: RequestSummary | null) {
  if (!request || request.status !== "failed") return null;
  return {
    requestId: request.id,
    message: generationErrorMessage(request.error_code),
    canRetry: !isConfigurationError(request.error_code),
  };
}

function Provenance({ request }: { request: RequestSummary }) {
  return (
    <p className={styles.muted}>
      Gerado por IA em {formatDateTime(request.completed_at ?? request.created_at)} · modelo {request.served_model ?? request.model}
      {request.served_model && request.served_model !== request.model ? ` (pedido: ${request.model})` : ""} · prompt {request.prompt_version}
    </p>
  );
}

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await props.params;
  const user = await requireUser(`/jobs/${jobId}`);

  // Missing, malformed and foreign ids all end here, with the same page.
  const flow = await getJobFlow(user.id, jobId);
  if (!flow) notFound();
  const catalog = await getCurrentCatalog();

  const { job, analysis, analysisRequest, selection, conceptRequest, concepts, finalists, presentation, presentationRequest } = flow;
  const revision = job.currentRevision;
  const conceptTitles = Object.fromEntries(concepts.map((c) => [c.id, c.title]));
  const staleSelection = selection && revision && selection.briefing_revision_id !== revision.id;
  const pendingAnalysis = analysisRequest?.status === "pending";

  return (
    <main className={styles.page}>
      <p className={styles.muted}>
        <Link className={styles.link} href="/jobs">
          ← Meus jobs
        </Link>
      </p>
      <h1 className={styles.title}>{job.title}</h1>
      <p className={styles.muted}>
        Criado em {formatDateTime(job.created_at)}.{" "}
        <span className={`${styles.badge} ${styles.badgeAi}`}>IA</span> gerado por IA ·{" "}
        <span className={`${styles.badge} ${styles.badgeEditorial}`}>Catálogo</span> conteúdo editorial ·{" "}
        <span className={`${styles.badge} ${styles.badgeUser}`}>Você</span> suas decisões e edições
      </p>

      {/* 1. Briefing ------------------------------------------------------ */}
      <section className={styles.card} aria-labelledby="briefing">
        <p className={styles.step}>1 · Briefing</p>
        <h2 id="briefing">Briefing bruto</h2>
        <p className={styles.muted}>
          {revision
            ? `Revisão ${revision.revision_number}, salva em ${formatDateTime(revision.created_at)}. Cada salvamento cria uma nova revisão; as anteriores ficam guardadas.`
            : "Nenhuma revisão salva ainda. Cole ou escreva o briefing como você recebeu."}
        </p>
        <BriefingForm key={job.id} jobId={job.id} initialContent={revision?.content ?? ""} />
      </section>

      {/* 2. Analysis ------------------------------------------------------ */}
      <section className={styles.card} aria-labelledby="analise">
        <p className={styles.step}>2 · Análise com IA</p>
        <h2 id="analise">Análise do briefing</h2>
        {!revision ? (
          <p className={styles.muted}>Salve o briefing para analisar.</p>
        ) : !catalog ? (
          <p className={styles.notice}>
            O catálogo de 63 caminhos ainda não foi importado neste ambiente. A análise e as recomendações ficam disponíveis depois da importação.
          </p>
        ) : analysis ? (
          <>
            <div className={styles.row}>
              <span className={`${styles.badge} ${styles.badgeAi}`}>Gerado por IA</span>
              <span className={styles.muted}>Interpretação da IA sobre a revisão {revision.revision_number}. Confira antes de seguir.</span>
            </div>
            <dl className={styles.dl}>
              <dt>Resumo</dt>
              <dd>{analysis.output.summary}</dd>
              <dt>Desafio</dt>
              <dd>{analysis.output.challenge}</dd>
              <dt>Público</dt>
              <dd>{analysis.output.audience}</dd>
              <dt>Tensão</dt>
              <dd>{analysis.output.tension}</dd>
              <dt>Verdade humana</dt>
              <dd>{analysis.output.human_truth}</dd>
              {analysis.output.constraints.length > 0 && (
                <>
                  <dt>Restrições</dt>
                  <dd>{analysis.output.constraints.join(" · ")}</dd>
                </>
              )}
              {analysis.output.open_questions.length > 0 && (
                <>
                  <dt>Perguntas em aberto</dt>
                  <dd>{analysis.output.open_questions.join(" · ")}</dd>
                </>
              )}
            </dl>
            <Provenance request={analysis.request} />

            <h3 className={styles.sectionTitle}>Caminhos recomendados pela IA</h3>
            <p className={styles.muted}>Sugestões. Nenhum caminho fica ativo até você escolher.</p>
            <div className={styles.stack}>
              {analysis.recommendations.map((rec) => (
                <div key={rec.id} className={`${styles.item} ${selection?.recommendation_id === rec.id ? styles.itemActive : ""}`}>
                  <div className={styles.row}>
                    <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {rec.path.path_number}</span>
                    <h3>{rec.path.title}</h3>
                  </div>
                  <p className={styles.prose}>
                    <span className={`${styles.badge} ${styles.badgeAi}`}>Motivo da IA</span> {rec.reasoning}
                  </p>
                  {selection?.recommendation_id === rec.id ? (
                    <p className={styles.success}>Caminho ativo.</p>
                  ) : (
                    <SelectPathForm
                      jobId={job.id}
                      origin="recommended"
                      pathId={rec.path.id}
                      recommendationId={rec.id}
                      label="Escolher este caminho"
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <GenerateForm
            action={analyzeBriefing}
            jobId={job.id}
            label={`Analisar revisão ${revision.revision_number} com IA`}
            pendingLabel="Analisando…"
            disabled={pendingAnalysis}
            failed={failedOf(analysisRequest)}
          />
        )}
        {pendingAnalysis && !analysis && (
          <p className={styles.muted}>Uma análise está em andamento. Atualize a página em instantes.</p>
        )}
      </section>

      {/* 3. Path selection ------------------------------------------------ */}
      <section className={styles.card} aria-labelledby="caminho" id="caminho">
        <p className={styles.step}>3 · Caminho criativo</p>
        <h2 id="caminho-titulo">Caminho ativo</h2>
        {selection ? (
          <div className={`${styles.item} ${styles.itemActive}`}>
            <div className={styles.row}>
              <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {selection.path.path_number}</span>
              <h3>{selection.path.title}</h3>
            </div>
            <p className={styles.muted}>
              <span className={`${styles.badge} ${styles.badgeUser}`}>{ORIGIN_LABEL[selection.origin]}</span> em{" "}
              {formatDateTime(selection.created_at)}, sobre a revisão {selection.revision_number} do briefing.
            </p>
            {staleSelection && (
              <p className={styles.notice}>
                O briefing mudou depois desta escolha. Para gerar com a revisão mais nova, escolha o caminho de novo.
              </p>
            )}
          </div>
        ) : (
          <p className={styles.muted}>Nenhum caminho escolhido ainda. Escolha uma recomendação, explore o catálogo ou sorteie.</p>
        )}
        <div className={styles.row}>
          <Link className={styles.link} href={`/jobs/${job.id}/caminhos`}>
            Explorar os {catalog?.paths.length ?? 63} caminhos, escolher ou sortear →
          </Link>
        </div>
      </section>

      {/* 4. Apply + concepts ---------------------------------------------- */}
      <section className={styles.card} aria-labelledby="conceitos">
        <p className={styles.step}>4 · Aplicar caminho e gerar conceitos</p>
        <h2 id="conceitos">Conceitos</h2>
        {!selection ? (
          <p className={styles.muted}>Escolha um caminho para aplicá-lo ao briefing.</p>
        ) : (
          <>
            <details className={styles.details}>
              <summary>O que será aplicado: revisão {selection.revision_number} do briefing + caminho {selection.path.path_number}</summary>
              <div className={styles.stack}>
                <span className={`${styles.badge} ${styles.badgeEditorial}`}>Conteúdo editorial do catálogo</span>
                {selection.path.section && <p className={styles.muted}>Seção: {selection.path.section}</p>}
                {selection.path.content && <p className={styles.prose}>{selection.path.content}</p>}
                {selection.path.prompt_text && <p className={styles.prose}>{selection.path.prompt_text}</p>}
              </div>
            </details>
            {conceptRequest?.status === "succeeded" ? (
              <p className={styles.success}>Conceitos gerados para o caminho ativo.</p>
            ) : (
              <GenerateForm
                action={generateConcepts}
                jobId={job.id}
                selectionId={selection.id}
                label="Aplicar caminho e gerar conceitos com IA"
                pendingLabel="Gerando conceitos…"
                disabled={conceptRequest?.status === "pending"}
                failed={failedOf(conceptRequest)}
              />
            )}
            {conceptRequest?.status === "succeeded" && <Provenance request={conceptRequest} />}
          </>
        )}

        {concepts.length === 0 ? (
          <p className={styles.muted}>Nenhum conceito ainda.</p>
        ) : (
          <div className={styles.stack}>
            {concepts.map((concept) => (
              <ConceptCard
                key={concept.id}
                jobId={job.id}
                concept={concept}
                pathTitle={concept.path_title}
              />
            ))}
          </div>
        )}
      </section>

      {/* 5. Presentation -------------------------------------------------- */}
      <section className={styles.card} aria-labelledby="apresentacao">
        <p className={styles.step}>5 · Finalistas e apresentação</p>
        <h2 id="apresentacao">Apresentação</h2>
        <p className={styles.muted}>
          {finalists.length === 0
            ? "Marque os conceitos finalistas. Só você decide quais seguem."
            : `${finalists.length} ${finalists.length === 1 ? "finalista escolhido" : "finalistas escolhidos"} por você.`}
        </p>
        {finalists.length > 0 && (
          <GenerateForm
            action={generatePresentation}
            jobId={job.id}
            label={presentation ? "Gerar nova apresentação com os finalistas atuais" : "Gerar apresentação com IA"}
            pendingLabel="Montando apresentação…"
            disabled={presentationRequest?.status === "pending"}
            failed={failedOf(presentationRequest)}
          />
        )}
        {presentation ? (
          <>
            <div className={styles.row}>
              <span className={`${styles.badge} ${styles.badgeAi}`}>Gerado por IA</span>
              {presentation.edited_at && <span className={`${styles.badge} ${styles.badgeUser}`}>Editado por você</span>}
            </div>
            <Provenance request={presentation.request} />
            <PresentationEditor
              key={`${presentation.id}-${presentation.edited_at ?? ""}`}
              jobId={job.id}
              presentationId={presentation.id}
              content={presentation.content}
              conceptTitles={conceptTitles}
            />
          </>
        ) : (
          <p className={styles.muted}>Nenhuma apresentação ainda.</p>
        )}
      </section>
    </main>
  );
}
