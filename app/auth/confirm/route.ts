import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Target of the sign-up confirmation email (PKCE flow). Exchanges the one-time
 * code for a session and sends the user to their jobs.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/jobs", request.url));
  }
  return NextResponse.redirect(new URL("/login?erro=confirmacao", request.url));
}
