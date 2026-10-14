import { z } from "zod";

/**
 * The direction the creative adjusts by hand.
 *
 * The AI analysis is immutable, so an adjusted direction is stored where the
 * creative's own text already lives: as a marked block at the end of a new,
 * immutable briefing revision. It travels with the briefing, so every later
 * analysis and concept generation reads it. These helpers split a revision
 * into the brief and that block, and put them back together.
 */

export const DIRECTION_MARKER = "=== Direção ajustada pelo criativo ===";

export const DIRECTION_FIELDS = [
  { key: "challenge", label: "Desafio" },
  { key: "audience", label: "Público" },
  { key: "tension", label: "Tensão" },
  { key: "human_truth", label: "Verdade humana" },
] as const;

export type DirectionKey = (typeof DIRECTION_FIELDS)[number]["key"];
export type Direction = Record<DirectionKey, string>;

export const DIRECTION_FIELD_MAX = 800;

/** One line each: line breaks would break the block's line-based format. */
const directionField = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(DIRECTION_FIELD_MAX));

export const directionSchema = z.object({
  challenge: directionField,
  audience: directionField,
  tension: directionField,
  human_truth: directionField,
});

export type SplitBriefing = { brief: string; direction: Direction | null };

/**
 * Splits a revision at the last marker. A block that does not parse into all
 * four fields is treated as part of the brief, so nothing typed is ever lost.
 */
export function splitBriefing(content: string): SplitBriefing {
  const at = content.lastIndexOf(DIRECTION_MARKER);
  if (at === -1) return { brief: content, direction: null };

  const block = content.slice(at + DIRECTION_MARKER.length);
  const values: Partial<Direction> = {};
  for (const line of block.split("\n")) {
    for (const field of DIRECTION_FIELDS) {
      const prefix = `${field.label}:`;
      if (line.startsWith(prefix) && values[field.key] === undefined) {
        values[field.key] = line.slice(prefix.length).trim();
      }
    }
  }
  const parsed = directionSchema.safeParse(values);
  if (!parsed.success) return { brief: content, direction: null };
  return { brief: content.slice(0, at).trimEnd(), direction: parsed.data };
}

export function composeBriefing(brief: string, direction: Direction | null): string {
  const text = brief.trimEnd();
  if (!direction) return text;
  const lines = DIRECTION_FIELDS.map((field) => `${field.label}: ${direction[field.key]}`);
  return `${text}\n\n${DIRECTION_MARKER}\n${lines.join("\n")}\n`;
}
