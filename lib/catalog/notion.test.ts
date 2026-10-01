import { describe, expect, it } from "vitest";

import {
  blocksToText,
  CatalogDiscrepancy,
  detectMapping,
  diagnosePage,
  duplicateTitles,
  compareCodes,
  EXPECTED_NODE_COUNT,
  EXPECTED_SELECTABLE_COUNT,
  groupHeaderCodes,
  mapPage,
  NOTION_FALLBACK_DELAYS_MS,
  NOTION_MAX_ATTEMPTS,
  NOTION_MAX_RETRY_WAIT_MS,
  notionFailureMessage,
  notionHeaders,
  retryAfterMs,
  sendWithRateLimitRetry,
  validateCatalog,
  type CatalogRecord,
  type NotionPage,
} from "./notion";

// Fictitious Notion shapes. No real catalog content.
const schema = {
  Nome: { type: "title" },
  "Número": { type: "number" },
  "Seção": { type: "select" },
  Prompt: { type: "rich_text" },
  Status: { type: "status" },
};

const rt = (text: string) => [{ plain_text: text }];

function page(n: number, overrides: Partial<NotionPage["properties"]> = {}): NotionPage {
  return {
    id: `pagina-ficticia-${n}`,
    last_edited_time: "2026-09-01T00:00:00.000Z",
    properties: {
      Nome: { type: "title", title: rt(`Caminho fictício ${n}`) },
      "Número": { type: "number", number: n },
      "Seção": { type: "select", select: { name: "Seção fictícia" } },
      Prompt: { type: "rich_text", rich_text: rt(`Prompt fictício ${n}`) },
      ...overrides,
    },
  };
}

// The approved shape, with fictitious text: 1.2-1.6 without a parent,
// 2-52 with 9 and 23 as empty group headers, 9.1-9.6 and 23.1-23.5.
const CODES = [
  ...[2, 3, 4, 5, 6].map((m) => `1.${m}`),
  ...Array.from({ length: 51 }, (_, i) => String(i + 2)),
  ...[1, 2, 3, 4, 5, 6].map((m) => `9.${m}`),
  ...[1, 2, 3, 4, 5].map((m) => `23.${m}`),
];
const HEADERS = new Set(["9", "23"]);

function catalog(): CatalogRecord[] {
  return CODES.map((code) => ({
    source_page_id: `p-${code}`,
    source_last_edited_at: null,
    editorial_code: code,
    title: `Caminho fictício ${code}`,
    section: code.includes(".") ? "Subcaminho" : "Caminho",
    content: HEADERS.has(code) ? "" : "texto",
    prompt_text: null,
  }));
}

describe("detectMapping", () => {
  it("detects title, number, section and prompt when each is unambiguous", () => {
    expect(detectMapping(schema)).toEqual({
      title: "Nome",
      number: "Número",
      section: "Seção",
      prompt: "Prompt",
      content: "body",
    });
  });

  it("stops on an ambiguous number property", () => {
    const ambiguous = { ...schema, "Numero antigo": { type: "number" }, number: { type: "number" } };
    expect(() => detectMapping(ambiguous)).toThrowError(CatalogDiscrepancy);
  });

  it("stops when a configured property does not exist", () => {
    expect(() => detectMapping(schema, { section: "Categoria" })).toThrowError(/does not exist/);
  });

  it("accepts explicit overrides", () => {
    const withTwo = { ...schema, Ordem: { type: "number" }, Posição: { type: "number" } };
    expect(detectMapping(withTwo, { number: "Ordem", prompt: "none" })).toMatchObject({ number: "Ordem", prompt: null });
  });
});

