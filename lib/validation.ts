import { z } from "zod";

/**
 * Input rules shared by forms and server actions.
 *
 * The database enforces the same limits (see the S1 migration). These checks
 * exist to give clear Portuguese messages before a request reaches it.
 */

export const TITLE_MAX = 200;
export const BRIEFING_MAX = 100_000;
export const PASSWORD_MIN = 8;

/** Trims and collapses internal whitespace, as stored in `jobs.title`. */
export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export const jobTitleSchema = z
  .string()
  .transform(normalizeTitle)
  .pipe(
    z
      .string()
      .min(1, "Dê um título ao job.")
      .max(TITLE_MAX, `O título pode ter no máximo ${TITLE_MAX} caracteres.`),
  );

/** Raw briefing text is stored as typed; only blank text is refused. */
export const briefingSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Escreva o briefing antes de salvar.")
  .refine((value) => value.length <= BRIEFING_MAX, `O briefing pode ter no máximo ${BRIEFING_MAX} caracteres.`);

export const jobIdSchema = z.uuid();

export const signInSchema = z.object({
  email: z.string().trim().pipe(z.email("Informe um e-mail válido.")),
  password: z.string().min(1, "Informe a senha."),
});

export const signUpSchema = z
  .object({
    email: z.string().trim().pipe(z.email("Informe um e-mail válido.")),
    password: z.string().min(PASSWORD_MIN, `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

/** First message per field, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

/**
 * Accepts only same-site relative paths for post-login redirects, so a crafted
 * `next` parameter cannot send the user to another origin.
 */
export function safeNextPath(raw: unknown, fallback = "/jobs"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
