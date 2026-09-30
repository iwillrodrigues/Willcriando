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
  TRILHA_NO_BRIEFING: "Salve o briefing antes de continuar.",
  TRILHA_CATALOG_EMPTY: "O catálogo de caminhos ainda não foi importado.",
  TRILHA_CATALOG_CHANGED: "O catálogo foi atualizado. Tente de novo.",
  TRILHA_PATH_NOT_FOUND: "Caminho não encontrado no catálogo atual.",
  TRILHA_INVALID_SELECTION: "Esta escolha não vale mais. Recarregue a página e escolha de novo.",
  TRILHA_SELECTION_NOT_ACTIVE: "O caminho ativo mudou. Recarregue a página.",
  TRILHA_NO_FINALISTS: "Marque pelo menos um conceito como finalista.",
  TRILHA_INVALID_RETRY: "Esta tentativa não pode ser repetida. Recarregue a página.",
  TRILHA_CONCEPT_NOT_FOUND: "Conceito não encontrado ou sem acesso.",
  TRILHA_PRESENTATION_NOT_FOUND: "Apresentação não encontrada ou sem acesso.",
};

/** Codes stored on failed generation requests, and pre-flight failures. */
const GENERATION_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: "A IA não está configurada neste ambiente (falta a chave do provedor no servidor).",
  SERVER_NOT_CONFIGURED: "O servidor não está configurado para gerar com IA (falta a chave de serviço do banco).",
  AI_AUTH: "O provedor de IA recusou a credencial configurada.",
  AI_RATE_LIMIT: "Limite de uso da IA atingido. Aguarde um pouco e tente de novo.",
  AI_TIMEOUT: "A IA demorou demais para responder. Tente de novo.",
  AI_UNAVAILABLE: "A IA está indisponível agora. Tente de novo em instantes.",
  AI_REFUSAL: "A IA recusou este pedido. Ajuste o briefing e tente de novo.",
  AI_TRUNCATED: "A resposta da IA veio incompleta. Tente de novo.",
  AI_INVALID_OUTPUT: "A resposta da IA veio em formato inválido e não foi salva. Tente de novo.",
  AI_ERROR: "O provedor de IA retornou um erro. Tente de novo.",
  TRILHA_STALE: "A tentativa anterior não terminou. Tente de novo.",
  PREVIOUS_ATTEMPT_FAILED: "A última tentativa falhou. Use “Tentar de novo”.",
  INTERNAL_ERROR: "Algo deu errado ao gerar. Tente de novo.",
  DB_ERROR: "Não foi possível salvar o resultado. Tente de novo.",
};

export function generationErrorMessage(code: string | null | undefined): string {
  if (code && Object.hasOwn(GENERATION_MESSAGES, code)) return GENERATION_MESSAGES[code];
  if (code && Object.hasOwn(DB_MESSAGES, code)) return DB_MESSAGES[code];
  return GENERIC_ERROR;
}

/** Codes where a retry cannot help until someone changes configuration. */
export function isConfigurationError(code: string | null | undefined): boolean {
  return code === "AI_NOT_CONFIGURED" || code === "SERVER_NOT_CONFIGURED" || code === "AI_AUTH";
}

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
