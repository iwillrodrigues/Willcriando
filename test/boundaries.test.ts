import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Static checks on the source tree. They catch obvious boundary mistakes early;
 * they do not replace the server-only build check or the database tests.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, exts));
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

const sourceFiles = [...walk(join(root, "app"), [".ts", ".tsx"]), ...walk(join(root, "lib"), [".ts", ".tsx"]), join(root, "proxy.ts")].filter(
  (file) => !file.endsWith(".test.ts"),
);
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => relative(root, file);

describe("secrets", () => {
  it("reads the service role key only through lib/env and the admin factory", () => {
    const offenders = sourceFiles
      .filter((file) => !rel(file).startsWith("lib/env/") && rel(file) !== "lib/supabase/admin.ts")
      .filter((file) => read(file).includes("SUPABASE_SERVICE_ROLE_KEY") || read(file).includes("getSupabaseAdminEnv"));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never builds a Supabase client outside the three factories", () => {
    const offenders = sourceFiles
      .filter((file) => /createClient\s*\(|createServerClient\s*\(|createBrowserClient\s*\(/.test(read(file)))
      .map(rel);
    expect(offenders.sort()).toEqual(["lib/supabase/admin.ts", "lib/supabase/proxy.ts", "lib/supabase/server.ts"]);
  });

  it("uses the service-role client only in the generation orchestrator", () => {
    const users = sourceFiles
      .filter((file) => rel(file) !== "lib/supabase/admin.ts")
      .filter((file) => read(file).includes("createSupabaseAdminClient"))
      .map(rel);
    expect(users).toEqual(["lib/flow/generation.ts"]);
  });

  it("never reads a server secret from process.env outside lib/env", () => {
    const offenders = sourceFiles
      .filter((file) => !rel(file).startsWith("lib/env/"))
      .filter((file) => /process\.env\.(NOTION_\w+|AI_\w+|SUPABASE_SERVICE_ROLE_KEY)/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("calls the AI provider only from lib/ai/client.ts", () => {
    const users = sourceFiles.filter((file) => read(file).includes("@anthropic-ai/sdk")).map(rel);
    expect(users).toEqual(["lib/ai/client.ts"]);
  });
});

describe("server-only modules", () => {
  const serverOnly = [
    "lib/supabase/server.ts",
    "lib/supabase/admin.ts",
    "lib/auth/session.ts",
    "lib/jobs/queries.ts",
    "lib/env/server.ts",
    "lib/ai/client.ts",
    "lib/flow/queries.ts",
    "lib/flow/generation.ts",
  ];

  it.each(serverOnly)("%s imports server-only", (file) => {
    expect(read(join(root, file))).toMatch(/^import "server-only";/m);
  });

  it("client components do not import server-only modules", () => {
    const clientFiles = sourceFiles.filter((file) => /^["']use client["']/.test(read(file).trimStart()));
    expect(clientFiles.length).toBeGreaterThan(0);
    const forbidden = /from ["']@\/lib\/(supabase\/(server|admin)|auth\/session|jobs\/queries|env\/server|ai\/client|flow\/(queries|generation))["']/;
    expect(clientFiles.filter((file) => forbidden.test(read(file))).map(rel)).toEqual([]);
  });
});

describe("job deletion", () => {
  it("deletes only through the delete_job database function, never table by table", () => {
    const tableDeletes = sourceFiles.filter((file) => /\.delete\s*\(/.test(read(file))).map(rel);
    expect(tableDeletes).toEqual([]);
    const callers = sourceFiles.filter((file) => read(file).includes('rpc("delete_job"')).map(rel);
    expect(callers).toEqual(["app/jobs/actions.ts"]);
  });
});

describe("migrations", () => {
  const migrations = walk(join(root, "supabase", "migrations"), [".sql"]).map(read).join("\n");

  it("enables RLS on every table they create in public", () => {
    const tables = [...migrations.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(migrations).toContain(`alter table public.${table} enable row level security;`);
      expect(migrations).toMatch(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated(, service_role)?;`));
    }
  });

  it("revokes default execute on every function they create", () => {
    const functions = [...migrations.matchAll(/create function ((?:public|private)\.\w+)\(/g)].map((m) => m[1]);
    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) {
      expect(migrations).toMatch(new RegExp(`revoke all on function ${fn.replace(".", "\\.")}\\(`));
      expect(migrations).toMatch(new RegExp(`create function ${fn.replace(".", "\\.")}\\([^]*?set search_path = ''`));
    }
  });
});
