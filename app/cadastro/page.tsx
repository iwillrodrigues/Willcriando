import type { Metadata } from "next";
import Link from "next/link";

import styles from "../ui.module.css";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta · Trilha" };

export default function SignUpPage() {
  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <h1 className={styles.title}>Criar conta</h1>
      <SignUpForm />
      <p className={styles.muted}>
        Já tem conta?{" "}
        <Link className={styles.link} href="/login">
          Entrar
        </Link>
      </p>
    </main>
  );
}
