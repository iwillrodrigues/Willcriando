import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { generationErrorMessage, isConfigurationError } from "@/lib/errors";
import { DIRECTION_FIELDS, splitBriefing, type Direction } from "@/lib/flow/direction";
import { ORIGIN_LABEL } from "@/lib/flow/labels";
import { getCurrentCatalog, getJobFlow, getOwnDraw, type RequestSummary } from "@/lib/flow/queries";
import { formatDateTime } from "@/lib/format";

import styles from "../../ui.module.css";
import { BriefingForm } from "./briefing-form";
import { CatalogBrowser } from "./catalog-browser";
import { ConceptBoard, type ConceptRun } from "./concept-board";
import { DirectionEditor } from "./direction-editor";
import { analyzeBriefing, drawRandomPath, generateConcepts, generatePresentation } from "./flow-actions";
import { GenerateForm, PresentationVersion, SelectPathForm } from "./flow-forms";
import { PathBody } from "./path-body";
import ws from "./workspace.module.css";

export const metadata: Metadata = { title: "Job · Trilha" };

type Mode = "ia" | "catalogo" | "sorteio";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "ia", label: "Pela IA", hint: "3 recomendados" },
  { id: "catalogo", label: "Pelo catálogo", hint: "você escolhe" },
  { id: "sorteio", label: "Pela sorte", hint: "um sorteio" },
];

function failedOf(request: RequestSummary | null) {
  if (!request || request.status !== "failed") return null;
  return {
    requestId: request.id,
    message: generationErrorMessage(request.error_code),
    canRetry: !isConfigurationError(request.error_code),
  };
}

function modelOf(request: RequestSummary): string {
  const served = request.served_model ?? request.model;
  return request.served_model && request.served_model !== request.model ? `${served} (pedido: ${request.model})` : served;
}

function Provenance({ request }: { request: RequestSummary }) {
  return (
    <p className={styles.muted}>
      Gerado por IA em {formatDateTime(request.completed_at ?? request.created_at)} · modelo {modelOf(request)} · prompt{" "}
      {request.prompt_version}
    </p>
  );
}

