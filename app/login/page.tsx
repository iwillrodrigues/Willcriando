import type { Metadata } from "next";
import Link from "next/link";

import { safeNextPath } from "@/lib/validation";

import styles from "../ui.module.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar · Trilha" };

export default async function LoginPage(props: PageProps<"/login">) {
  const query = await props.searchParams;
  const next = safeNextPath(query.next);
  const confirmationFailed = query.erro === "confirmacao";

  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <h1 className={styles.title}>Entrar na Trilha</h1>
      {confirmationFailed && (
        <p className={styles.error} role="alert">
          Não foi possível confirmar o e-mail. O link pode ter expirado. Tente entrar ou crie a conta de novo.
        </p>
      )}
      <LoginForm next={next} />
      <p className={styles.muted}>
        Ainda não tem conta?{" "}
        <Link className={styles.link} href="/cadastro">
          Criar conta
        </Link>
      </p>
    </main>
  );
}
