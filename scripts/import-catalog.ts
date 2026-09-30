/**
 * Imports the 63-path editorial catalog from Notion into Supabase.
 *
 *   node scripts/import-catalog.ts --inspect   schema and detected mapping only
 *   node scripts/import-catalog.ts             fetch, map and validate (dry run)
 *   node scripts/import-catalog.ts --apply     validate, then store a snapshot
 *
 * Backend-only. Reads NOTION_API_KEY, NOTION_CREATIVE_PATHS_DATABASE_ID and,
 * for --apply, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment. It never prints a secret or any editorial content; the log
 * holds counts, property names and problems only.
 *
 * Optional mapping overrides: NOTION_PROP_NUMBER, NOTION_PROP_TITLE,
 * NOTION_PROP_SECTION, NOTION_PROP_PROMPT (a property name or "none") and
 * NOTION_PROP_CONTENT (a property name or "body"). NOTION_API_VERSION
 * defaults to 2022-06-28.
 *
 * The import is all or nothing: any discrepancy (not exactly 63 valid pages,
 * duplicate ids or numbers, missing required text, ambiguous mapping,
 * inaccessible page) stops it before anything is written. Importing the same
 * content twice is a no-op in the database.
 */

import {
  blocksToText,
  CatalogDiscrepancy,
  describeCatalog,
  detectMapping,
  mapPage,
  unsupportedBlockTypes,
  validateCatalog,
  type CatalogRecord,
  type MappingOverrides,
  type NotionBlock,
  type NotionPage,
  type NotionPropertySchema,
} from "../lib/catalog/notion.ts";

const args = new Set(process.argv.slice(2));
const mode = args.has("--inspect") ? "inspect" : args.has("--apply") ? "apply" : "dry-run";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}.`);
    process.exit(2);
  }
  return value;
}

const token = requireEnv("NOTION_API_KEY");
const databaseId = requireEnv("NOTION_CREATIVE_PATHS_DATABASE_ID");
const notionVersion = process.env.NOTION_API_VERSION?.trim() || "2022-06-28";

async function notion<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    // Only the status and Notion's error code; never the request headers.
    let code = "unknown";
    try {
      code = ((await response.json()) as { code?: string }).code ?? code;
    } catch {}
    throw new Error(`Notion request failed: HTTP ${response.status} (${code}) on ${path.split("?")[0].replace(/[0-9a-f-]{32,36}/g, "<id>")}`);
  }
  return (await response.json()) as T;
}

async function allPages(): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
      `databases/${databaseId}/query`,
      { method: "POST", body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } },
    );
    pages.push(...res.results);
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);
  return pages.filter((p) => !p.archived && !p.in_trash);
}

async function blockTree(blockId: string, depth = 0): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await notion<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>(
      `blocks/${blockId}/children?${query}`,
    );
    for (const block of res.results) {
      if (block.has_children && depth < 5 && block.type !== "child_page" && block.type !== "child_database") {
        block.children = await blockTree(block.id, depth + 1);
      }
      blocks.push(block);
    }
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

function overrides(): MappingOverrides {
  const o: MappingOverrides = {};
  const set = (key: keyof MappingOverrides, env: string) => {
    const v = process.env[env]?.trim();
    if (v) o[key] = v;
  };
  set("number", "NOTION_PROP_NUMBER");
  set("title", "NOTION_PROP_TITLE");
  set("section", "NOTION_PROP_SECTION");
  set("prompt", "NOTION_PROP_PROMPT");
  set("content", "NOTION_PROP_CONTENT");
  return o;
}

async function main() {
  const db = await notion<{ properties: Record<string, NotionPropertySchema> }>(`databases/${databaseId}`);
  const schema = db.properties;
  const pages = await allPages();

  if (mode === "inspect") {
    console.log("Properties (name: type):");
    for (const [name, p] of Object.entries(schema)) console.log(`  ${name}: ${p.type}`);
    console.log(`Active pages: ${pages.length}`);
    try {
      console.log("Detected mapping:", detectMapping(schema, overrides()));
    } catch (error) {
      if (error instanceof CatalogDiscrepancy) console.log(error.message);
      else throw error;
    }
    return;
  }

  const ov = overrides();
  const mapping = detectMapping(schema, ov);
  console.log("Mapping:", mapping);

  const problems: string[] = [];
  const records: CatalogRecord[] = [];
  let bodiesWithText = 0;
  for (const page of pages) {
    let body: string | null = null;
    if (mapping.content === "body" || !ov.content) {
      const blocks = await blockTree(page.id);
      const unsupported = unsupportedBlockTypes(blocks);
      body = blocksToText(blocks);
      if (body) bodiesWithText++;
      if (mapping.content === "body" && unsupported.length) {
        problems.push(`page ${page.id} has content blocks that cannot be imported as text: ${unsupported.join(", ")}.`);
      }
    }
    const record = mapPage(page, mapping, body, problems);
    if (record) records.push(record);
  }
  if (!ov.content && mapping.content !== "body" && bodiesWithText > 0) {
    problems.push(
      `Both the "${mapping.content}" property and page bodies (${bodiesWithText}) hold text. ` +
        `Set NOTION_PROP_CONTENT to "${mapping.content}" or "body".`,
    );
  }

  const valid = validateCatalog(records, problems);
  console.log("Validated catalog:", describeCatalog(valid));

  if (mode !== "apply") {
    console.log("Dry run: nothing was written. Re-run with --apply to import.");
    return;
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/import_catalog_snapshot`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_source_database_id: databaseId, p_paths: valid }),
  });
  if (!response.ok) {
    let message = "unknown";
    try {
      message = ((await response.json()) as { message?: string }).message ?? message;
    } catch {}
    throw new Error(`Supabase import failed: HTTP ${response.status} (${message})`);
  }
  console.log(`Imported. Current catalog snapshot: ${await response.json()}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exit(1);
});
