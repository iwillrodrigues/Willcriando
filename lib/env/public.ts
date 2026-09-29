import { readPublicEnv, type PublicEnv } from "./schema";

/**
 * Public configuration, safe for the browser.
 *
 * Next.js only inlines `NEXT_PUBLIC_*` variables that are referenced literally,
 * so each one is read by its full name here. Validation happens on call.
 */
export function getPublicSupabaseEnv(): PublicEnv<"supabase"> {
  return readPublicEnv("supabase", {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
