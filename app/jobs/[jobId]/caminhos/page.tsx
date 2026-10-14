import { redirect } from "next/navigation";

/**
 * The path explorer now lives inside the job workspace (moment 3). This route
 * stays so old links and bookmarks keep working, including a pending draw.
 */
export default async function PathsPage(props: PageProps<"/jobs/[jobId]/caminhos">) {
  const { jobId } = await props.params;
  const search = await props.searchParams;

  const query = new URLSearchParams();
  if (typeof search.sorteio === "string") {
    query.set("modo", "sorteio");
    query.set("sorteio", search.sorteio);
  } else if (typeof search.erro === "string") {
    query.set("modo", "sorteio");
    query.set("erro", search.erro.slice(0, 200));
  } else {
    query.set("modo", "catalogo");
  }
  redirect(`/jobs/${encodeURIComponent(jobId)}?${query.toString()}#caminho`);
}
