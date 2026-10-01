"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authErrorMessage } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fieldErrors, safeNextPath, signInSchema, signUpSchema } from "@/lib/validation";

export type AuthFormState = {
  status: "idle" | "error" | "confirm_email";
  message?: string;
  fields?: Record<string, string>;
  email?: string;
};

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { status: "error", fields: fieldErrors(parsed.error), email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: authErrorMessage(error.code), email };

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { status: "error", fields: fieldErrors(parsed.error), email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: await confirmUrl() },
  });
  if (error) return { status: "error", message: authErrorMessage(error.code), email };

  // With email confirmation off, Supabase signs the user in right away.
  if (data.session) redirect("/jobs");

  // With confirmation on, the reply is the same whether or not the address
  // was already registered, so this page never reveals existing accounts.
  return { status: "confirm_email", email: parsed.data.email };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Absolute URL of the confirmation handler on the origin that served the form. */
async function confirmUrl(): Promise<string | undefined> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}/auth/confirm`;
  } catch {
    return undefined;
  }
}
