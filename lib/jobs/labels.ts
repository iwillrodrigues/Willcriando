/** Heading of the job list: the empty state or the count. */
export function jobCountLabel(count: number): string {
  if (count === 0) return "Nenhum job ainda";
  return `${count} ${count === 1 ? "job" : "jobs"}`;
}
