/**
 * A catalog node. editorial_code is the visible code ("9.3"); path_number is
 * only the internal order. Group headers (selectable false) are shown for
 * orientation but never recommended, drawn or applied.
 *
 * Kept apart from the server-only queries so client components can use the type.
 */
export type CatalogPath = {
  id: string;
  path_number: number;
  editorial_code: string;
  selectable: boolean;
  title: string;
  section: string | null;
  content: string;
  prompt_text: string | null;
};