describe("mapPage", () => {
  const mapping = detectMapping(schema);

  it("copies text verbatim", () => {
    const problems: string[] = [];
    const record = mapPage(page(4), mapping, "Linha 1\nLinha 2", problems);
    expect(problems).toEqual([]);
    expect(record).toEqual({
      source_page_id: "pagina-ficticia-4",
      source_last_edited_at: "2026-09-01T00:00:00.000Z",
      editorial_code: "4",
      title: "Caminho fictício 4",
      section: "Seção fictícia",
      content: "Linha 1\nLinha 2",
      prompt_text: "Prompt fictício 4",
    });
  });

  it("reports a page without code or title; text is checked with the whole catalog", () => {
    const problems: string[] = [];
    const empty = page(5, {
      Nome: { type: "title", title: [] },
      "Número": { type: "number", number: null },
      Prompt: { type: "rich_text", rich_text: [] },
    });
    expect(mapPage(empty, mapping, "", problems)).toBeNull();
    expect(problems).toHaveLength(2);
  });

  it("keeps decimal editorial codes exactly", () => {
    for (const code of [1.2, 9.3, 23.5]) {
      const record = mapPage(page(1, { "Número": { type: "number", number: code } }), mapping, "texto", []);
      expect(record?.editorial_code).toBe(String(code));
    }
    expect(mapPage(page(1, { "Número": { type: "number", number: 23.5 } }), mapping, "", [])?.editorial_code).toBe("23.5");
  });

  it("rejects codes that are not 'N' or 'N.M'", () => {
    for (const bad of [0, -1, 1.05]) {
      const problems: string[] = [];
      expect(mapPage(page(1, { "Número": { type: "number", number: bad } }), mapping, "texto", problems)).toBeNull();
      expect(problems[0]).toMatch(/no valid editorial code/);
    }
  });
});

describe("validateCatalog", () => {
  it("expects 67 nodes and 65 selectable paths", () => {
    expect(EXPECTED_NODE_COUNT).toBe(67);
    expect(EXPECTED_SELECTABLE_COUNT).toBe(65);
  });

  it("accepts the approved catalog: 67 nodes, 65 selectable, 9 and 23 as empty headers", () => {
    const nodes = validateCatalog(catalog());
    expect(nodes).toHaveLength(67);
    expect(nodes.filter((n) => n.selectable)).toHaveLength(65);
    expect(nodes.filter((n) => !n.selectable).map((n) => [n.editorial_code, n.content])).toEqual([
      ["9", ""],
      ["23", ""],
    ]);
  });

  it("keeps codes verbatim and orders a parent before its children", () => {
    const codes = validateCatalog(catalog()).map((n) => n.editorial_code);
    expect(codes.slice(0, 6)).toEqual(["1.2", "1.3", "1.4", "1.5", "1.6", "2"]);
    expect(codes.slice(codes.indexOf("9"), codes.indexOf("9") + 8)).toEqual(["9", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "10"]);
    expect(codes).toContain("23.5");
    expect(codes.at(-1)).toBe("52");
  });

  it("accepts 1.2-1.6 without a parent node or 1.1", () => {
    const nodes = validateCatalog(catalog());
    expect(nodes.some((n) => n.editorial_code === "1" || n.editorial_code === "1.1")).toBe(false);
    expect(nodes.filter((n) => n.editorial_code.startsWith("1.")).every((n) => n.selectable)).toBe(true);
  });

  it("rejects 66 or 68 nodes", () => {
    expect(() => validateCatalog(catalog().slice(1))).toThrowError(/Expected 67 catalog nodes, found 66/);
    const extra = [...catalog(), { ...catalog()[10], source_page_id: "extra", editorial_code: "53" }];
    expect(() => validateCatalog(extra)).toThrowError(/found 68/);
  });

  it("rejects duplicate source ids and duplicate editorial codes", () => {
    const dupCode = catalog().map((r) => (r.editorial_code === "52" ? { ...r, editorial_code: "51" } : r));
    expect(() => validateCatalog(dupCode)).toThrowError(/Editorial code 51 appears 2 times/);
    const dupId = catalog().map((r) => (r.editorial_code === "52" ? { ...r, source_page_id: "p-2" } : r));
    expect(() => validateCatalog(dupId)).toThrowError(/Source page p-2 appears 2 times/);
  });

  it("rejects a selectable path without content or prompt text", () => {
    const empty = catalog().map((r) => (r.editorial_code === "9.3" ? { ...r, content: "  ", prompt_text: null } : r));
    expect(() => validateCatalog(empty)).toThrowError(/p-9.3 \(9.3\) is a selectable path with neither content nor prompt text/);
  });

  it("rejects a catalog whose structure does not give 65 selectable paths", () => {
    // A third group header (5 gets a child) leaves 64 selectable among 67.
    const moved = catalog().map((r) => (r.editorial_code === "52" ? { ...r, editorial_code: "5.1" } : r));
    expect(() => validateCatalog(moved)).toThrowError(/Expected 65 selectable paths, found 64/);
  });

  it("carries mapping problems into the stop", () => {
    expect(() => validateCatalog(catalog(), ["page x has an empty title."])).toThrowError(/empty title/);
  });
});

