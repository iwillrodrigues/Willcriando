import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

import styles from "./page.module.css";

const FLOW = [
  "Briefing",
  "Análise com IA",
  "Explorar caminhos criativos",
  "Aplicar o caminho escolhido",
  "Gerar conceitos",
  "Selecionar finalistas",
  "Apresentação",
];

export default async function Home() {
  if (await getSessionUser()) redirect("/jobs");

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Trilha</p>
      <h1 className={styles.title}>Do briefing a conceitos criativos</h1>
      <p className={styles.lede}>
        A Trilha ajuda criativos de publicidade a transformar um briefing em conceitos, usando análise com IA e um
        catálogo editorial de caminhos criativos. A decisão final é sempre sua.
      </p>
      <p className={styles.actions}>
        <Link className={styles.primary} href="/login">
          Entrar
        </Link>
        <Link className={styles.secondary} href="/cadastro">
          Criar conta
        </Link>
      </p>
      <section className={styles.card} aria-labelledby="fluxo">
        <h2 id="fluxo">Fluxo</h2>
        <ol className={styles.flow}>
          {FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className={styles.card} aria-labelledby="estado">
        <h2 id="estado">O que já funciona</h2>
        <p className={styles.status}>
          Conta com e-mail e senha, criação de jobs e briefing salvo em revisões. Análise com IA, catálogo de caminhos,
          conceitos, finalistas e apresentação ainda não foram implementados.
        </p>
      </section>
    </main>
  );
}
