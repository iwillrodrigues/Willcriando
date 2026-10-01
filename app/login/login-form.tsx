"use client";

import { useActionState } from "react";

import { signIn, type AuthFormState } from "@/lib/auth/actions";

import styles from "../ui.module.css";

const initialState: AuthFormState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form className={`${styles.card} ${styles.form}`} action={formAction} noValidate>
      <input type="hidden" name="next" value={next} />
      <label className={styles.field}>
        E-mail
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={Boolean(state.fields?.email)}
        />
      </label>
      {state.fields?.email && <p className={styles.error}>{state.fields.email}</p>}
      <label className={styles.field}>
        Senha
        <input
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fields?.password)}
        />
      </label>
      {state.fields?.password && <p className={styles.error}>{state.fields.password}</p>}
      {state.message && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      <button className={styles.button} type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