describe("catalog order and headers", () => {
  it("compares codes numerically, parent first", () => {
    expect(["10", "9.2", "2", "9", "1.6", "9.10"].sort(compareCodes)).toEqual(["1.6", "2", "9", "9.2", "9.10", "10"]);
  });

  it("marks only top-level codes that have children as headers", () => {
    expect([...groupHeaderCodes(["1.2", "9", "9.1", "10", "23", "23.4"])]).toEqual(["9", "23"]);
  });
});

describe("blocksToText", () => {
  it("keeps block order, including nested blocks", () => {
    const text = blocksToText([
      { id: "1", type: "heading_2", heading_2: { rich_text: rt("Título") } },
      { id: "2", type: "paragraph", paragraph: { rich_text: rt("Primeiro.") }, has_children: true, children: [
        { id: "3", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("Item.") } },
      ] },
      { id: "4", type: "divider" },
    ]);
    expect(text).toBe("Título\nPrimeiro.\nItem.");
  });
});

describe("Notion request auth", () => {
  // Fictitious token, never a real credential.
  it("adds Authorization when a local token exists", () => {
    const h = notionHeaders("fake-token", "2022-06-28");
    expect(h.Authorization).toBe("Bearer fake-token");
    expect(h["Notion-Version"]).toBe("2022-06-28");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("omits Authorization without a local token, so the environment can inject it", () => {
    const h = notionHeaders(undefined, "2022-06-28");
    expect(h).not.toHaveProperty("Authorization");
    expect(h["Notion-Version"]).toBe("2022-06-28");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("explains a 401 without exposing ids or headers", () => {
    const msg = notionFailureMessage(401, "unauthorized", "databases/0123456789abcdef0123456789abcdef");
    expect(msg).toContain("HTTP 401 (unauthorized) on databases/<id>");
    expect(msg).toContain("No usable Notion credential was available");
    expect(msg).not.toContain("0123456789abcdef");
    expect(msg).not.toMatch(/Bearer|Authorization/);
  });

  it("keeps other failures to status, code and path", () => {
    expect(notionFailureMessage(404, "object_not_found", "blocks/0123456789abcdef0123456789abcdef/children?page_size=100")).toBe(
      "Notion request failed: HTTP 404 (object_not_found) on blocks/<id>/children",
    );
  });
});

describe("Notion rate-limit retry", () => {
  const limited = (retryAfter?: string) =>
    new Response(JSON.stringify({ code: "rate_limited" }), {
      status: 429,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
  const ok = () => new Response("{}", { status: 200 });

  // Replays the given responses in order and records every wait instead of sleeping.
  function harness(responses: Response[]) {
    const waits: number[] = [];
    const retries: [number, number][] = [];
    let sent = 0;
    const run = () =>
      sendWithRateLimitRetry(
        async () => responses[sent++],
        async (ms) => {
          waits.push(ms);
        },
        (attempt, waitMs) => retries.push([attempt, waitMs]),
      );
    return { run, waits, retries, sent: () => sent };
  }

  it("returns an immediate success without waiting", async () => {
    const h = harness([ok()]);
    const { response, attempts } = await h.run();
    expect(response.status).toBe(200);
    expect(attempts).toBe(1);
    expect(h.sent()).toBe(1);
    expect(h.waits).toEqual([]);
  });

  it("retries a 429 and returns the following success", async () => {
    const h = harness([limited(), ok()]);
    const { response, attempts } = await h.run();
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
    expect(h.retries).toEqual([[1, NOTION_FALLBACK_DELAYS_MS[0]]]);
  });

  it("waits the Retry-After seconds when the header is valid", async () => {
    const h = harness([limited("3"), limited("0.5"), ok()]);
    await h.run();
    expect(h.waits).toEqual([3_000, 500]);
  });

  it("falls back to the fixed delays when Retry-After is missing or invalid", async () => {
    const h = harness([limited(), limited("soon"), limited("-1"), limited("Wed, 21 Oct 2026 07:28:00 GMT"), ok()]);
    const { attempts } = await h.run();
    expect(attempts).toBe(5);
    expect(h.waits).toEqual([...NOTION_FALLBACK_DELAYS_MS]);
  });

  it("caps a long Retry-After", async () => {
    expect(retryAfterMs("3600")).toBe(NOTION_MAX_RETRY_WAIT_MS);
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });

  it("stops after the maximum attempts and returns the last 429", async () => {
    const h = harness(Array.from({ length: NOTION_MAX_ATTEMPTS + 2 }, () => limited()));
    const { response, attempts } = await h.run();
    expect(response.status).toBe(429);
    expect(attempts).toBe(NOTION_MAX_ATTEMPTS);
    expect(h.sent()).toBe(NOTION_MAX_ATTEMPTS);
    expect(h.waits).toHaveLength(NOTION_MAX_ATTEMPTS - 1);
    expect(await response.json()).toEqual({ code: "rate_limited" });
  });

  it.each([401, 403, 400, 404, 500, 503])("does not retry HTTP %i", async (status) => {
    const h = harness([new Response("{}", { status }), ok()]);
    const { response, attempts } = await h.run();
    expect(response.status).toBe(status);
    expect(attempts).toBe(1);
    expect(h.sent()).toBe(1);
    expect(h.waits).toEqual([]);
  });
});

describe("import diagnostics", () => {
  const mapping = detectMapping(schema);
  const page = (props: NotionPage["properties"]): NotionPage => ({ id: "p-diag", properties: props });

  it("identifies a page by id, raw number, title and section, never by body or prompt", () => {
    const d = diagnosePage(
      page({
        Nome: { type: "title", title: [{ plain_text: "Caminho fictício" }] },
        "Número": { type: "number", number: null },
        "Seção": { type: "select", select: { name: "Seção fictícia" } },
        Prompt: { type: "rich_text", rich_text: [{ plain_text: "prompt secreto" }] },
      }),
      mapping,
    );
    expect(d).toEqual({ id: "p-diag", number: "(empty)", title: "Caminho fictício", section: "Seção fictícia" });
    expect(JSON.stringify(d)).not.toContain("prompt secreto");
  });

  it("shows a non-integer number as is", () => {
    const d = diagnosePage(page({ Nome: { type: "title", title: [] }, "Número": { type: "number", number: 4.5 } }), mapping);
    expect(d.number).toBe("4.5");
    expect(d.title).toBe("(empty)");
    expect(d.section).toBe("(none)");
  });

  it("lists duplicate titles case-insensitively", () => {
    expect(duplicateTitles(["Eco", "eco ", "Ponte"])).toEqual(['"Eco" (2)']);
    expect(duplicateTitles(["Eco", "Ponte"])).toEqual([]);
  });
});
