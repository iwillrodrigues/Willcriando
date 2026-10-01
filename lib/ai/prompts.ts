/**
 * Prompt builders. Pure functions, so they can be tested without the API.
 *
 * Editorial path content is passed verbatim between explicit delimiters. The
 * model is told to apply it, never to rewrite it. Bump a version whenever its
 * prompt changes: the version is part of the idempotency payload and of the
 * provenance stored with every result.
 */

export const PROMPT_VERSIONS = {
  analysis: "analysis-2026-10-01.2",
  concepts: "concepts-2026-10-01.1",
  presentation: "presentation-2026-09-30.1",
} as const;

export type CatalogPathForPrompt = {
  editorial_code: string;
  title: string;
  section: string | null;
  content: string;
  prompt_text: string | null;
  /** False for a group header. Headers never enter the analysis catalog. */
  selectable?: boolean;
};

const STYLE = [
  "Escreva em português do Brasil.",
  "Frases curtas, verbos fortes, linguagem de gente.",
  "Evite adjetivos vazios (inovador, impactante, revolucionário) e jargão publicitário.",
  "Não invente fatos, números, marcas ou dados que não estejam no briefing.",
].join("\n");

/**
 * The catalog the model chooses from: selectable paths only, each with its
 * code, title and editorial text verbatim (page body and "Texto (prompt)").
 * No section or other metadata.
 */
function catalogBlock(paths: readonly CatalogPathForPrompt[]): string {
  return paths
    .filter((p) => p.selectable !== false)
    .map((p) =>
      [
        `<caminho codigo="${p.editorial_code}">`,
        `Título: ${p.title}`,
        p.content ? `Conteúdo:\n${p.content}` : null,
        p.prompt_text ? `Texto do caminho:\n${p.prompt_text}` : null,
        "</caminho>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function analysisPrompt(briefing: string, catalog: readonly CatalogPathForPrompt[]) {
  const system = [
    "Você é um planejador criativo sênior de uma agência de publicidade.",
    "Sua tarefa: ler um briefing bruto, extrair os insumos criativos e recomendar caminhos do catálogo editorial.",
    STYLE,
    "",
    "Campos da análise:",
    "summary: o pedido em até 3 frases.",
    "challenge: o problema de comunicação, em uma frase.",
    "audience: quem precisa ser tocado e o que já pensa hoje.",
    "tension: o conflito que a ideia precisa resolver.",
    "human_truth: a verdade humana que sustenta a ideia, dita em uma frase.",
    "constraints: obrigatórios, restrições e limites citados no briefing.",
    "open_questions: o que falta no briefing para decidir bem. Lista vazia se nada faltar.",
    "",
    `recommendations: exatamente 3 caminhos DIFERENTES do catálogo abaixo, do mais para o menos adequado.`,
    "Em path_code, use exatamente o código de um caminho do catálogo, como aparece no atributo codigo. Em reasoning, até 2 frases ligando o caminho a este briefing.",
    "As recomendações são sugestões. Quem escolhe o caminho é a pessoa criativa.",
    "",
    "Catálogo editorial (não reescreva, apenas consulte):",
    catalogBlock(catalog),
  ].join("\n");

  const user = ["Briefing bruto:", "<briefing>", briefing, "</briefing>"].join("\n");
  return { system, user };
}

export type AnalysisForPrompt = {
  summary: string;
  challenge: string;
  audience: string;
  tension: string;
  human_truth: string;
};

export function conceptsPrompt(input: {
  briefing: string;
  path: CatalogPathForPrompt;
  analysis: AnalysisForPrompt | null;
}) {
  const system = [
    "Você é um diretor de criação. Aplique um caminho criativo do catálogo editorial a um briefing e gere conceitos.",
    STYLE,
    "",
    "Gere de 3 a 5 conceitos realmente diferentes entre si, todos nascidos do caminho indicado.",
    "title: nome do conceito, até 6 palavras.",
    "line: a ideia em uma frase que se defende sozinha, sem precisar de explicação.",
    "body: como a ideia vive no mundo (o gesto principal, a execução central e por que resolve a tensão), em até 120 palavras.",
    "Siga o método do caminho. Não altere nem resuma o texto do caminho na resposta.",
  ].join("\n");

  const analysis = input.analysis
    ? [
        "Análise do briefing (gerada por IA e revisada pela pessoa criativa):",
        `<analise>`,
        `Resumo: ${input.analysis.summary}`,
        `Desafio: ${input.analysis.challenge}`,
        `Público: ${input.analysis.audience}`,
        `Tensão: ${input.analysis.tension}`,
        `Verdade humana: ${input.analysis.human_truth}`,
        `</analise>`,
      ].join("\n")
    : null;

  const user = [
    "Briefing bruto:",
    "<briefing>",
    input.briefing,
    "</briefing>",
    "",
    analysis,
    "",
    `Caminho escolhido (conteúdo editorial, use como método):`,
    `<caminho codigo="${input.path.editorial_code}">`,
    `Título: ${input.path.title}`,
    input.path.section ? `Seção: ${input.path.section}` : null,
    input.path.content ? `Conteúdo:\n${input.path.content}` : null,
    input.path.prompt_text ? `Instrução do caminho:\n${input.path.prompt_text}` : null,
    "</caminho>",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { system, user };
}

export type FinalistForPrompt = { title: string; line: string; body: string };

export function presentationPrompt(input: { briefingSummary: string | null; pathTitle: string | null; finalists: readonly FinalistForPrompt[] }) {
  const system = [
    "Você monta apresentações simples de conceitos criativos para um cliente.",
    STYLE,
    "",
    "title: título da apresentação.",
    "intro: o desafio e a verdade que guiou o trabalho, em até 3 frases.",
    "slides: um slide por conceito finalista, na mesma ordem e com o mesmo número recebido em concept_number.",
    "heading: o nome do conceito. text: a ideia e por que ela funciona, em até 80 palavras.",
    "closing: um fechamento curto que convida à decisão.",
    "Não crie conceitos novos e não descarte finalistas.",
  ].join("\n");

  const user = [
    input.briefingSummary ? `Resumo do briefing: ${input.briefingSummary}` : null,
    input.pathTitle ? `Caminho criativo aplicado: ${input.pathTitle}` : null,
    "Conceitos finalistas escolhidos pela pessoa criativa:",
    ...input.finalists.map((f, index) =>
      [`<conceito numero="${index + 1}">`, `Título: ${f.title}`, `Linha: ${f.line}`, `Corpo: ${f.body}`, "</conceito>"].join("\n"),
    ),
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { system, user };
}
