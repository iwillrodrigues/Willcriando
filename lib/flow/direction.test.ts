import { describe, expect, it } from "vitest";

import { composeBriefing, directionSchema, DIRECTION_MARKER, splitBriefing, type Direction } from "./direction";

const direction: Direction = {
  challenge: "Fazer o inverno parecer convite, não ameaça.",
  audience: "Jovens adultos em capitais frias.",
  tension: "Querem sair, mas o frio vence.",
  human_truth: "Ninguém se arrepende de ter saído.",
};

describe("direction block", () => {
  it("round-trips a brief and its direction", () => {
    const content = composeBriefing("Lançar a coleção de inverno.\n\nVerba média.", direction);
    expect(content).toContain(DIRECTION_MARKER);
    expect(splitBriefing(content)).toEqual({ brief: "Lançar a coleção de inverno.\n\nVerba média.", direction });
  });

  it("leaves a brief without a block untouched", () => {
    expect(splitBriefing("Só o briefing.  ")).toEqual({ brief: "Só o briefing.  ", direction: null });
  });

  it("replaces the previous block instead of stacking", () => {
    const first = composeBriefing("Briefing.", direction);
    const { brief } = splitBriefing(first);
    const second = composeBriefing(brief, { ...direction, tension: "Outra tensão." });
    expect(second.split(DIRECTION_MARKER)).toHaveLength(2);
    expect(splitBriefing(second).direction?.tension).toBe("Outra tensão.");
  });

  it("removes the block when the direction is cleared", () => {
    const { brief } = splitBriefing(composeBriefing("Briefing.", direction));
    expect(composeBriefing(brief, null)).toBe("Briefing.");
  });

  it("keeps an incomplete block as brief text, so nothing typed is lost", () => {
    const content = `Briefing.\n\n${DIRECTION_MARKER}\nDesafio: só isso`;
    expect(splitBriefing(content)).toEqual({ brief: content, direction: null });
  });

  it("collapses line breaks and refuses empty or long fields", () => {
    expect(directionSchema.parse({ ...direction, tension: " Querem sair,\n mas o frio vence. " }).tension).toBe(
      "Querem sair, mas o frio vence.",
    );
    expect(directionSchema.safeParse({ ...direction, audience: "   " }).success).toBe(false);
    expect(directionSchema.safeParse({ ...direction, challenge: "x".repeat(801) }).success).toBe(false);
  });
});
