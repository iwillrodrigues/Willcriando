/**
 * Mapping and validation of the Notion creative-path database.
 *
 * Pure functions, no network and no secrets, so they run in unit tests and in
 * the import script (plain Node, which is why this file uses no path aliases).
 * Text is copied verbatim from Notion: rich text is concatenated as plain
 * text, never rewritten, summarized or translated.
 */

export const EXPECTED_PATH_COUNT = 67;

export type RichText = { plain_text?: string };

export type NotionPropertySchema = { id?: string; type: string };

export type NotionPropertyValue = {
  type: string;
  title?: RichText[];
  rich_text?: RichText[];
  number?: number | null;
  select?: { name: string } | null;
  status?: { name: string } | null;
  multi_select?: { name: string }[];
  unique_id?: { prefix: string | null; number: number | null };
  formula?: { type: string; string?: string | null; number?: number | null };
};

export type NotionPage = {
  id: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, NotionPropertyValue>;
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

export type Mapping = {
  number: string;
  title: string;
  section: string | null;
  prompt: string | null;
  /** A property name, or "body" to read the page content blocks. */
  content: string | "body";
};

export type MappingOverrides = Partial<Record<keyof Mapping, string>>;

export type CatalogRecord = {
  source_page_id: string;
  source_last_edited_at: string | null;
  path_number: number;
  title: string;
  section: string | null;
  content: string;
  prompt_text: string | null;
};

export class CatalogDiscrepancy extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Catalog import stopped: ${problems.length} problem(s).\n- ${problems.join("\n- ")}`);
    this.name = "CatalogDiscrepancy";
    this.problems = problems;
  }
}

export function plainText(rich: RichText[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text ?? "").join("");
}

const TEXT_BLOCKS = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
]);

/** Page body as text: one line per text block, children in order. */
export function blocksToText(blocks: readonly NotionBlock[]): string {
  const lines: string[] = [];
  const walk = (list: readonly NotionBlock[]) => {
    for (const block of list) {
      if (TEXT_BLOCKS.has(block.type)) {
        const data = block[block.type] as { rich_text?: RichText[] } | undefined;
        lines.push(plainText(data?.rich_text));
      }
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Block types whose content the importer cannot represent as text. */
export function unsupportedBlockTypes(blocks: readonly NotionBlock[]): string[] {
  const ignorable = new Set(["divider", "table_of_contents", "breadcrumb", "column_list", "column", "synced_block"]);
  const found = new Set<string>();
  const walk = (list: readonly NotionBlock[]) => {
    for (const block of list) {
      if (!TEXT_BLOCKS.has(block.type) && !ignorable.has(block.type)) found.add(block.type);
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return [...found].sort();
}

const NAME_HINTS = {
  number: /^(n(u|ú)mero|number|n[º°o.]?|#|id|c(o|ó)digo)$/i,
  section: /(se(c|ç)(a|ã)o|section|categoria|category|grupo|group|fam(i|í)lia)/i,
  prompt: /prompt/i,
  content: /(conte(u|ú)do|content|descri(c|ç)(a|ã)o|description|explica(c|ç)(a|ã)o|texto)/i,
};

function pick(
  schema: Record<string, NotionPropertySchema>,
  kind: string,
  types: string[],
  hint: RegExp,
  problems: string[],
  required: boolean,
): string | null {
  const typed = Object.entries(schema).filter(([, p]) => types.includes(p.type)).map(([name]) => name);
  const named = typed.filter((name) => hint.test(name.trim()));
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    problems.push(`Ambiguous ${kind} property: ${named.join(", ")}. Set it explicitly.`);
    return null;
  }
  if (required && typed.length === 1) return typed[0];
  if (required) problems.push(`Could not identify the ${kind} property among [${typed.join(", ")}]. Set it explicitly.`);
  return null;
}

/**
 * Chooses which Notion properties hold each field. Explicit overrides win;
 * otherwise a field is detected only when exactly one property fits.
 * Anything ambiguous stops the import instead of guessing.
 */
export function detectMapping(schema: Record<string, NotionPropertySchema>, overrides: MappingOverrides = {}): Mapping {
  const problems: string[] = [];
  const exists = (name: string | undefined, kind: string) => {
    if (name && name !== "body" && !(name in schema)) problems.push(`Configured ${kind} property "${name}" does not exist.`);
    return name;
  };

  const titleProps = Object.entries(schema).filter(([, p]) => p.type === "title").map(([n]) => n);
  const title = exists(overrides.title, "title") ?? (titleProps.length === 1 ? titleProps[0] : null);
  if (!title) problems.push("The database has no single title property.");

  const number =
    exists(overrides.number, "number") ?? pick(schema, "number", ["number", "unique_id", "formula"], NAME_HINTS.number, problems, true);
  const section =
    overrides.section === "none"
      ? null
      : (exists(overrides.section, "section") ??
        pick(schema, "section", ["select", "status", "multi_select", "rich_text"], NAME_HINTS.section, problems, false));
  const prompt =
    overrides.prompt === "none"
      ? null
      : (exists(overrides.prompt, "prompt") ?? pick(schema, "prompt", ["rich_text"], NAME_HINTS.prompt, problems, false));
  const contentProp = exists(overrides.content, "content") ?? pick(schema, "content", ["rich_text"], NAME_HINTS.content, problems, false);
  const content = contentProp && contentProp !== prompt ? contentProp : "body";

  if (problems.length > 0 || !title || !number) throw new CatalogDiscrepancy(problems);
  return { number, title, section, prompt, content };
}

function numberValue(value: NotionPropertyValue | undefined): number | null {
  if (!value) return null;
  if (value.type === "number") return value.number ?? null;
  if (value.type === "unique_id") return value.unique_id?.number ?? null;
  if (value.type === "formula") return value.formula?.type === "number" ? (value.formula.number ?? null) : null;
  if (value.type === "rich_text" || value.type === "title") {
    const text = plainText(value.rich_text ?? value.title).trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  }
  return null;
}

function textValue(value: NotionPropertyValue | undefined, problems: string[], label: string): string | null {
  if (!value) return null;
  switch (value.type) {
    case "title":
      return plainText(value.title);
    case "rich_text":
      return plainText(value.rich_text);
    case "select":
      return value.select?.name ?? null;
    case "status":
      return value.status?.name ?? null;
    case "multi_select": {
      const names = (value.multi_select ?? []).map((o) => o.name);
      if (names.length > 1) problems.push(`${label} has several values (${names.length}); one was expected.`);
      return names[0] ?? null;
    }
    case "formula":
      return value.formula?.type === "string" ? (value.formula.string ?? null) : null;
    default:
      problems.push(`${label} uses unsupported property type "${value.type}".`);
      return null;
  }
}

export function mapPage(page: NotionPage, mapping: Mapping, bodyText: string | null, problems: string[]): CatalogRecord | null {
  const where = `page ${page.id}`;
  const number = numberValue(page.properties[mapping.number]);
  const title = (textValue(page.properties[mapping.title], problems, `${where} title`) ?? "").trim();
  const section = mapping.section ? textValue(page.properties[mapping.section], problems, `${where} section`) : null;
  const prompt = mapping.prompt ? textValue(page.properties[mapping.prompt], problems, `${where} prompt`) : null;
  const content = mapping.content === "body" ? (bodyText ?? "") : (textValue(page.properties[mapping.content], problems, `${where} content`) ?? "");

  let ok = true;
  if (number === null || !Number.isInteger(number)) {
    problems.push(`${where} has no integer path number.`);
    ok = false;
  }
  if (!title) {
    problems.push(`${where} has an empty title.`);
    ok = false;
  }
  if (!content.trim() && !(prompt ?? "").trim()) {
    problems.push(`${where} has neither explanatory content nor prompt text.`);
    ok = false;
  }
  if (!ok) return null;

  return {
    source_page_id: page.id,
    source_last_edited_at: page.last_edited_time ?? null,
    path_number: number as number,
    title,
    section: section?.trim() ? section.trim() : null,
    content: content.trim(),
    prompt_text: prompt?.trim() ? prompt.trim() : null,
  };
}

/** Exactly 67 records, unique ids, numbers exactly 1..67. Throws otherwise. */
export function validateCatalog(records: readonly CatalogRecord[], mappingProblems: readonly string[] = []): CatalogRecord[] {
  const problems = [...mappingProblems];
  if (records.length !== EXPECTED_PATH_COUNT) {
    problems.push(`Expected ${EXPECTED_PATH_COUNT} valid paths, found ${records.length}.`);
  }
  const ids = new Map<string, number>();
  const numbers = new Map<number, number>();
  for (const r of records) {
    ids.set(r.source_page_id, (ids.get(r.source_page_id) ?? 0) + 1);
    numbers.set(r.path_number, (numbers.get(r.path_number) ?? 0) + 1);
  }
  for (const [id, n] of ids) if (n > 1) problems.push(`Source page ${id} appears ${n} times.`);
  for (const [num, n] of numbers) if (n > 1) problems.push(`Path number ${num} appears ${n} times.`);
  const missing: number[] = [];
  for (let i = 1; i <= EXPECTED_PATH_COUNT; i++) if (!numbers.has(i)) missing.push(i);
  if (missing.length) problems.push(`Missing path numbers: ${missing.join(", ")}.`);
  const outOfRange = [...numbers.keys()].filter((n) => n < 1 || n > EXPECTED_PATH_COUNT);
  if (outOfRange.length) problems.push(`Path numbers outside 1-${EXPECTED_PATH_COUNT}: ${outOfRange.join(", ")}.`);

  if (problems.length) throw new CatalogDiscrepancy(problems);
  return [...records].sort((a, b) => a.path_number - b.path_number);
}

/** Summary without editorial content, safe to print in the import log. */
export function describeCatalog(records: readonly CatalogRecord[]) {
  const sections = new Map<string, number>();
  for (const r of records) sections.set(r.section ?? "(none)", (sections.get(r.section ?? "(none)") ?? 0) + 1);
  return {
    count: records.length,
    sections: Object.fromEntries(sections),
    withPrompt: records.filter((r) => r.prompt_text).length,
    withContent: records.filter((r) => r.content).length,
  };
}

/**
 * Request headers for the Notion API. Authorization is sent only when a local
 * token exists; without one, a cloud environment may inject its own.
 */
export function notionHeaders(token: string | undefined, notionVersion: string): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Notion-Version": notionVersion,
    "Content-Type": "application/json",
  };
}

/** Failure message with the status, Notion's error code and a redacted path; never headers. */
export function notionFailureMessage(status: number, code: string, path: string): string {
  const where = path.split("?")[0].replace(/[0-9a-f-]{32,36}/g, "<id>");
  const message = `Notion request failed: HTTP ${status} (${code}) on ${where}`;
  return status === 401
    ? `${message}. No usable Notion credential was available: set NOTION_API_KEY or attach the Notion connection to the environment.`
    : message;
}

export type PageDiagnosis = { id: string; number: string; title: string; section: string };

/**
 * Identity fields for the import log: id, the raw number value, title and
 * section. Never the body or the prompt text.
 */
export function diagnosePage(page: NotionPage, mapping: Mapping): PageDiagnosis {
  const raw = page.properties[mapping.number];
  let number = "(missing)";
  if (raw?.type === "number") number = raw.number === null || raw.number === undefined ? "(empty)" : String(raw.number);
  else if (raw) {
    const n = numberValue(raw);
    number = n === null ? `(empty or not an integer ${raw.type})` : String(n);
  }
  const ignored: string[] = [];
  const title = textValue(page.properties[mapping.title], ignored, "title")?.trim() || "(empty)";
  const section = (mapping.section && textValue(page.properties[mapping.section], ignored, "section")?.trim()) || "(none)";
  return { id: page.id, number, title, section };
}

/** Titles used by more than one page (case-insensitive), with their counts. */
export function duplicateTitles(titles: readonly string[]): string[] {
  const counts = new Map<string, { title: string; n: number }>();
  for (const title of titles) {
    const key = title.trim().toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { title: title.trim(), n: 1 });
  }
  return [...counts.values()].filter((e) => e.n > 1).map((e) => `"${e.title}" (${e.n})`);
}
