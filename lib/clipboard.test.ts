import { describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

function fakeDocument(copyResult: boolean | Error) {
  const area = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  };
  const copied: string[] = [];
  const doc = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => area),
    execCommand: vi.fn(() => {
      if (copyResult instanceof Error) throw copyResult;
      if (copyResult) copied.push(area.value);
      return copyResult;
    }),
  };
  return { doc: doc as unknown as Document, area, copied };
}

const fullText = "Título\n\nAbertura.\n\n1. Slide\nTexto completo, sem cortes.\n\nFechamento.";

describe("copyText", () => {
  it("copies the exact text with the Clipboard API", async () => {
    const writeText = vi.fn(async () => {});
    await expect(copyText(fullText, { navigator: { clipboard: { writeText } } })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(fullText);
  });

  it("falls back to execCommand when the Clipboard API is refused", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    const { doc, area, copied } = fakeDocument(true);
    await expect(copyText(fullText, { navigator: { clipboard: { writeText } }, document: doc })).resolves.toBe(true);
    expect(copied).toEqual([fullText]);
    expect(area.remove).toHaveBeenCalled();
  });

  it("falls back when there is no Clipboard API", async () => {
    const { doc, copied } = fakeDocument(true);
    await expect(copyText(fullText, { document: doc })).resolves.toBe(true);
    expect(copied).toEqual([fullText]);
  });

  it("reports failure instead of throwing", async () => {
    const { doc, area } = fakeDocument(new Error("blocked"));
    await expect(copyText(fullText, { document: doc })).resolves.toBe(false);
    expect(area.remove).toHaveBeenCalled();
    await expect(copyText(fullText, { document: fakeDocument(false).doc })).resolves.toBe(false);
    await expect(copyText(fullText, {})).resolves.toBe(false);
  });
});
