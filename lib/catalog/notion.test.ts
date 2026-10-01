import { describe, expect, it } from "vitest";

import {
  blocksToText,
  CatalogDiscrepancy,
  detectMapping,
  mapPage,
  notionFailureMessage,
  notionHeaders,
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

function records(count: number): CatalogRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    source_page_id: `p${i + 1}`,
    source_last_edited_at: null,
    path_number: i + 1,
    title: `Caminho fictício ${i + 1}`,
    section: null,
    content: "texto",
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
      path_number: 4,
      title: "Caminho fictício 4",
      section: "Seção fictícia",
      content: "Linha 1\nLinha 2",
      prompt_text: "Prompt fictício 4",
    });
  });

  it("reports a page without number, title or any text", () => {
    const problems: string[] = [];
    const empty = page(5, {
      Nome: { type: "title", title: [] },
      "Número": { type: "number", number: null },
      Prompt: { type: "rich_text", rich_text: [] },
    });
    expect(mapPage(empty, mapping, "", problems)).toBeNull();
    expect(problems).toHaveLength(3);
  });
});

describe("validateCatalog", () => {
  it("accepts exactly 63 unique paths numbered 1 to 63", () => {
    expect(validateCatalog(records(63))).toHaveLength(63);
  });

  it("rejects 62 or 64 paths", () => {
    expect(() => validateCatalog(records(62))).toThrowError(/found 62/);
    const extra = [...records(63), { ...records(1)[0], source_page_id: "extra", path_number: 64 }];
    expect(() => validateCatalog(extra)).toThrowError(CatalogDiscrepancy);
  });

  it("rejects duplicated ids and numbers", () => {
    const dupNumber = records(63).map((r) => (r.path_number === 63 ? { ...r, path_number: 1 } : r));
    expect(() => validateCatalog(dupNumber)).toThrowError(/appears 2 times/);
    const dupId = records(63).map((r) => (r.path_number === 63 ? { ...r, source_page_id: "p1" } : r));
    expect(() => validateCatalog(dupId)).toThrowError(/Source page p1 appears 2 times/);
  });

  it("carries mapping problems into the stop", () => {
    expect(() => validateCatalog(records(63), ["page x has an empty title."])).toThrowError(/empty title/);
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
