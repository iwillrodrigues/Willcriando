import { describe, expect, it } from "vitest";

import {
  BRIEFING_MAX,
  briefingSchema,
  jobIdSchema,
  jobTitleSchema,
  normalizeTitle,
  safeNextPath,
  signInSchema,
  signUpSchema,
  TITLE_MAX,
} from "./validation";

describe("job title", () => {
  it("trims and collapses whitespace the way the database expects", () => {
    expect(normalizeTitle("  Lançamento \n de   inverno ")).toBe("Lançamento de inverno");
    expect(jobTitleSchema.parse("  Campanha   A ")).toBe("Campanha A");
  });

  it("rejects blank and overlong titles", () => {
    expect(jobTitleSchema.safeParse("   ").success).toBe(false);
    expect(jobTitleSchema.safeParse("x".repeat(TITLE_MAX + 1)).success).toBe(false);
    expect(jobTitleSchema.safeParse("x".repeat(TITLE_MAX)).success).toBe(true);
  });
});

describe("briefing", () => {
  it("keeps the raw text unchanged", () => {
    const raw = "  Linha 1\n\nLinha 2  ";
    expect(briefingSchema.parse(raw)).toBe(raw);
  });

  it("rejects blank and overlong text", () => {
    expect(briefingSchema.safeParse(" \n\t ").success).toBe(false);
    expect(briefingSchema.safeParse("x".repeat(BRIEFING_MAX + 1)).success).toBe(false);
  });
});

describe("job id", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(jobIdSchema.safeParse("3f0b7a3e-2c1d-4e5f-8a9b-0c1d2e3f4a5b").success).toBe(true);
    expect(jobIdSchema.safeParse("1").success).toBe(false);
    expect(jobIdSchema.safeParse("../admin").success).toBe(false);
  });
});

describe("credentials", () => {
  it("requires a valid email and a password to sign in", () => {
    expect(signInSchema.safeParse({ email: "a@exemplo.test", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "nao-e-email", password: "x" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@exemplo.test", password: "" }).success).toBe(false);
  });

  it("requires a long enough, confirmed password to sign up", () => {
    const ok = { email: "a@exemplo.test", password: "senha-longa", confirmPassword: "senha-longa" };
    expect(signUpSchema.safeParse(ok).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, password: "curta", confirmPassword: "curta" }).success).toBe(false);
    const mismatch = signUpSchema.safeParse({ ...ok, confirmPassword: "outra-senha" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0].path).toEqual(["confirmPassword"]);
  });
});

describe("post-login redirect", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/jobs/abc")).toBe("/jobs/abc");
    expect(safeNextPath("https://mal.example")).toBe("/jobs");
    expect(safeNextPath("//mal.example")).toBe("/jobs");
    expect(safeNextPath("/\\mal.example")).toBe("/jobs");
    expect(safeNextPath("/jobs\n")).toBe("/jobs");
    expect(safeNextPath(undefined)).toBe("/jobs");
    expect(safeNextPath(["/jobs/a"])).toBe("/jobs");
  });
});
