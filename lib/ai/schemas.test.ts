import { describe, expect, it } from "vitest";

import {
  analysisStrictSchema,
  conceptsStrictSchema,
  presentationContentSchema,
  presentationStrictSchema,
  toPresentationContent,
} from "./schemas";

const catalog = new Set(Array.from({ length: 67 }, (_, i) => i + 1));

const analysis = (recs: { path_number: number; reasoning: string }[]) => ({
  summary: "Resumo fictício.",
  challenge: "Desafio fictício.",
  audience: "Público fictício.",
  tension: "Tensão fictícia.",
  human_truth: "Verdade fictícia.",
  constraints: [],
  open_questions: ["Qual o prazo?"],
  recommendations: recs,
});

describe("analysis output", () => {
  it("accepts three distinct catalog paths", () => {
    const value = analysis([
      { path_number: 1, reasoning: "a" },
      { path_number: 2, reasoning: "b" },
      { path_number: 67, reasoning: "c" },
    ]);
    expect(analysisStrictSchema(catalog).safeParse(value).success).toBe(true);
  });

  it("rejects a path that is not in the catalog", () => {
    const value = analysis([
      { path_number: 1, reasoning: "a" },
      { path_number: 2, reasoning: "b" },
      { path_number: 68, reasoning: "c" },
    ]);
    expect(analysisStrictSchema(catalog).safeParse(value).success).toBe(false);
  });

  it("rejects repeated paths and the wrong number of recommendations", () => {
    const repeated = analysis([
      { path_number: 5, reasoning: "a" },
      { path_number: 5, reasoning: "b" },
      { path_number: 6, reasoning: "c" },
    ]);
    expect(analysisStrictSchema(catalog).safeParse(repeated).success).toBe(false);
    expect(analysisStrictSchema(catalog).safeParse(analysis([{ path_number: 1, reasoning: "a" }])).success).toBe(false);
  });

  it("rejects blank interpretation fields", () => {
    const value = { ...analysis([
      { path_number: 1, reasoning: "a" },
      { path_number: 2, reasoning: "b" },
      { path_number: 3, reasoning: "c" },
    ]), tension: "   " };
    expect(analysisStrictSchema(catalog).safeParse(value).success).toBe(false);
  });
});

describe("concepts output", () => {
  const concept = { title: "Título", line: "Uma linha.", body: "Um corpo." };

  it("accepts 3 to 5 complete concepts", () => {
    expect(conceptsStrictSchema.safeParse({ concepts: [concept, concept, concept] }).success).toBe(true);
    expect(conceptsStrictSchema.safeParse({ concepts: Array(5).fill(concept) }).success).toBe(true);
  });

  it("rejects too few, too many or incomplete concepts", () => {
    expect(conceptsStrictSchema.safeParse({ concepts: [concept, concept] }).success).toBe(false);
    expect(conceptsStrictSchema.safeParse({ concepts: Array(6).fill(concept) }).success).toBe(false);
    expect(conceptsStrictSchema.safeParse({ concepts: [concept, concept, { ...concept, line: "" }] }).success).toBe(false);
  });
});

describe("presentation output", () => {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const output = {
    title: "Apresentação",
    intro: "Abertura.",
    slides: [
      { concept_number: 1, heading: "Um", text: "Texto um." },
      { concept_number: 2, heading: "Dois", text: "Texto dois." },
    ],
    closing: "Fechamento.",
  };

  it("needs one slide per finalist, in order", () => {
    expect(presentationStrictSchema(2).safeParse(output).success).toBe(true);
    expect(presentationStrictSchema(3).safeParse(output).success).toBe(false);
    const swapped = { ...output, slides: [output.slides[1], output.slides[0]] };
    expect(presentationStrictSchema(2).safeParse(swapped).success).toBe(false);
  });

  it("maps slides back to the finalist ids", () => {
    const parsed = presentationStrictSchema(2).parse(output);
    const content = toPresentationContent(parsed, ids);
    expect(content.slides.map((s) => s.concept_id)).toEqual(ids);
    expect(presentationContentSchema.safeParse(content).success).toBe(true);
  });
});
