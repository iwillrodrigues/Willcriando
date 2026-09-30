import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicSupabaseEnv } from "@/lib/env/public";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * It uses the public anon key and the signed-in user's session cookies, so
 * every query runs as that user and is filtered by row-level security. The
 * service role key is never used here.
 *
 * Create one client per request; never share it across requests.
 */
export async function createSupabaseServerClient() {
  // cookies() first: it marks the route dynamic before any env check runs,
  // so builds without Supabase variables never try to prerender it.
  const cookieStore = await cookies();
  const env = getPublicSupabaseEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so a write skipped here is harmless.
        }
      },
    },
  });
}
