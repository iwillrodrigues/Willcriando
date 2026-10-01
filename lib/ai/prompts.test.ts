import { describe, expect, it } from "vitest";

import { analysisPrompt, conceptsPrompt, presentationPrompt, PROMPT_VERSIONS } from "./prompts";

const path = (n: number | string) => ({
  editorial_code: String(n),
  title: `Caminho fictício ${n}`,
  section: "Seção fictícia",
  content: `Texto editorial fictício ${n}\ncom quebra de linha.`,
  prompt_text: `Instrução fictícia ${n}`,
});

describe("prompts", () => {
  it("has a version per generation kind", () => {
    expect(Object.keys(PROMPT_VERSIONS).sort()).toEqual(["analysis", "concepts", "presentation"]);
  });

  it("lists every catalog path in the analysis prompt, verbatim", () => {
    const catalog = [path("1.2"), path(2), path("9.3"), path("23.5"), path(52)];
    const { system, user } = analysisPrompt("Briefing fictício.", catalog);
    for (const p of catalog) {
      expect(system).toContain(`<caminho codigo="${p.editorial_code}">`);
      expect(system).toContain(p.content);
    }
    expect(user).toContain("Briefing fictício.");
    expect(system).toContain("exatamente 3");
  });

  it("gives each selectable path its code, title and preserved Texto (prompt), without metadata", () => {
    // The real catalog keeps its editorial text in "Texto (prompt)" with an empty body.
    const p = { ...path("9.3"), content: "", prompt_text: "Texto editorial fictício\ncom quebra." };
    const { system } = analysisPrompt("Briefing.", [p]);
    expect(system).toContain('<caminho codigo="9.3">\nTítulo: Caminho fictício 9.3\nTexto do caminho:\nTexto editorial fictício\ncom quebra.\n</caminho>');
    expect(system).not.toContain("Seção");
    expect(system).not.toContain("Conteúdo:");
  });

  it("never puts a group header in the analysis catalog, even if one is passed in", () => {
    const header = { ...path(9), title: "Cabeçalho fictício", content: "", prompt_text: null, selectable: false };
    const { system } = analysisPrompt("Briefing.", [path("1.2"), header, { ...path("9.1"), selectable: true }]);
    expect(system).toContain('<caminho codigo="1.2">');
    expect(system).toContain('<caminho codigo="9.1">');
    expect(system).not.toContain('<caminho codigo="9">');
    expect(system).not.toContain("Cabeçalho fictício");
  });

  it("passes the exact path content and instruction when applying a path", () => {
    const p = path("9.3");
    const { user } = conceptsPrompt({ briefing: "Briefing fictício.", path: p, analysis: null });
    expect(user).toContain('<caminho codigo="9.3">');
    expect(user).toContain(p.content);
    expect(user).toContain(p.prompt_text);
    expect(user).toContain("Briefing fictício.");
    expect(user).not.toContain("<analise>");
  });

  it("numbers finalists in order for the presentation", () => {
    const { user } = presentationPrompt({
      briefingSummary: null,
      pathTitle: "Caminho fictício",
      finalists: [
        { title: "A", line: "la", body: "ba" },
        { title: "B", line: "lb", body: "bb" },
      ],
    });
    expect(user.indexOf('<conceito numero="1">')).toBeLessThan(user.indexOf('<conceito numero="2">'));
    expect(user).toContain("Título: B");
  });
});
