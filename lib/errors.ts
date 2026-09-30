/**
 * Maps Supabase Auth and database errors to Portuguese messages.
 *
 * Raw error messages are never shown: they can carry internal details. Only
 * known codes get a specific message; everything else gets a generic one.
 */

export const GENERIC_ERROR = "Algo deu errado. Tente novamente em instantes.";

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_not_confirmed: "Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada.",
  user_already_exists: "Não foi possível criar a conta com esses dados.",
  email_exists: "Não foi possível criar a conta com esses dados.",
  weak_password: "Senha fraca. Use uma senha mais longa e difícil de adivinhar.",
  email_address_invalid: "Informe um e-mail válido.",
  signup_disabled: "Novos cadastros estão desativados no momento.",
  email_provider_disabled: "Login por e-mail está desativado no momento.",
  over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos e tente de novo.",
  user_banned: "Esta conta está bloqueada.",
  validation_failed: "Confira os dados informados.",
};

export function authErrorMessage(code: string | undefined | null): string {
  if (code && Object.hasOwn(AUTH_MESSAGES, code)) return AUTH_MESSAGES[code];
  return GENERIC_ERROR;
}

/** Error keys raised by the S1 database functions (see the S1 migration). */
const DB_MESSAGES: Record<string, string> = {
  TRILHA_UNAUTHENTICATED: "Sua sessão expirou. Entre novamente.",
  TRILHA_JOB_NOT_FOUND: "Job não encontrado ou sem acesso.",
  TRILHA_INVALID_CONTENT: "Escreva o briefing antes de salvar.",
};

/** Postgres SQLSTATE codes that have a meaningful user message. */
const SQLSTATE_MESSAGES: Record<string, string> = {
  "23514": "Os dados não passaram na validação. Confira e tente de novo.",
  "42501": "Você não tem permissão para esta ação.",
  PGRST301: "Sua sessão expirou. Entre novamente.",
};

export function dbErrorMessage(error: { message?: string | null; code?: string | null } | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  const key = (error.message ?? "").trim();
  if (Object.hasOwn(DB_MESSAGES, key)) return DB_MESSAGES[key];
  if (error.code && Object.hasOwn(SQLSTATE_MESSAGES, error.code)) return SQLSTATE_MESSAGES[error.code];
  return GENERIC_ERROR;
}
