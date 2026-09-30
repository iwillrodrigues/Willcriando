import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "@/lib/env/public";
import { getSupabaseAdminEnv } from "@/lib/env/server";

/**
 * Service-role client for the backend-only generation functions.
 *
 * It bypasses RLS, and the S2 migration grants it nothing but EXECUTE on the
 * `begin_generation`, `complete_*` and `fail_generation` functions. Those
 * functions take the authenticated user's id and re-check ownership of every
 * record themselves. Callers pass the id from `requireUser()`, never from
 * client input.
 *
 * No session is persisted: the client is created per call and discarded.
 */
export function createSupabaseAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getSupabaseAdminEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
