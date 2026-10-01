/**
 * Mapping and validation of the Notion creative-path database.
 *
 * Pure functions, no network and no secrets, so they run in unit tests and in
 * the import script (plain Node, which is why this file uses no path aliases).
 * Text is copied verbatim from Notion: rich text is concatenated as plain
 * text, never rewritten, summarized or translated.
 */

/** Catalog nodes per snapshot: selectable paths plus group headers. */
export const EXPECTED_NODE_COUNT = 67;
/** Nodes that can be recommended, drawn and applied. */
export const EXPECTED_SELECTABLE_COUNT = 65;

/** Editorial code: "9" or "9.3". At most one level below a top-level code. */
export const EDITORIAL_CODE = /^[1-9][0-9]*(\.[1-9][0-9]*)?$/;

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
  editorial_code: string;
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

/** The editorial code exactly as the source holds it, or null when it is not a valid code. */
function codeValue(value: NotionPropertyValue | undefined): string | null {
  if (!value) return null;
  let raw: string | null = null;
  if (value.type === "number") raw = value.number === null || value.number === undefined ? null : String(value.number);
  else if (value.type === "unique_id") raw = value.unique_id?.number == null ? null : String(value.unique_id.number);
  else if (value.type === "formula") {
    if (value.formula?.type === "number" && value.formula.number != null) raw = String(value.formula.number);
    else if (value.formula?.type === "string") raw = value.formula.string ?? null;
  } else if (value.type === "rich_text" || value.type === "title") raw = plainText(value.rich_text ?? value.title);
  raw = raw?.trim() ?? null;
  return raw && EDITORIAL_CODE.test(raw) ? raw : null;
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
  const code = codeValue(page.properties[mapping.number]);
  const title = (textValue(page.properties[mapping.title], problems, `${where} title`) ?? "").trim();
  const section = mapping.section ? textValue(page.properties[mapping.section], problems, `${where} section`) : null;
  const prompt = mapping.prompt ? textValue(page.properties[mapping.prompt], problems, `${where} prompt`) : null;
  const content = mapping.content === "body" ? (bodyText ?? "") : (textValue(page.properties[mapping.content], problems, `${where} content`) ?? "");

  // Whether a node needs text depends on the whole catalog (group headers
  // may be empty), so validateCatalog checks it.
  let ok = true;
  if (code === null) {
    problems.push(`${where} has no valid editorial code ("9" or "9.3").`);
    ok = false;
  }
  if (!title) {
    problems.push(`${where} has an empty title.`);
    ok = false;
  }
  if (!ok) return null;

  return {
    source_page_id: page.id,
    source_last_edited_at: page.last_edited_time ?? null,
    editorial_code: code as string,
    title,
    section: section?.trim() ? section.trim() : null,
    content: content.trim(),
    prompt_text: prompt?.trim() ? prompt.trim() : null,
  };
}

export type CatalogNode = CatalogRecord & { selectable: boolean };

function codeParts(code: string): [number, number | null] {
  const [major, minor] = code.split(".");
  return [Number(major), minor === undefined ? null : Number(minor)];
}

/** Catalog order: by the integer parts of the code, a parent before its children. */
export function compareCodes(a: string, b: string): number {
  const [aMajor, aMinor] = codeParts(a);
  const [bMajor, bMinor] = codeParts(b);
  return aMajor - bMajor || (aMinor ?? 0) - (bMinor ?? 0);
}

/**
 * A group header is a top-level code that has children ("9" when "9.1"
 * exists). A child does not need its parent ("1.2" without "1" is valid).
 */
export function groupHeaderCodes(codes: readonly string[]): Set<string> {
  const majorsWithChildren = new Set(codes.filter((c) => c.includes(".")).map((c) => c.split(".")[0]));
  return new Set(codes.filter((c) => !c.includes(".") && majorsWithChildren.has(c)));
}

const hasText = (r: CatalogRecord) => r.content.trim().length > 0 || (r.prompt_text ?? "").trim().length > 0;

/**
 * Exactly 67 nodes with unique source ids and editorial codes, 65 of them
 * selectable, each selectable node with content or prompt text. Returns the
 * nodes in catalog order. Throws otherwise. The database repeats these rules.
 */
export function validateCatalog(records: readonly CatalogRecord[], mappingProblems: readonly string[] = []): CatalogNode[] {
  const problems = [...mappingProblems];
  if (records.length !== EXPECTED_NODE_COUNT) {
    problems.push(`Expected ${EXPECTED_NODE_COUNT} catalog nodes, found ${records.length}.`);
  }
  const ids = new Map<string, number>();
  const codes = new Map<string, number>();
  for (const r of records) {
    ids.set(r.source_page_id, (ids.get(r.source_page_id) ?? 0) + 1);
    codes.set(r.editorial_code, (codes.get(r.editorial_code) ?? 0) + 1);
  }
  for (const [id, n] of ids) if (n > 1) problems.push(`Source page ${id} appears ${n} times.`);
  for (const [code, n] of codes) if (n > 1) problems.push(`Editorial code ${code} appears ${n} times.`);

  const headers = groupHeaderCodes([...codes.keys()]);
  const nodes = records
    .map((r) => ({ ...r, selectable: !headers.has(r.editorial_code) }))
    .sort((a, b) => compareCodes(a.editorial_code, b.editorial_code));
  const selectable = nodes.filter((n) => n.selectable);
  if (selectable.length !== EXPECTED_SELECTABLE_COUNT) {
    problems.push(`Expected ${EXPECTED_SELECTABLE_COUNT} selectable paths, found ${selectable.length}.`);
  }
  for (const n of selectable) {
    if (!hasText(n)) problems.push(`page ${n.source_page_id} (${n.editorial_code}) is a selectable path with neither content nor prompt text.`);
  }

  if (problems.length) throw new CatalogDiscrepancy(problems);
  return nodes;
}

/** Summary without editorial content, safe to print in the import log. */
export function describeCatalog(records: readonly CatalogNode[]) {
  const sections = new Map<string, number>();
  for (const r of records) sections.set(r.section ?? "(none)", (sections.get(r.section ?? "(none)") ?? 0) + 1);
  return {
    count: records.length,
    selectable: records.filter((r) => r.selectable).length,
    groupHeaders: records.filter((r) => !r.selectable).map((r) => `${r.editorial_code} ${r.source_page_id}`),
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
  else if (raw) number = codeValue(raw) ?? `(empty or not a code, ${raw.type})`;
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
