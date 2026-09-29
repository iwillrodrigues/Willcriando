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

export default function Home() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Trilha</p>
      <h1 className={styles.title}>MVP funcional em construção</h1>
      <p className={styles.lede}>
        A Trilha vai ajudar criativos de publicidade a transformar um briefing em conceitos, usando análise com IA e
        um catálogo editorial de caminhos criativos.
      </p>
      <section className={styles.card} aria-labelledby="fluxo">
        <h2 id="fluxo">Fluxo confirmado</h2>
        <ol className={styles.flow}>
          {FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className={styles.card} aria-labelledby="estado">
        <h2 id="estado">Estado atual</h2>
        <p className={styles.status}>
          Esta versão contém apenas a base técnica. Análise com IA, catálogo do Notion, contas de usuário e
          armazenamento de jobs ainda não foram implementados.
        </p>
      </section>
    </main>
  );
}
