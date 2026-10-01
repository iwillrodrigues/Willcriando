import { describe, expect, it } from "vitest";

import { authErrorMessage, dbErrorMessage, GENERIC_ERROR } from "./errors";

describe("auth error messages", () => {
  it("maps known codes to Portuguese messages", () => {
    expect(authErrorMessage("invalid_credentials")).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage("email_not_confirmed")).toMatch(/Confirme seu e-mail/);
    expect(authErrorMessage("weak_password")).toMatch(/Senha fraca/);
  });

  it("does not reveal whether an account already exists", () => {
    expect(authErrorMessage("user_already_exists")).toBe(authErrorMessage("email_exists"));
    expect(authErrorMessage("user_already_exists")).not.toMatch(/existe|cadastrad/i);
  });

  it("falls back to a generic message for unknown or missing codes", () => {
    expect(authErrorMessage("something_new")).toBe(GENERIC_ERROR);
    expect(authErrorMessage(undefined)).toBe(GENERIC_ERROR);
    expect(authErrorMessage("__proto__")).toBe(GENERIC_ERROR);
  });
});

describe("database error messages", () => {
  it("maps the S1 function error keys", () => {
    expect(dbErrorMessage({ message: "TRILHA_JOB_NOT_FOUND", code: "P0002" })).toBe("Job não encontrado ou sem acesso.");
    expect(dbErrorMessage({ message: "TRILHA_UNAUTHENTICATED", code: "42501" })).toMatch(/sessão expirou/);
    expect(dbErrorMessage({ message: "TRILHA_INVALID_CONTENT", code: "22023" })).toMatch(/briefing/);
  });

  it("never echoes raw database messages", () => {
    const raw = { message: 'duplicate key value violates unique constraint "x" detail secret', code: "XX000" };
    expect(dbErrorMessage(raw)).toBe(GENERIC_ERROR);
    expect(dbErrorMessage(null)).toBe(GENERIC_ERROR);
  });

  it("maps permission and check failures by SQLSTATE", () => {
    expect(dbErrorMessage({ message: "permission denied for table jobs", code: "42501" })).toMatch(/permissão/);
    expect(dbErrorMessage({ message: "new row violates check constraint", code: "23514" })).toMatch(/validação/);
  });
});
