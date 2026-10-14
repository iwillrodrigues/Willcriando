"use client";

import { useState } from "react";

import type { CatalogPath } from "@/lib/flow/catalog-path";

import styles from "../../ui.module.css";
import { SelectPathForm } from "./flow-forms";
import { PathBody } from "./path-body";
import ws from "./workspace.module.css";

/** Lowercase, without accents, so "tensao" finds "Tensão". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matches(path: CatalogPath, query: string): boolean {
  const haystack = normalize([path.editorial_code, path.title, path.section ?? "", path.content].join(" "));
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * The whole catalog, in editorial order, with a filter. Opening a path only
 * reads it; the path becomes active when the creative presses the button.
 */
export function CatalogBrowser(props: { jobId: string; paths: CatalogPath[]; activePathId: string | null; canSelect: boolean }) {
  const [query, setQuery] = useState("");
  const normalized = normalize(query.trim());
  const selectableCount = props.paths.filter((p) => p.selectable).length;
  const visible = normalized
    ? props.paths.filter((p) => p.selectable && matches(p, normalized))
    : props.paths;

  return (
    <div className={ws.panel}>
      <label className={styles.field}>
        Buscar no catálogo
        <input
          className={ws.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Código, nome ou palavra (ex.: exagero, 9.3)"
        />
      </label>
      <p className={styles.muted} aria-live="polite">
        {normalized
          ? `${visible.length} de ${selectableCount} caminhos`
          : `${selectableCount} caminhos, na ordem do catálogo`}
      </p>
      <div className={styles.stack}>
        {visible.map((path) =>
          path.selectable ? (
            <details
              key={path.id}
              className={`${styles.item} ${!normalized && path.editorial_code.includes(".") ? styles.itemChild : ""} ${props.activePathId === path.id ? styles.itemActive : ""}`}
            >
              <summary>
                <span className={ws.pathCode}>{path.editorial_code}</span>
                {path.title}
                {props.activePathId === path.id ? " · ativo" : ""}
              </summary>
              <PathBody path={path} />
              {props.canSelect && props.activePathId !== path.id && (
                <SelectPathForm jobId={props.jobId} origin="manual" pathId={path.id} label="Começar por este caminho" secondary />
              )}
            </details>
          ) : (
            <h3 key={path.id} className={styles.sectionTitle}>
              <span className={ws.pathCode}>{path.editorial_code}</span>
              {path.title} <span className={styles.muted}>· escolha um dos caminhos abaixo</span>
            </h3>
          ),
        )}
      </div>
    </div>
  );
}
