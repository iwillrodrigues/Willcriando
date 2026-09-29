import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MissingEnvError,
  PUBLIC_PREFIX,
  publicVariableNames,
  readPublicEnv,
  readServerEnv,
  serverVariableNames,
} from "./schema";

// Obviously fake values. No real credential is used anywhere in the test suite.
const FAKE = "fake-value-for-tests";

describe("variable naming", () => {
  it("never gives a server-only variable the public prefix", () => {
    for (const name of serverVariableNames()) {
      expect(name.startsWith(PUBLIC_PREFIX)).toBe(false);
    }
  });

  it("gives every public variable the public prefix", () => {
    for (const name of publicVariableNames()) {
      expect(name.startsWith(PUBLIC_PREFIX)).toBe(true);
    }
  });

  it("lists exactly the schema variables in .env.example, with no values", () => {
    const path = fileURLToPath(new URL("../../.env.example", import.meta.url));
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const entries = lines.map((line) => line.split("="));
    for (const [, value] of entries) expect(value).toBe("");
    const names = entries.map(([name]) => name).sort();
    expect(names).toEqual([...serverVariableNames(), ...publicVariableNames()].sort());
  });
});

describe("readServerEnv", () => {
  it("returns only the variables of the requested integration", () => {
    const env = readServerEnv("notion", {
      NOTION_API_KEY: FAKE,
      NOTION_CREATIVE_PATHS_DATABASE_ID: "db-id",
      AI_PROVIDER_API_KEY: FAKE,
    });
    expect(env).toEqual({ NOTION_API_KEY: FAKE, NOTION_CREATIVE_PATHS_DATABASE_ID: "db-id" });
  });

  it("does not need other integrations to be configured", () => {
    expect(readServerEnv("ai", { AI_PROVIDER_API_KEY: FAKE })).toEqual({ AI_PROVIDER_API_KEY: FAKE });
  });

  it("throws MissingEnvError naming every missing variable", () => {
    expect(() => readServerEnv("notion", {})).toThrowError(MissingEnvError);
    try {
      readServerEnv("notion", {});
    } catch (error) {
      expect((error as MissingEnvError).integration).toBe("notion");
      expect((error as MissingEnvError).variables.sort()).toEqual(["NOTION_API_KEY", "NOTION_CREATIVE_PATHS_DATABASE_ID"]);
    }
  });

  it("treats empty and whitespace-only values as missing", () => {
    expect(() => readServerEnv("ai", { AI_PROVIDER_API_KEY: "   " })).toThrowError(/AI_PROVIDER_API_KEY/);
    expect(() => readServerEnv("ai", { AI_PROVIDER_API_KEY: "" })).toThrowError(/AI_PROVIDER_API_KEY/);
  });

  it("never includes a value in the error message", () => {
    const secretLooking = "sk-this-should-never-appear";
    try {
      readServerEnv("notion", { NOTION_API_KEY: secretLooking });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secretLooking);
      expect((error as MissingEnvError).variables).toEqual(["NOTION_CREATIVE_PATHS_DATABASE_ID"]);
    }
  });
});

describe("readPublicEnv", () => {
  it("accepts a valid URL and key", () => {
    const env = readPublicEnv("supabase", {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE,
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("rejects an invalid URL without echoing it", () => {
    const bad = "not a url";
    try {
      readPublicEnv("supabase", { NEXT_PUBLIC_SUPABASE_URL: bad, NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE });
      expect.unreachable();
    } catch (error) {
      expect((error as MissingEnvError).variables).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
      expect((error as Error).message).not.toContain(bad);
    }
  });
});
