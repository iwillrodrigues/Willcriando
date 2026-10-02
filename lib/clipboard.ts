/**
 * Copies text to the clipboard. Uses the async Clipboard API when the page
 * may use it, and falls back to a hidden textarea with execCommand("copy")
 * (older browsers, permission denied). Never throws: returns false when
 * neither path copied the text, so the caller can tell the user to copy by hand.
 */

type ClipboardEnv = {
  navigator?: { clipboard?: { writeText(text: string): Promise<void> } };
  document?: Pick<Document, "createElement" | "execCommand" | "body">;
};

export async function copyText(text: string, env: ClipboardEnv = globalThis as ClipboardEnv): Promise<boolean> {
  try {
    if (env.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  const doc = env.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  try {
    area.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
