import { describe, expect, it } from "vitest";

import { isAuthPage, isProtectedPath } from "./proxy";

describe("route classification", () => {
  it("protects the job area only", () => {
    expect(isProtectedPath("/jobs")).toBe(true);
    expect(isProtectedPath("/jobs/3f0b7a3e-2c1d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(true);
    expect(isProtectedPath("/jobsx")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("recognizes the auth pages", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/cadastro")).toBe(true);
    expect(isAuthPage("/jobs")).toBe(false);
  });
});
