"use client";

import { useActionState } from "react";

import { TITLE_MAX } from "@/lib/validation";

import styles from "../ui.module.css";
import { createJob, type CreateJobState } from "./actions";

const initialState: CreateJobState = { status: "idle" };

export function CreateJobForm() {
  const [state, formAction, pending] = useActionState(createJob, initialState);

  return (
    <form className={styles.form} action={formAction} noValidate>
      <label className={styles.field}>
        Título do job
        <input
          className={styles.input}
          name="title"
          maxLength={TITLE_MAX}
          required
          placeholder="Ex.: Lançamento de inverno"
          defaultValue={state.title}
          aria-invalid={state.status === "error"}
        />
      </label>
      {state.message && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      <div className={styles.row}>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar job"}
        </button>
      </div>
    </form>
  );
}