function Moment(props: {
  id: string;
  number: number;
  title: string;
  lead: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section id={props.id} className={`${ws.moment} ${props.done ? ws.momentDone : ""}`} aria-labelledby={`${props.id}-titulo`}>
      <div className={ws.momentHead}>
        <span className={ws.momentNumber} aria-hidden="true">
          {props.number}
        </span>
        <div>
          <h2 id={`${props.id}-titulo`} className={ws.momentTitle}>
            {props.title}
          </h2>
          <p className={ws.momentLead}>{props.lead}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function DirectionFacts({ direction, source }: { direction: Direction; source: "ai" | "user" }) {
  return (
    <div className={ws.grid2}>
      {DIRECTION_FIELDS.map((field) => (
        <div key={field.key} className={ws.fact}>
          <span className={ws.factLabel}>
            {field.label}{" "}
            <span className={`${styles.badge} ${source === "ai" ? styles.badgeAi : styles.badgeUser}`}>
              {source === "ai" ? "IA" : "Você"}
            </span>
          </span>
          <p className={ws.factText}>{direction[field.key]}</p>
        </div>
      ))}
    </div>
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export default async function JobPage(props: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/jobs/${jobId}`);

  // Missing, malformed and foreign ids all end here, with the same page.
  const flow = await getJobFlow(user.id, jobId);
  if (!flow) notFound();
  const catalog = await getCurrentCatalog();

  const { job, analysis, analysisRequest, selection, selections, conceptRequest, conceptRuns, concepts, finalists } = flow;
  const { presentations, presentationRequest } = flow;
  const revision = job.currentRevision;
  const split = revision ? splitBriefing(revision.content) : null;
  const humanDirection = split?.direction ?? null;
  const aiDirection: Direction | null = analysis
    ? {
        challenge: analysis.output.challenge,
        audience: analysis.output.audience,
        tension: analysis.output.tension,
        human_truth: analysis.output.human_truth,
      }
    : null;
  const pendingAnalysis = analysisRequest?.status === "pending";
  const staleSelection = selection && revision && selection.briefing_revision_id !== revision.id;
  const selectableCount = catalog?.paths.filter((p) => p.selectable).length ?? 0;

  // Moment 3: how to begin. The mode is in the URL, so it survives reloads and can be shared.
  const drawId = typeof search.sorteio === "string" ? search.sorteio : null;
  const draw = drawId ? await getOwnDraw(job.id, drawId) : null;
  const drawError = typeof search.erro === "string" ? search.erro.slice(0, 200) : null;
  const requestedMode = typeof search.modo === "string" ? search.modo : null;
  const mode: Mode =
    requestedMode === "ia" || requestedMode === "catalogo" || requestedMode === "sorteio"
      ? requestedMode
      : drawId || drawError
        ? "sorteio"
        : analysis
          ? "ia"
          : "catalogo";

  // Moment 4: concepts grouped by the run that produced them, newest first.
  const selectionById = new Map(selections.map((s) => [s.id, s]));
  const runs: ConceptRun[] = [];
  for (const concept of concepts) {
    let run = runs.find((r) => r.id === concept.generation_request_id);
    if (!run) {
      const sel = selectionById.get(concept.selection_id);
      const request = conceptRuns[concept.generation_request_id];
      const parts = [
        sel ? `${ORIGIN_LABEL[sel.origin]} em ${formatDateTime(sel.created_at)}` : null,
        sel ? `revisão ${sel.revision_number} do briefing` : null,
        request ? `gerado em ${formatDateTime(request.completed_at ?? request.created_at)} · modelo ${modelOf(request)}` : null,
      ].filter(Boolean);
      run = {
        id: concept.generation_request_id,
        pathCode: concept.path_code,
        pathTitle: concept.path_title ?? "",
        provenance: parts.join(" · "),
        concepts: [],
      };
      runs.push(run);
    }
    run.concepts.push(concept);
  }

  // Moment 5: the version on screen comes from the URL; default is the newest.
  const versionParam = typeof search.versao === "string" ? search.versao : null;
  const shownIndex = Math.max(0, presentations.findIndex((p) => p.id === versionParam));
  const shown = presentations[shownIndex] ?? null;
  const conceptTitles = Object.fromEntries(concepts.map((c) => [c.id, c.title]));
  const latest = presentations[0] ?? null;
  const finalistsChanged =
    latest != null && !sameIds(latest.concept_ids, finalists.map((f) => f.id));

  const done = {
    briefing: revision != null,
    direction: analysis != null || humanDirection != null,
    path: selection != null,
    ideas: finalists.length > 0,
    presentation: presentations.length > 0,
  };
  const steps = [
    { id: "briefing", name: "Briefing", done: done.briefing, status: revision ? `Revisão ${revision.revision_number}` : "Vazio" },
    {
      id: "direcao",
      name: "Direção",
      done: done.direction,
      status: humanDirection ? "Ajustada por você" : analysis ? "Lida pela IA" : "A revisar",
    },
    { id: "caminho", name: "Caminho", done: done.path, status: selection ? `Caminho ${selection.path.editorial_code}` : "A escolher" },
    {
      id: "ideias",
      name: "Ideias",
      done: done.ideas,
      status: concepts.length ? `${concepts.length} ideias · ${finalists.length} finalistas` : "Nenhuma",
    },
    {
      id: "apresentacao",
      name: "Apresentação",
      done: done.presentation,
      status: presentations.length ? `Versão ${presentations.length}` : "Nenhuma",
    },
  ];
  const nextStep = steps.find((s) => !s.done)?.id ?? null;
  const locked: Record<string, boolean> = {
    briefing: false,
    direcao: !done.briefing,
    caminho: !done.briefing,
    ideias: !done.path && concepts.length === 0,
    apresentacao: finalists.length === 0 && presentations.length === 0,
  };

  return (
    <div className={ws.shell}>
      <header className={ws.head}>
        <p className={styles.muted}>
          <Link className={styles.link} href="/jobs">
            ← Meus jobs
          </Link>
        </p>
        <h1 className={styles.title}>{job.title}</h1>
        <div className={ws.legend}>
          <span>Criado em {formatDateTime(job.created_at)}</span>
          <span>
            <span className={`${styles.badge} ${styles.badgeAi}`}>IA</span> gerado por IA
          </span>
          <span>
            <span className={`${styles.badge} ${styles.badgeEditorial}`}>Catálogo</span> texto editorial
          </span>
          <span>
            <span className={`${styles.badge} ${styles.badgeUser}`}>Você</span> suas decisões
          </span>
        </div>
      </header>

      <nav className={ws.rail} aria-label="Momentos do job">
        <ol className={ws.railList}>
          {steps.map((step, index) => (
            <li key={step.id}>
              <a
                href={`#${step.id}`}
                className={`${ws.railLink} ${step.done ? ws.railDone : ""} ${step.id === nextStep ? ws.railNext : ""} ${locked[step.id] ? ws.railLocked : ""}`}
                aria-current={step.id === nextStep ? "step" : undefined}
              >
                <span className={ws.railNumber}>{step.done ? "✓" : index + 1}</span>
                <span className={ws.railName}>{step.name}</span>
                <span className={ws.railStatus}>{step.status}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main className={ws.moments}>
        {/* 1. Briefing ---------------------------------------------------- */}
        <Moment
          id="briefing"
          number={1}
          title="Briefing"
          lead="Cole como chegou. Cada salvamento vira uma revisão; as anteriores ficam guardadas."
          done={done.briefing}
        >
          {revision && (
            <p className={styles.muted}>
              Revisão {revision.revision_number}, salva em {formatDateTime(revision.created_at)}.
            </p>
          )}
          <BriefingForm
            key={job.id}
            jobId={job.id}
            initialContent={split?.brief ?? ""}
            keepsDirection={humanDirection != null}
          />
        </Moment>

        {/* 2. Direction --------------------------------------------------- */}
        <Moment
          id="direcao"
          number={2}
          title="Direção"
          lead="O que o briefing pede de verdade. A IA propõe a leitura; você corrige o que não for verdade."
          done={done.direction}
        >
          {!revision ? (
            <p className={ws.locked}>Salve o briefing para ler a direção.</p>
          ) : (
            <>
              {analysis && <p className={ws.lead}>{analysis.output.summary}</p>}

              {humanDirection ? (
                <>
                  <p className={styles.muted}>
                    Direção ajustada por você na revisão {revision.revision_number}. A IA lê esta direção junto com o briefing.
                  </p>
                  <DirectionFacts direction={humanDirection} source="user" />
                </>
              ) : aiDirection ? (
                <DirectionFacts direction={aiDirection} source="ai" />
              ) : null}

              {analysis && (analysis.output.constraints.length > 0 || analysis.output.open_questions.length > 0) && (
                <div className={ws.grid2}>
                  {analysis.output.constraints.length > 0 && (
                    <div className={ws.fact}>
                      <span className={ws.factLabel}>Restrições</span>
                      <ul className={styles.prose}>
                        {analysis.output.constraints.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.output.open_questions.length > 0 && (
                    <div className={ws.fact}>
                      <span className={ws.factLabel}>Perguntas em aberto</span>
                      <ul className={styles.prose}>
                        {analysis.output.open_questions.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {analysis && <Provenance request={analysis.request} />}

              {!analysis &&
                (!catalog ? (
                  <p className={styles.notice}>
                    O catálogo de caminhos ainda não foi importado neste ambiente. A leitura com IA e as recomendações ficam
                    disponíveis depois da importação.
                  </p>
                ) : (
                  <>
                    <p className={styles.muted}>
                      {humanDirection
                        ? `Peça uma leitura da revisão ${revision.revision_number} para receber caminhos recomendados. A IA considera a sua direção.`
                        : `A IA lê a revisão ${revision.revision_number}, propõe a direção e recomenda 3 caminhos do catálogo. Nada fica escolhido.`}
                    </p>
                    <GenerateForm
                      action={analyzeBriefing}
                      jobId={job.id}
                      label={`Ler a revisão ${revision.revision_number} com IA`}
                      pendingLabel="Lendo o briefing…"
                      disabled={pendingAnalysis}
                      failed={failedOf(analysisRequest)}
                    />
                    {pendingAnalysis && (
                      <p className={styles.muted}>Uma leitura está em andamento. Atualize a página em instantes.</p>
                    )}
                  </>
                ))}

              <DirectionEditor
                key={revision.id}
                jobId={job.id}
                initial={humanDirection ?? aiDirection}
                adjusted={humanDirection != null}
                nextRevision={revision.revision_number + 1}
              />
            </>
          )}
        </Moment>

        {/* 3. Path -------------------------------------------------------- */}
        <Moment
          id="caminho"
          number={3}
          title="Caminho"
          lead="Escolha por onde começar: pela IA, pelo catálogo ou pela sorte. Nada fica ativo até você confirmar."
          done={done.path}
        >
          {selection && (
            <div className={`${styles.item} ${styles.itemActive}`}>
              <p className={styles.step}>Caminho ativo</p>
              <div className={styles.row}>
                <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {selection.path.editorial_code}</span>
                <h3>{selection.path.title}</h3>
              </div>
              <p className={styles.muted}>
                <span className={`${styles.badge} ${styles.badgeUser}`}>{ORIGIN_LABEL[selection.origin]}</span> em{" "}
                {formatDateTime(selection.created_at)}, sobre a revisão {selection.revision_number} do briefing.
              </p>
              {staleSelection && (
                <p className={styles.notice}>
                  O briefing mudou depois desta escolha. Para gerar ideias com a revisão {revision?.revision_number}, escolha um
                  caminho de novo.
                </p>
              )}
            </div>
          )}

          {!revision ? (
            <p className={ws.locked}>Salve o briefing para escolher um caminho.</p>
          ) : !catalog ? (
            <p className={styles.notice}>O catálogo de caminhos ainda não foi importado neste ambiente.</p>
          ) : (
            <>
              <nav className={ws.tabs} aria-label="Como começar">
                {MODES.map((m) => (
                  <Link
                    key={m.id}
                    href={`/jobs/${job.id}?modo=${m.id}#caminho`}
                    className={`${ws.tab} ${mode === m.id ? ws.tabActive : ""}`}
                    aria-current={mode === m.id ? "page" : undefined}
                    scroll={false}
                  >
                    {m.label}
                    <span className={ws.tabHint}>{m.id === "catalogo" ? `${selectableCount} caminhos` : m.hint}</span>
                  </Link>
                ))}
              </nav>

              {mode === "ia" && (
                <div className={ws.panel}>
                  {!analysis ? (
                    <p className={ws.locked}>
                      As recomendações saem da leitura da IA. Peça a leitura no{" "}
                      <a className={styles.link} href="#direcao">
                        momento 2
                      </a>
                      , ou comece pelo catálogo ou pela sorte.
                    </p>
                  ) : (
                    <>
                      <p className={styles.muted}>Sugestões para a revisão {revision.revision_number}. Você decide qual abrir.</p>
                      {analysis.recommendations.map((rec) => {
                        const active = selection?.recommendation_id === rec.id;
                        return (
                          <div key={rec.id} className={`${styles.item} ${active ? styles.itemActive : ""}`}>
                            <div className={styles.row}>
                              <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {rec.path.editorial_code}</span>
                              <h3>{rec.path.title}</h3>
                            </div>
                            <p className={styles.prose}>
                              <span className={`${styles.badge} ${styles.badgeAi}`}>Por que a IA sugere</span> {rec.reasoning}
                            </p>
                            <details className={styles.details}>
                              <summary>Ler o caminho no catálogo</summary>
                              <PathBody path={rec.path} />
                            </details>
                            {active ? (
                              <p className={styles.success}>Caminho ativo.</p>
                            ) : (
                              <SelectPathForm
                                jobId={job.id}
                                origin="recommended"
                                pathId={rec.path.id}
                                recommendationId={rec.id}
                                label="Começar por este caminho"
                              />
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {mode === "catalogo" && (
                <CatalogBrowser
                  jobId={job.id}
                  paths={catalog.paths}
                  activePathId={selection?.path.id ?? null}
                  canSelect={revision != null}
                />
              )}

              {mode === "sorteio" && (
                <div className={ws.panel}>
                  <p className={styles.muted}>
                    O sorteio tira um caminho do catálogo, sem IA. Ele só propõe: o caminho fica ativo quando você confirma.
                  </p>
                  {drawError && (
                    <p className={styles.error} role="alert">
                      {drawError}
                    </p>
                  )}
                  {draw && !draw.confirmed && (
                    <div className={ws.drawCard}>
                      <p className={styles.step}>Sorteado</p>
                      <div className={styles.row}>
                        <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {draw.path.editorial_code}</span>
                        <h3>{draw.path.title}</h3>
                      </div>
                      <PathBody path={draw.path} />
                      <SelectPathForm
                        jobId={job.id}
                        origin="random"
                        pathId={draw.path.id}
                        drawId={draw.id}
                        label="Começar por este caminho"
                      />
                    </div>
                  )}
                  {draw?.confirmed && <p className={styles.success}>Este sorteio já foi confirmado.</p>}
                  <form action={drawRandomPath}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button className={draw ? styles.secondaryButton : styles.button} type="submit">
                      {draw ? "Sortear outro" : "Sortear um caminho"}
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </Moment>

        {/* 4. Ideas ------------------------------------------------------- */}
        <Moment
          id="ideias"
          number={4}
          title="Ideias"
          lead="Aplique o caminho ao briefing, gere ideias, edite e marque as finalistas."
          done={done.ideas}
        >
          {!selection ? (
            <p className={ws.locked}>Escolha um caminho no momento 3 para desenvolver ideias.</p>
          ) : (
            <div className={ws.apply}>
              <p className={styles.muted}>
                Aplicar: revisão {selection.revision_number} do briefing +{" "}
                <span className={`${styles.badge} ${styles.badgeEditorial}`}>Caminho {selection.path.editorial_code}</span>{" "}
                {selection.path.title}
              </p>
              {conceptRequest?.status === "succeeded" ? (
                <p className={styles.muted}>
                  Esta escolha já gerou a sua rodada. Para outra rodada, escolha um caminho de novo no momento 3.
                </p>
              ) : (
                <GenerateForm
                  action={generateConcepts}
                  jobId={job.id}
                  selectionId={selection.id}
                  label="Gerar ideias com este caminho"
                  pendingLabel="Gerando ideias…"
                  disabled={conceptRequest?.status === "pending"}
                  failed={failedOf(conceptRequest)}
                />
              )}
            </div>
          )}

          {runs.length > 0 ? (
            <ConceptBoard jobId={job.id} runs={runs} />
          ) : (
            selection && <p className={styles.muted}>Nenhuma ideia ainda.</p>
          )}
        </Moment>

        {/* 5. Presentation ------------------------------------------------ */}
        <Moment
          id="apresentacao"
          number={5}
          title="Apresentação"
          lead="Monte a apresentação com as finalistas. Cada geração é uma nova versão; nenhuma se perde."
          done={done.presentation}
        >
          {finalists.length === 0 && presentations.length === 0 ? (
            <p className={ws.locked}>Marque pelo menos uma ideia como finalista no momento 4.</p>
          ) : (
            <>
              {finalists.length > 0 ? (
                <div className={styles.stack}>
                  <p className={styles.muted}>
                    {finalists.length} {finalists.length === 1 ? "finalista escolhida" : "finalistas escolhidas"} por você:
                  </p>
                  <ul className={ws.chips}>
                    {finalists.map((f) => (
                      <li key={f.id} className={ws.chip}>
                        {f.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className={styles.muted}>Nenhuma finalista marcada agora. As versões abaixo continuam guardadas.</p>
              )}

              {finalistsChanged && finalists.length > 0 && (
                <p className={styles.notice}>
                  As finalistas mudaram desde a versão {presentations.length}. Gere uma nova versão para incluí-las.
                </p>
              )}

              {finalists.length > 0 && (
                <GenerateForm
                  action={generatePresentation}
                  jobId={job.id}
                  label={presentations.length ? `Gerar a versão ${presentations.length + 1}` : "Montar a apresentação com IA"}
                  pendingLabel="Montando a apresentação…"
                  disabled={presentationRequest?.status === "pending"}
                  failed={failedOf(presentationRequest)}
                />
              )}

              {presentations.length > 1 && (
                <ol className={ws.versions} aria-label="Versões da apresentação">
                  {presentations.map((p, index) => {
                    const number = presentations.length - index;
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/jobs/${job.id}?versao=${p.id}#apresentacao`}
                          scroll={false}
                          className={`${ws.version} ${index === shownIndex ? ws.versionActive : ""}`}
                          aria-current={index === shownIndex ? "true" : undefined}
                        >
                          <strong>
                            Versão {number}
                            {index === 0 ? " · mais recente" : ""}
                          </strong>
                          <span className={styles.muted}>
                            {p.concept_ids.length} {p.concept_ids.length === 1 ? "ideia" : "ideias"} · {formatDateTime(p.created_at)}
                            {p.edited_at ? " · editada por você" : ""}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}

              {shown && (
                <div className={styles.stack}>
                  <div className={styles.row}>
                    <strong>Versão {presentations.length - shownIndex}</strong>
                    <span className={`${styles.badge} ${styles.badgeAi}`}>Gerada por IA</span>
                    {shown.edited_at && <span className={`${styles.badge} ${styles.badgeUser}`}>Editada por você</span>}
                  </div>
                  <Provenance request={shown.request} />
                  <PresentationVersion
                    key={`${shown.id}-${shown.edited_at ?? ""}`}
                    jobId={job.id}
                    presentationId={shown.id}
                    content={shown.content}
                    conceptTitles={conceptTitles}
                  />
                </div>
              )}
            </>
          )}
        </Moment>
      </main>
    </div>
  );
}
