"use client";

import { useActionState } from "react";

import { signUp, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN } from "@/lib/validation";

import styles from "../ui.module.css";

const initialState: AuthFormState = { status: "idle" };

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state.status === "confirm_email") {
    return (
      <section className={styles.card} role="status">
        <h2>Confirme seu e-mail</h2>
        <p className={styles.muted}>
          Se o endereço {state.email} puder ser cadastrado, você vai receber um link de confirmação. Abra o link neste
          navegador para entrar.
        </p>
      </section>
    );
  }

  return (
    <form className={`${styles.card} ${styles.form}`} action={formAction} noValidate>
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
        Senha (mínimo de {PASSWORD_MIN} caracteres)
        <input
          className={styles.input}
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          aria-invalid={Boolean(state.fields?.password)}
        />
      </label>
      {state.fields?.password && <p className={styles.error}>{state.fields.password}</p>}
      <label className={styles.field}>
        Repita a senha
        <input
          className={styles.input}
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fields?.confirmPassword)}
        />
      </label>
      {state.fields?.confirmPassword && <p className={styles.error}>{state.fields.confirmPassword}</p>}
      {state.message && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      <button className={styles.button} type="submit" disabled={pending}>
        {pending ? "Criando conta…" : "Criar conta"}
      </button>
    </form>
  );
}
