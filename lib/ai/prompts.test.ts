import { describe, expect, it } from "vitest";

import { analysisPrompt, conceptsPrompt, presentationPrompt, PROMPT_VERSIONS } from "./prompts";

const path = (n: number) => ({
  path_number: n,
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
    const catalog = Array.from({ length: 63 }, (_, i) => path(i + 1));
    const { system, user } = analysisPrompt("Briefing fictício.", catalog);
    for (const p of catalog) {
      expect(system).toContain(`<caminho numero="${p.path_number}">`);
      expect(system).toContain(p.content);
    }
    expect(user).toContain("Briefing fictício.");
    expect(system).toContain("exatamente 3");
  });

  it("passes the exact path content and instruction when applying a path", () => {
    const p = path(7);
    const { user } = conceptsPrompt({ briefing: "Briefing fictício.", path: p, analysis: null });
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
