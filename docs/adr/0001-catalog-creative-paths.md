# ADR 0001: Creative paths come from an editorial catalog; generated output is a concept

**Status:** Accepted
**Date:** 2026-09-29
**Supersedes, where stated below:** parts of `docs/data-model/review-v1.1.md`, `docs/data-model/content-relation-matrix-v1.3.md` and `docs/data-model/acceptance-criteria-v1.4.md`. Those files are left unchanged; this ADR is the record of what no longer applies.

## Context

The data model documents (v1.1 to v1.4) and the navigation prototype (`prototype/trilha-criativa-legacy.html`) describe this flow:

Briefing → Analysis → Matter (raw material) → Combinations → Creative paths → Finalists → Presentation

In that model, a `creative_path` is a **generated creative direction**, and it is `based_on` a user-chosen `combination` of materials (human truths, tensions, brand and category elements, creative mechanisms).

The product has changed. A catalog of 63 editorial creative methods, maintained in Notion, replaces the Matter and Combinations stages. The word "caminho" (path) now names one of those catalog methods, not the generated output. Keeping the old meaning would point the approved rules at the wrong entity.

## Decision

1. **`creative_path` means an editorial creative method** synchronized from the Notion catalog. The application keeps an internal, versioned copy. Every change produces a new `creative_path` revision; Notion stays the editorial source.
2. **A catalog path is applied to a brief.** It is a method or filter for thinking. It is never a final concept.
3. **The generated creative output is named `concept`.** Everything the old documents said about a generated `creative_path` (editing, finalists, tests, presentation references) now concerns `concept`, unless a later ADR says otherwise.
4. **Matter and Combinations are removed from the active product flow.**
5. **The active flow is:**
   Briefing → AI analysis → Explore creative paths → Apply selected path → Generate concepts → Select finalists → Presentation
6. **A path selection has exactly one origin:**
   1. `recommended`: suggested by AI from the synchronized catalog;
   2. `manual`: picked by the user from the catalog;
   3. `random`: drawn by the application (no AI involved).
7. **AI may recommend catalog paths but never makes the final selection.** Recommendations may only reference existing internal catalog revisions. A selection is always a human decision, including when its origin is `recommended` or `random`.
8. **The exact creative path revision used to generate concepts stays traceable.** A concept records the path revision and the selection it came from. A later catalog sync never changes that link.
9. **Superseded rules are not deleted.** They are listed below and stay in the documents as history.
10. **Preserved principle (from R1, R8, R9 and R13):**
    1. concept generation requires an **active human selection** of the exact path revision when the generation request is created;
    2. **each retry revalidates** that selection;
    3. once a generation run has been validly created, a later change of the active selection **never invalidates that run or its outputs**; they stay valid and traceable to the exact revision used.

## Terminology mapping

| Old term (v1.1 to v1.4, prototype) | New meaning |
|---|---|
| `creative_path` (generated direction) | `concept` |
| `creative_path` (new) | Catalog method synchronized from Notion, versioned internally |
| `combination` | No equivalent. Replaced by a path selection |
| `based_on` (path → combination) | A concept references its path selection and path revision |
| `chosen` on a combination | Active path selection (origin `recommended`, `manual` or `random`) |
| `finalist` role on a `creative_path` | `finalist` role on a `concept` |
| Stage "Matéria prima" | Removed |
| Stage "Combinações" | Replaced by "Explorar caminhos" and "Aplicar caminho" |
| Stage "Caminhos criativos" (generated) | "Conceitos" |

## Superseded material

### `docs/data-model/acceptance-criteria-v1.4.md`

| Item | Status |
|---|---|
| §6 Combination criteria: AC-COMB-001 to AC-COMB-029 | Superseded |
| Combination scenarios: AC-COMB-101 to AC-COMB-111 | Superseded |
| `based_on` criteria: AC-REL-040 to AC-REL-044 and AC-REL-054 to AC-REL-060 | Superseded. Principle 10 replaces their `chosen` checks |
| Relation scenarios AC-REL-104 to AC-REL-108 | Superseded |
| `combines` in §5.1 and §3.3 | Superseded |
| AC-DEC-012, the `combination` part | Superseded |
| AC-DEC-018 (`finalist` only on `creative_path`) | Re-targeted to `concept` |
| AC-REL-050 to AC-REL-053 (`evaluates` → `creative_path`) | Re-targeted to `concept`, pending a later decision on tests |
| AC-GEN-020, AC-GEN-027 to AC-GEN-031, scenarios AC-GEN-107 to AC-GEN-112 | Combination wording superseded; the behavior carries over to path selections through principle 10 |
| Request kinds `material_expansion`, `combination_suggestion` and `path_generation` in the OI-10 table | Superseded. New kinds (analysis, path recommendation, concept generation) will be defined with the AI integration |
| Decisions D1 to D5 (Appendix A) | Superseded |
| Decisions R1, R6, R8, R9, R11, R12, R13 (Appendix B) | Superseded in their combination wording. Their principle survives as principle 10; R12's identity rule survives as: a concept never changes the path revision it was generated from |
| Content types `human_truth`, `brand_element`, `category_element`, `creative_mechanism`, `combination` | Removed from the active flow. `human_truth` may return if the analysis schema needs it |

### `docs/data-model/content-relation-matrix-v1.3.md`

The `combination` definition, the `combines` and `based_on` relations, the combination composition rule and the Matter types are superseded as described above.

### `docs/data-model/review-v1.1.md`

The "creative material lists" and "combination" parts of the original flow are superseded. The provenance, immutability, evidence and decision-event principles remain in force.

### Still in force

Everything not listed above, in particular:
1. job isolation;
2. immutable briefing versions and revisions;
3. evidence validated by exact match;
4. the fact, hypothesis, suggestion and human text distinction;
5. separation between AI output and human decisions;
6. requested versus resolved AI settings;
7. idempotency (R10, R14, R15);
8. discard without deletion.

## Consequences

1. The next increments model `creative_paths`, `creative_path_revisions`, catalog snapshots, recommendations, draws, `path_selections` and `concepts` as described in the technical assessment.
2. `prototype/trilha-criativa-legacy.html` is a reference for visual language and interaction patterns only. Its Matter and Combinations stages and its generated "caminhos" do not describe current behavior.
3. Open items that this ADR does not decide:
   1. the AI provider;
   2. the real schema of the Notion catalog, including where the long prompt text is stored and which records count as paths;
   3. the Supabase project and hosting target.
