import type { SelectionOrigin } from "./queries";

/** How the origin of a path selection is shown. Every origin is a human choice. */
export const ORIGIN_LABEL: Record<SelectionOrigin, string> = {
  recommended: "Recomendado pela IA · escolhido por você",
  manual: "Escolha manual",
  random: "Sorteio · confirmado por você",
};
