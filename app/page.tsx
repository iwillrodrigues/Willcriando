import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

import styles from "./page.module.css";

const FLOW = [
  "Briefing: cole como chegou",
  "Direção: a IA lê, você corrige",
  "Caminho: pela IA, pelo catálogo ou pela sorte",
  "Ideias: gere, edite, separe as finalistas",
  "Apresentação: monte, edite, guarde as versões",
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
        <h2 id="fluxo">Cinco momentos</h2>
        <ol className={styles.flow}>
          {FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className={styles.card} aria-labelledby="estado">
        <h2 id="estado">O que fica com você</h2>
        <p className={styles.status}>
          A IA lê e sugere; o catálogo dá o método; a escolha é sempre sua. Todo texto mostra de onde veio: IA, catálogo ou
          você.
        </p>
      </section>
    </main>
  );
}
