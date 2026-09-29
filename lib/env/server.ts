import "server-only";

import { readServerEnv, type ServerEnv } from "./schema";

/**
 * Server-only accessors for integration secrets.
 *
 * `server-only` makes the build fail if a Client Component imports this file.
 * Each getter validates when it is called, never at import time, so unrelated
 * builds and tests do not need these variables.
 */

export function getSupabaseAdminEnv(): ServerEnv<"supabaseAdmin"> {
  return readServerEnv("supabaseAdmin", process.env);
}

export function getAiEnv(): ServerEnv<"ai"> {
  return readServerEnv("ai", process.env);
}

export function getNotionEnv(): ServerEnv<"notion"> {
  return readServerEnv("notion", process.env);
}
