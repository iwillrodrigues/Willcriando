import { z } from "zod";

/**
 * Structured AI output, in two layers.
 *
 * The *wire* schemas are sent to the model as the response format. They only
 * use types the structured-output format accepts. The *strict* schemas run on
 * our side after parsing and enforce what the product needs (lengths, counts,
 * catalog references). A response that passes the wire schema but fails the
 * strict one is rejected as invalid output, never stored.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------------------
// Briefing analysis + path recommendations
// ---------------------------------------------------------------------------

export const RECOMMENDATION_COUNT = 3;

export const analysisWireSchema = z.object({
  summary: z.string(),
  challenge: z.string(),
  audience: z.string(),
  tension: z.string(),
  human_truth: z.string(),
  constraints: z.array(z.string()),
  open_questions: z.array(z.string()),
  recommendations: z.array(z.object({ path_code: z.string(), reasoning: z.string() })),
});

export const ANALYSIS_LIST_MAX = 10;

/**
 * A list the model fills from the briefing (constraints, open questions).
 * A long briefing can yield more items than the screen needs, so extra and
 * blank items are dropped instead of rejecting the whole reading.
 */
const briefList = z
  .array(z.string())
  .transform((items) =>
    items
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, ANALYSIS_LIST_MAX),
  )
  .pipe(z.array(z.string().max(600)));

/** "Caminho 9.3", "9.3." and " 9.3 " all mean the catalog code "9.3". */
export function normalizePathCode(raw: string): string {
  return raw
    .trim()
    .replace(/^caminho\s+/i, "")
    .replace(/\.$/, "")
    .trim();
}

const analysisStrictBase = z.object({
  summary: text(1500),
  challenge: text(800),
  audience: text(800),
  tension: text(800),
  human_truth: text(800),
  constraints: briefList,
  open_questions: briefList,
  recommendations: z.array(z.object({ path_code: z.string().transform(normalizePathCode), reasoning: text(600) })),
});

export type AnalysisOutput = z.infer<typeof analysisStrictBase>;

/**
 * Strict check: exactly RECOMMENDATION_COUNT distinct selectable paths of the
 * catalog. Extra recommendations beyond that are dropped; fewer, repeated or
 * unknown codes reject the reading.
 */
export function analysisStrictSchema(selectableCodes: ReadonlySet<string>) {
  return analysisStrictBase
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.recommendations.slice(0, RECOMMENDATION_COUNT).forEach((rec, index) => {
        if (!selectableCodes.has(rec.path_code)) {
          ctx.addIssue({ code: "custom", message: "Recommended path is not in the catalog.", path: ["recommendations", index] });
        }
        if (seen.has(rec.path_code)) {
          ctx.addIssue({ code: "custom", message: "Recommended path repeated.", path: ["recommendations", index] });
        }
        seen.add(rec.path_code);
      });
      if (value.recommendations.length < RECOMMENDATION_COUNT) {
        ctx.addIssue({ code: "custom", message: "Too few recommendations.", path: ["recommendations"] });
      }
    })
    .transform((value) => ({ ...value, recommendations: value.recommendations.slice(0, RECOMMENDATION_COUNT) }));
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

export const CONCEPT_COUNT = { min: 3, max: 5 } as const;

export const conceptsWireSchema = z.object({
  concepts: z.array(z.object({ title: z.string(), line: z.string(), body: z.string() })),
});

export const conceptFieldsSchema = z.object({
  title: text(200),
  line: text(400),
  body: text(6000),
});

export const conceptsStrictSchema = z.object({
  concepts: z.array(conceptFieldsSchema).min(CONCEPT_COUNT.min).max(CONCEPT_COUNT.max),
});

export type ConceptsOutput = z.infer<typeof conceptsStrictSchema>;

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const presentationWireSchema = z.object({
  title: z.string(),
  intro: z.string(),
  slides: z.array(z.object({ concept_number: z.number().int(), heading: z.string(), text: z.string() })),
  closing: z.string(),
});

/** The model numbers finalists 1..n; each must appear exactly once, in order. */
export function presentationStrictSchema(finalistCount: number) {
  return z
    .object({
      title: text(200),
      intro: text(2000),
      slides: z
        .array(z.object({ concept_number: z.number().int(), heading: text(200), text: text(3000) }))
        .length(finalistCount),
      closing: text(2000),
    })
    .superRefine((value, ctx) => {
      value.slides.forEach((slide, index) => {
        if (slide.concept_number !== index + 1) {
          ctx.addIssue({ code: "custom", message: "Slides must follow the finalist order.", path: ["slides", index] });
        }
      });
    });
}

/** What is stored and edited: slides point at concept ids, not numbers. */
export const presentationContentSchema = z.object({
  title: text(200),
  intro: text(2000),
  slides: z
    .array(z.object({ concept_id: z.uuid(), heading: text(200), text: text(3000) }))
    .min(1)
    .max(10),
  closing: text(2000),
});

export type PresentationContent = z.infer<typeof presentationContentSchema>;

export function toPresentationContent(
  output: z.infer<ReturnType<typeof presentationStrictSchema>>,
  finalistIds: readonly string[],
): PresentationContent {
  return presentationContentSchema.parse({
    title: output.title,
    intro: output.intro,
    slides: output.slides.map((slide, index) => ({
      concept_id: finalistIds[index],
      heading: slide.heading,
      text: slide.text,
    })),
    closing: output.closing,
  });
}
