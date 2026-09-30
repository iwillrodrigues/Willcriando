import { z } from "zod";

/**
 * Environment contracts, grouped by integration.
 *
 * Nothing here runs at import time. Each integration validates its own variables
 * only when it is actually used, so lint, typecheck, tests and `next build`
 * work without any real credential.
 *
 * This module holds no secrets and reads no environment by itself, so it is
 * safe to test directly. Server code reads secrets through `./server`.
 */

const requiredString = z.string().trim().min(1);

/** Variables that are inlined into the browser bundle. Never secrets. */
export const publicSchemas = {
  supabase: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
  }),
} as const;

/** Variables that must only ever be read on the server. */
export const serverSchemas = {
  supabaseAdmin: z.object({
    SUPABASE_SERVICE_ROLE_KEY: requiredString,
  }),
  ai: z.object({
    /** Anthropic API key. */
    AI_PROVIDER_API_KEY: requiredString,
    /** Optional model override; the app defaults to its tested model. */
    AI_MODEL: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined)),
  }),
  notion: z.object({
    NOTION_API_KEY: requiredString,
    NOTION_CREATIVE_PATHS_DATABASE_ID: requiredString,
  }),
} as const;

export type PublicIntegration = keyof typeof publicSchemas;
export type ServerIntegration = keyof typeof serverSchemas;
export type PublicEnv<K extends PublicIntegration> = z.infer<(typeof publicSchemas)[K]>;
export type ServerEnv<K extends ServerIntegration> = z.infer<(typeof serverSchemas)[K]>;

export const PUBLIC_PREFIX = "NEXT_PUBLIC_";

/** Every server-only variable name, used to enforce the naming rule in tests. */
export function serverVariableNames(): string[] {
  return Object.values(serverSchemas).flatMap((schema) => Object.keys(schema.shape));
}

/** Every public variable name. */
export function publicVariableNames(): string[] {
  return Object.values(publicSchemas).flatMap((schema) => Object.keys(schema.shape));
}

/**
 * Raised when an integration is used without valid configuration.
 * The message names the variables only. It never includes a value.
 */
export class MissingEnvError extends Error {
  readonly integration: string;
  readonly variables: string[];

  constructor(integration: string, variables: string[]) {
    super(
      `Integration "${integration}" is not configured. ` +
        `Missing or invalid environment variables: ${variables.join(", ")}.`,
    );
    this.name = "MissingEnvError";
    this.integration = integration;
    this.variables = variables;
  }
}

type Source = Record<string, string | undefined>;

function parseWith<S extends z.ZodObject>(integration: string, schema: S, source: Source): z.infer<S> {
  const keys = Object.keys(schema.shape);
  const picked: Source = {};
  for (const key of keys) picked[key] = source[key];
  const result = schema.safeParse(picked);
  if (result.success) return result.data;
  const invalid = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new MissingEnvError(integration, invalid);
}

/** Validates the variables of one server integration from the given source. */
export function readServerEnv<K extends ServerIntegration>(integration: K, source: Source): ServerEnv<K> {
  return parseWith(integration, serverSchemas[integration], source) as ServerEnv<K>;
}

/** Validates the variables of one public integration from the given source. */
export function readPublicEnv<K extends PublicIntegration>(integration: K, source: Source): PublicEnv<K> {
  return parseWith(integration, publicSchemas[integration], source) as PublicEnv<K>;
}
