import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseEnv } from "@/lib/env/public";

/** Routes that require a signed-in user. */
export function isProtectedPath(pathname: string): boolean {
  return pathname === "/jobs" || pathname.startsWith("/jobs/");
}

/** Auth pages a signed-in user is sent away from. */
export function isAuthPage(pathname: string): boolean {
  return pathname === "/login" || pathname === "/cadastro";
}

/**
 * Refreshes the Supabase session cookies on every request and performs an
 * optimistic redirect. This is not the security boundary: protected pages and
 * actions check the user again on the server, and the database enforces RLS.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the token and refreshes it when needed. Do not run code between
  // client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  let redirectTo: URL | null = null;
  if (!signedIn && isProtectedPath(pathname)) {
    redirectTo = new URL("/login", request.url);
    redirectTo.searchParams.set("next", pathname + search);
  } else if (signedIn && isAuthPage(pathname)) {
    redirectTo = new URL("/jobs", request.url);
  }

  if (!redirectTo) return response;

  // Carry refreshed cookies and no-cache headers over to the redirect.
  const redirect = NextResponse.redirect(redirectTo);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
