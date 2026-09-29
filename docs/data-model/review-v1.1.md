# Conceptual Data Model Review: Model v1.1

Labels used throughout:
**[Req]** confirmed requirement from the product brief.
**[Rec]** my recommendation.
**[Assume]** an assumption that should be confirmed or rejected.

Where each review question is answered:
Q1 in §1 · Q2 in §3 intro · Q3 R1 · Q4 R5 · Q5 R6 · Q6 R8 · Q7 R9 · Q8 R10 · Q9 R11 · Q10 R12 · Q11 §3.B · Q12 R14 · Q13 §3.C · Q14 §3.D · Q15 §3.E

---

## 1. Executive verdict

**Ready with changes.**

The spine is right: stable identity, immutable revisions, immutable decisions, rebuildable projection. That is the correct shape for "the AI proposes, the human decides, nothing is lost." Keep it.

What is not ready: provenance stops at the item level. Relations, finalists and outputs point to items, while the product promises exact revisions. And a run's inputs live in an opaque snapshot the database cannot check. Those two gaps break invariant 8 and operation 12, and they are expensive to fix once data exists. The rest is tightening: duplicate mechanisms, undefined decision semantics, missing ordering rules.

In one sentence: **the model knows what exists, but not always which version of what produced it.**

**Q1, boundary coherence, entity by entity:**

1. **ContentItem / ContentRevision:** coherent, with one fix. "Semantically different idea = new item" cannot be judged by a database. Make the boundary command-based: *Edit* and *AI rewrite* create revisions; *New*, *Generate alternatives* and any regeneration create items.
2. **GenerationRun:** right concept, underspecified. Inputs, instruction version, user directive, raw output and retry identity are missing.
3. **DecisionEvent:** right concept, undefined semantics. `approved` has no meaning distinct from `selected`, some actions have no undo, and scope and exclusivity rules are missing.
4. **ContentRelation:** this is where the boundary breaks. Item-to-item edges cannot carry revision-exact provenance.

---

## 2. Critical issues

Only problems that cause data loss, ambiguous history, broken traceability, or expensive redesign.

**C1. Relations are item-to-item.**
A combination that "uses" a human truth cannot say which wording. When the truth is edited, the combination, the paths generated from it, and the finalist built from those paths silently point to text that did not exist when they were made. This breaks invariant 8 and operation 12. Fixing it after data exists means backfilling guesses.

**C2. Run inputs live only in `input_snapshot`.**
The database cannot guarantee that referenced revisions exist, cannot index "which outputs used brief v1" (operations 7 and 8), and nothing prevents two runs from recording inputs in two shapes. The run is also missing:
1. the instruction version as a real record;
2. the user's free-text directive ("make it more irreverent"), which is a human input and must be traceable;
3. the raw model output. Without it, a failed or partially parsed run loses the only evidence of what happened (operations 10 and 11).

**C3. Evidence is trusted, not verified.**
Any `quoted_text` is accepted. A model fabricates a quote as easily as a fact. Unless every quote is located in the exact text of the cited version at write time, invariants 1 and 9 hold on paper and fail in practice. Related: `authorship = brief` confuses source with author. The brief never writes anything; the AI or the user paraphrases it.

**C4. Two mechanisms for the same thing, twice.**
`ContentItem.archived_at` vs `discarded/restored` events: two answers to "is this item gone?"
`alternative_group_id` vs relation `alternative_to`: two answers to "what does this compete with?"
Two sources of truth will diverge. `archived_at` is also mutable and outside the event stream, so state cannot be rebuilt from events alone.

**C5. Finalist as a content type duplicates a decision.**
"Is this path a finalist?" would be answered both by an item's existence and by events. Undo becomes undefined: delete the finalist item, discard it, or unselect it?

**C6. Decision semantics are incomplete.**
`approved` overlaps `selected` in a single-user flow. `rejected` and `approved` have no compensating action. `favorited` has no scope. No rule says whether two audiences can be selected at once. The projection cannot be rebuilt deterministically when the rules it would replay do not exist.

**C7. Event order depends on `created_at`.**
Timestamps tie and drift, especially in a PWA with client clocks. Replay order must come from a server-assigned sequence.

**C8. Retry and idempotency are unmodeled.**
A double click or a network retry creates two indistinguishable runs, and a retry cannot be told apart from a new request. Operation 11 is ambiguous as specified.

**C9. `ContentRevision.content` has no schema version.**
The structure of a path, a test or a presentation block will change during the MVP. Without a version stamped on each revision, old immutable revisions become unreadable or must be migrated in place, which violates invariant 5.

**C10. `creative_material` has no kind.**
The three lists (human truths, brand or category elements, mechanisms) are only distinguishable through relation names (`uses_human_tension`...), which exist only after a combination is made. An uncombined material belongs to no list. There is also a naming collision: the list holds human *truths*, the relation says human *tension*, and the analysis has its own `human_tension`. Those may be one concept or two. The model cannot tell.

---

## 3. Recommended changes

**Q2 at a glance.**
Redundant: `Briefing` as a bare indirection, `created_by_*` on most entities, `change_type`, `supersedes_version_id`, `alternative_group_id` plus `alternative_to`, `archived_at` plus discard.
Ambiguous: `authorship = brief`, `approved`, favorite scope, `supports_path`, `current_revision_id`, human truth vs human tension.
Overloaded: `ContentItem.content_type` (ideas, structures, tests and decisions in one list), `uses_*` relations (encode material kind), `input_snapshot` (references, settings and audit in one blob).
Missing: run inputs as records, instruction versions, request and attempt identity, raw output, user directive, content schema version, event sequence, command grouping, brief context on revisions and decisions, material kind, presentation container, evidence verification.

| # | Entity | Current issue | Proposed correction | Reason |
|---|---|---|---|---|
| R1 (Q3) | ContentItem | Generic in the wrong way: mixes authored ideas (tension, path), structures (combination), evaluations (tests) and a decision (finalist). | Keep **one** table; do not split per type. Remove `finalist`. Replace `creative_material` with `human_truth`, `brand_element`, `creative_mechanism`. Add `presentation` (container). Declare a **Content Type Registry in application config** (not a table) stating per type: content schema version, allowed author/assertion pairs, selection mode (`none`, `single`, `multiple`), required relations (a combination needs exactly one `combines` edge per material kind), whether evidence is allowed. | The smallest correction that makes "generic" safe: the table stays generic, the rules stop being implicit. |
| R2 | ContentItem | `created_by_type`, `created_by_user_id`, `archived_at`, `alternative_group_id` are redundant or conflicting. | Remove all four. | Creation provenance is revision 1. The user is the job owner. `archived_at` duplicates discard. Alternatives: see R4. |
| R3 (Q2) | ContentRevision | `authorship` (brief, ai, user) overlaps `assertion_type` and treats the brief as an author. `change_type` is derivable; `import` is out of scope. | Rename to `author_type: ai | user`. Keep `assertion_type`. Pair rule: `ai` allows `extracted_fact`, `hypothesis`, `suggestion`; `user` allows `human_text`, or `extracted_fact` only when the user attaches verified evidence (e.g. highlights text in the brief). A user edit of an AI fact becomes `human_text`; evidence is not carried over. Drop `change_type`. Add `content_schema_version`, `context_source_version_id` (brief version current at write time) and `job_id` (denormalized for same-job integrity). | One field per question: who wrote it, what kind of claim it is, under which brief. Once a human rewrites a fact, the system can no longer guarantee it still says what the brief says. |
| R4 (op 2) | Alternatives | `alternative_group_id` and `alternative_to` both exist; neither has an owner. | Remove both. **Competition** is the slot (job + content type, per registry selection mode). **Batch** is the GenerationRun. **Lineage** is `derived_from`, pinned to the anchor revision. | Three existing concepts already answer "what competes, what came together, what came from what." A fourth is a divergence waiting to happen. |
| R5 (Q4) | Finalist | A content type that duplicates a decision. | Remove the type. **A finalist is a `creative_path` revision with an active `selected` decision.** Registry: `creative_path` selection mode `multiple`. | Finalist is a human judgment about a specific wording, and the event log already stores that, with undo. Text a finalist needs in the deck (title, rationale) is a `presentation_block`, not the finalist. |
| R6 (Q5) | memory_test, pr_headline | Undecided: item, field or child. | **Child items**, each with an `evaluates` relation pinned to the exact path revision. Content: the test artifact (retelling or headline), a verdict (`pass`, `weak`, `fail`), a rationale. An AI verdict is a `suggestion`; the human verdict is the selected revision of the test, or a user-authored revision. | Not fields: editing a headline would create a new path revision, and an AI headline on a human path would mix authorship inside one revision (breaks invariant 3). Not independent: a test result only means something against the wording it tested. |
| R7 (Q1) | ContentRelation | Item-to-item; relation types overloaded. | `from_revision_id → to_revision_id`, both pinned. Types reduced to `derived_from`, `combines`, `evaluates`, `answers`, `composes`. Add `position` (order for `combines` and `composes`). Immutable, written in the same transaction as the `from` revision. Structural relations (`combines`, `evaluates`, `composes`) are copied onto each new revision of the `from` item. `derived_from` is not copied, since lineage flows through `source_revision_id`. Removed: `alternative_to` (R4); the three `uses_*` (become `combines`, the target's type gives the role); `supports_path` (undefined, and `derived_from` covers path lineage; flag if it meant something else); `composes_output` and `answers_question` renamed. | Revision-exact provenance (C1). Each revision carries its full structure, so nothing has to be reconstructed from time. |
| R8 (Q6) | GenerationRun, **RunInput [new]** | `input_snapshot` is opaque, unchecked and unindexable. | Split it in two. **On the run**: `instruction_version_id`, `model_descriptor` (provider, model name, model version as reported by the provider), `parameters` (generic key/value), `user_directive`, `context_source_version_id`, `rendered_input_hash` + `rendered_input_ref` (exact messages sent, content-addressed), `raw_output_ref`, optional `usage`. **RunInput rows**: `run_id`, `input_kind` (`source_version` or `content_revision`), the reference, `role` (brief, anchor, combination, selected_audience, finalist...), `position`. | References get foreign keys and indexes. Provider-agnostic because provider and model are data, not enums, and the rendered input is stored as text, not as a provider payload. LLMs are not deterministic, so the promise is not "same output." It is "identical input can be replayed, and what was sent and received is fully auditable." |
| R9 (Q7) | **InstructionVersion [new]** | Prompt versions exist only as a vague part of the snapshot. | Prompts live in the repository (reviewed like code) and are registered on deploy as immutable rows: `instruction_key` (equals `run_type`), `version`, `template_text`, `content_hash`, `output_schema_version`. The run references it by foreign key. | Audit without git archaeology. The hash catches "edited the prompt, forgot to bump the version." |
| R10 (Q8) | GenerationRun lifecycle | No retry, idempotency, cancel or partial model. | Add `request_id` (client-generated key for the user's intent), `attempt_number`, `retry_of_run_id`; unique (`request_id`, `attempt_number`). Status: `pending`, `running`, `succeeded`, `partial`, `failed`, `canceled`. Add `error_code` (`timeout`, `provider_error`, `invalid_output`, `content_filtered`, `interrupted`, `canceled_by_user`). Input fields are immutable after insert; status only moves forward; terminal is final. | **Retry** = same request, identical inputs, next attempt. Changed inputs = new request. **Partial** = valid outputs kept, missing ones recorded in the error; terminal, not retried; the user asks for more as a new request. **Canceled** = terminal; a late provider response goes to `raw_output_ref` only and creates no content. **Stuck** `running` past a lease: a sweeper sets `failed / interrupted`. |
| R11 (Q9) | Briefing → **Source**, BriefingVersion → **SourceVersion**, EvidenceLink | `Briefing` is an indirection with no job. Evidence is unverified. | Rename to `Source` with `source_type` (MVP: only `brief`, one per job). EvidenceLink targets `SourceVersion`. Offsets become **required**, in Unicode code points against `raw_text`. `quoted_text` must equal the substring at those offsets. The **server** locates AI quotes (exact match, then whitespace/punctuation-normalized match); an unlocatable quote is never stored as evidence and its claim becomes a `hypothesis`. Evidence version must equal the run's brief version. On SourceVersion remove `created_by_type`, `created_by_user_id`, `supersedes_version_id`; add `text_hash`. | Future sources (client answers, call notes) cost one enum value, not an evidence migration. That is the entire extension; do not add polymorphic evidence now. Verification is what makes invariant 1 real. |
| R12 (Q10) | DecisionEvent | Semantics incomplete (C6); ordering by timestamp (C7). | Actions in the table below. Add `seq` (server-assigned, monotonic per job), `command_id` (groups the events one user action writes atomically), `context_source_version_id`. Rename `created_by_user_id` to `actor_user_id`. Keep it **only here**: this is the record that a human decided. `content_revision_id` is required if and only if the action is revision-scoped. | Every state change has a named undo, a declared scope and an unambiguous replay order. |
| R13 (Q11) | ContentItemState | `current_revision_id` is ambiguous: latest, or selected? | Rename to `latest_revision_id`. Add `job_id`, `content_type`, `has_newer_unselected_revision`, `staleness`, `stale_against_source_version_id`, `last_event_seq` (rebuild watermark). Rejected flags are derived per revision at read time (volume is tiny). | Remove the ambiguity; make drift detectable. |
| R14 (Q12) | Staleness | No mechanism. | Four signals, strongest first, stored only in the projection, never invalidating anything: **1. `evidence_missing`**: an extracted fact whose quote no longer exists in the latest version text (deterministic string check). **2. `input_older`**: an AI revision whose run inputs, transitively, include a non-latest source version or a flagged revision. **3. `input_unselected`**: an output built from a revision that is no longer selected. **4. `context_older`**: a user revision or decision made under an older version, with no dependency data (weak signal). A `revalidated` event under the latest version clears 2 to 4 for that selection. Signal 1 stays until the user edits or rejects: an opinion cannot restore missing evidence. | Operation 8 asks for flags, not invalidation. Graded signals prevent the "everything is stale" noise that makes users ignore flags. |

### Decision semantics (R12)

| Action | Scope | Meaning | Undo |
|---|---|---|---|
| `selected` | revision | This exact wording is what I use downstream. On a `creative_path`: finalist. On a test: I endorse this verdict. | `unselected` |
| `rejected` | revision | This wording is wrong or unusable. Kept for history. | `unrejected` |
| `revalidated` | revision | I checked this selection against the latest brief. It stands. | Not needed; the next event supersedes it |
| `favorited` | **item** | I like this idea, in any wording. | `unfavorited` |
| `discarded` | item | Remove from my working view. | `restored` |
| ~~`approved`~~ | removed | No single-user meaning distinct from `selected`. | |

**Favorite is taste. Select is commitment. Reject is judgment. Discard is housekeeping.**

Favorite is item-scoped because the model's own boundary rule says a wording edit is the same idea, so the star must survive edits.

Removing `approved` is a semantic change. I found no step in the flow that needs it. If you had a use in mind (e.g. "passes tests"), R6 covers it through test verdicts.

### 3.B Deterministic rebuild rules (Q11)

With these rules, ContentItemState can always be rebuilt deterministically.

1. **Order by `seq` only.** Never by timestamp.
2. **Dimensions are independent:** selection (0 or 1 selected revision per item), rejection (per revision), favorite (item), discard (item). No event changes another dimension implicitly.
3. **Cross-dimension effects are explicit events.** Rejecting a selected revision writes `unselected` then `rejected`. Selecting a new audience in a single slot writes `unselected(old)` then `selected(new)`. Same `command_id`. The projection has zero hidden precedence.
4. **Switching revisions** within an item writes `unselected(A)` then `selected(B)`.
5. **Invalid transitions are refused by the command and never enter the log:** selecting a rejected revision, favoriting a favorite, restoring a non-discarded item, unselecting a revision that is not selected.
6. **Discard does not clear selection.** Effective selection = selected and not discarded. Restore returns the item to exactly its prior state, which is what "restore" promises.
7. `latest_revision` = highest `revision_number`. `has_newer_unselected_revision` = latest number > selected number.
8. Staleness is a pure function of revisions, run inputs, evidence, events and the latest source version.
9. The projection is written in the same transaction as the event. `last_event_seq` lets a rebuild verify it.

### 3.C Constraints to enforce eventually (Q13)

1. **Immutability:** no UPDATE or DELETE on SourceVersion, ContentRevision, EvidenceLink, ContentRelation, RunInput, DecisionEvent, InstructionVersion (privileges plus trigger). On GenerationRun only lifecycle columns are updatable, with forward-only transitions.
2. **Uniqueness:** (`source_id`, `version_number`); (`content_item_id`, `revision_number`); (`job_id`, `seq`); (`request_id`, `attempt_number`); (`instruction_key`, `version`) and unique `content_hash`; one `brief` source per job in the MVP.
3. **Same-job integrity:** composite foreign keys including `job_id` for revisions, relation endpoints, run inputs and evidence. A decision's revision must belong to its item.
4. **Authorship:** `author_type = ai` if and only if `generation_run_id` is set. Author/assertion pairs as in R3. A run that produces revisions must end `succeeded` or `partial`.
5. **Evidence:** `extracted_fact` requires at least one EvidenceLink (deferred check at commit). `quoted_text` equals the substring at its offsets. The evidence version equals the run's brief input.
6. **Decision scope:** revision-scoped actions require `content_revision_id`; item-scoped actions forbid it.
7. **Revision lineage:** `source_revision_id` belongs to the same item and has a lower number.
8. **Relations:** endpoints in the same job, no self-edges. Combination cardinality is checked by the application via the registry.
9. **No hard deletes:** foreign keys `ON DELETE RESTRICT`. The only deletion path is an explicit job or account purge (open decision 6).

### 3.D Main risks (Q14)

**Concurrency**
1. **Two tabs or offline edits of the same item** both compute revision n+1. The unique constraint rejects one; the command retries as n+2 while keeping `source_revision_id = n`. History shows the fork; nothing is lost; the UI flags "edited from an older revision."
2. **A run finishes after the user moved on** (discarded an input, new brief version). Save the outputs anyway and flag them stale. Never block writes on staleness.
3. **Two single-slot selections racing.** Per-job `seq` allocation serializes decision commands.
4. **Projection drift** if it is ever written outside the event transaction.

**Referential integrity**
5. **JSON references dangling:** solved by RunInput.
6. **Cross-job links:** solved by composite foreign keys.
7. **Offset units:** JavaScript counts UTF-16 units; the database may count code points. One emoji in a brief shifts every quote after it. Pick one unit and convert at the boundary.

**Data growth**
8. **Autosave.** If every keystroke is a revision, history explodes and "revision" stops meaning anything. **[Rec]** Revisions are written on explicit save, blur or debounced commit; drafts stay on the client and are not history.
9. **Rendered prompts** repeat the brief in every run. Content-addressed storage deduplicates them. For one user this is megabytes, not gigabytes. Just keep blobs out of hot tables.
10. **Copying structural relations** per revision: a small, bounded multiplier.
11. **Privacy:** client briefs are confidential; rendered inputs and raw outputs are copies of them. Purge and retention must cover blob storage too.

### 3.E Simplify now vs keep extensible (Q15)

**Simplify now:** no Briefing indirection beyond Source; no `created_by_user_id` outside DecisionEvent; no `change_type`; no alternative groups; no finalist entity; no `approved`; no relation subtypes per material; no run-event table (lifecycle columns are enough); no per-revision state projection; content types in config, not a table; no per-type tables; list order = creation order (manual ordering, if wanted later, is a mutable preference outside history).

**Keep extensible now, because it is cheap now and expensive later:** revision-pinned relations; RunInput; InstructionVersion; `content_schema_version`; `source_type`; `seq` + `command_id`; `request_id` + `attempt_number`; `context_source_version_id` on revisions and decisions; content-addressed blobs.

---

## 4. Revised conceptual model (v1.2)

Markers: **[ADDED]**, **[REMOVED]**, **[RENAMED]**, **[CHANGED]**, **[SAME]**.

**1. User [SAME]:** the individual creative.
`id, name, email, created_at`

**2. Job [SAME]:** stable container for the process. `status` is mutable operational metadata, not history.
`id, user_id, title, status (active | paused | archived), created_at, updated_at, last_opened_at`

**3. Source [RENAMED from Briefing]:** stable identity of an input document. MVP: exactly one `brief` per job.
`id, job_id, source_type (brief), created_at`

**4. SourceVersion [RENAMED from BriefingVersion]:** immutable raw text.
`id, source_id, job_id, version_number, raw_text, text_hash [ADDED], created_at`
[REMOVED] `created_by_type, created_by_user_id, supersedes_version_id`

**5. InstructionVersion [ADDED]:** immutable prompt template registry.
`id, instruction_key, version, template_text, content_hash, output_schema_version, created_at`

**6. GenerationRun [CHANGED]:** one attempt at one AI request.
`id, job_id, request_id [ADDED], attempt_number [ADDED], retry_of_run_id [ADDED], run_type, instruction_version_id [ADDED], model_descriptor [RENAMED from model_reference], parameters [ADDED], user_directive [ADDED], context_source_version_id [ADDED], rendered_input_hash [ADDED], rendered_input_ref [ADDED], raw_output_ref [ADDED], usage [ADDED, optional], status (pending | running | succeeded | partial | failed | canceled) [CHANGED], error_code [ADDED], error_message, created_at, started_at, completed_at`
[REMOVED] `input_snapshot` (replaced by the fields above plus RunInput)
`run_type` values [CHANGED]: `brief_analysis, alternatives, rewrite, creative_material, creative_path, path_evaluation, presentation_output`

**7. RunInput [ADDED]:** immutable, pinned inputs of a run.
`run_id, input_kind (source_version | content_revision), source_version_id | content_revision_id, role, position`

**8. ContentItem [CHANGED]:** stable identity of a unit of thought.
`id, job_id, content_type, created_at`
[REMOVED] `alternative_group_id, created_by_type, created_by_user_id, archived_at`
Content types [CHANGED]:
Analysis: `business_problem, communication_problem, audience, human_tension, central_message, restriction, open_question`
Materials: `human_truth, brand_element, creative_mechanism` [ADDED, replace `creative_material`]
Structure: `combination`
Ideas: `creative_path`
Evaluations: `memory_test, pr_headline` (child items via `evaluates`)
Output: `presentation` [ADDED], `presentation_block`
[REMOVED] `finalist`

**9. ContentRevision [CHANGED]:** immutable content of an item.
`id, content_item_id, job_id [ADDED], revision_number, content, content_schema_version [ADDED], author_type (ai | user) [RENAMED from authorship], assertion_type, source_revision_id, generation_run_id, context_source_version_id [ADDED], created_at`
[REMOVED] `change_type`

**10. EvidenceLink [CHANGED]:** verified span in a source version.
`id, content_revision_id, source_version_id [RENAMED], quoted_text, start_offset [now required], end_offset [now required], created_at`

**11. ContentRelation [CHANGED]:** immutable, revision-pinned edge.
`id, job_id, from_revision_id [CHANGED from source_item_id], to_revision_id [CHANGED from target_item_id], relation_type (derived_from | combines | evaluates | answers | composes), position [ADDED], created_at`

**12. DecisionEvent [CHANGED]:** immutable human decision.
`id, job_id, seq [ADDED], command_id [ADDED], content_item_id, content_revision_id (required iff revision-scoped), action (selected | unselected | rejected | unrejected | revalidated | favorited | unfavorited | discarded | restored), reason, actor_user_id [RENAMED], context_source_version_id [ADDED], created_at`
[REMOVED] action `approved`

**13. ContentItemState [CHANGED]:** rebuildable projection.
`content_item_id, job_id, content_type, latest_revision_id [RENAMED], selected_revision_id, is_favorite, is_discarded, has_newer_unselected_revision [ADDED], staleness (none | context_older | input_unselected | input_older | evidence_missing) [ADDED], stale_against_source_version_id [ADDED], last_event_seq [ADDED], updated_at`

**14. Content Type Registry [ADDED, application config, not a table]:** per type: content schema version, allowed author/assertion pairs, selection mode, required relations, evidence allowed.

**Relationships:** User 1:N Job · Job 1:1 Source (MVP) · Source 1:N SourceVersion · Job 1:N GenerationRun · GenerationRun 1:N RunInput · GenerationRun 0:1 retry chain · InstructionVersion 1:N GenerationRun · Job 1:N ContentItem · ContentItem 1:N ContentRevision · GenerationRun 1:N ContentRevision · ContentRevision 0:N EvidenceLink · ContentRevision N:N ContentRevision through ContentRelation · ContentItem 1:N DecisionEvent · ContentItem 1:1 ContentItemState

---

## 5. Invariant check

| # | Invariant | Supported | How it is enforced conceptually |
|---|---|---|---|
| 1 | AI must not present missing information as fact | Yes | `extracted_fact` requires a server-verified quote in the exact version. Unlocatable quotes are downgraded to `hypothesis`. Gaps become `open_question` items. |
| 2 | Inferences labeled as hypotheses | Yes | `assertion_type` is required on every AI revision. The registry forbids AI `human_text`. (The UI must render the label; that part is outside the model.) |
| 3 | AI suggestions and human choices distinguishable | Yes | `author_type` per revision; decisions only through user commands, with `actor_user_id`. AI test verdicts are suggestions; the human verdict is a selection. |
| 4 | New generation never overwrites | Yes | Every run creates new items, or new revisions for rewrites. Runs never update content. Retries are new attempt rows. |
| 5 | Revisions and decisions immutable | Yes | No UPDATE/DELETE privileges plus triggers. `content_schema_version` removes any need to migrate in place. |
| 6 | Discard does not delete | Yes | Discard is an event. No delete path except the explicit purge (open decision 6). |
| 7 | Restore creates a new event and keeps the discard | Yes | `restored` event; `discarded` stays; `seq` gives the order. |
| 8 | AI results traceable to exact input context | Yes | Run → InstructionVersion, model descriptor, parameters, user directive, pinned RunInputs, rendered input hash and ref, raw output. |
| 9 | Every extracted fact has evidence in a specific brief version | Yes | EvidenceLink → SourceVersion with verified offsets; deferred check at commit. |
| 10 | Detailed history, lightweight current state | Yes | ContentItemState projection with a `seq` watermark, rebuildable by the rules in §3.B. |

---

## 6. Operation walkthroughs

**C** = created. **U** = updated (projection or run lifecycle only). **Untouched** = records that stay exactly as they were.

**1. Edit an AI suggestion without deleting the original**
C: ContentRevision r2 (`user`, `human_text`, `source_revision_id = r1`, no run, context = current brief version). Structural relations of r1, if any, copied onto r2. If r1 was selected and open decision 2 is "yes": `unselected(r1)` + `selected(r2)`, same `command_id`.
U: ContentItemState.
Untouched: r1, its run, its evidence.

**2. Request alternatives, grouped, not as revisions**
C: GenerationRun (new `request_id`, attempt 1, `alternatives`); RunInputs (anchor revision, brief version, selected context revisions). On success: N ContentItems, each with revision 1 (`ai`, `hypothesis` or `suggestion`, the run) and `derived_from` → anchor revision; N state rows.
U: run lifecycle.
Grouping: batch = run, competition = slot, lineage = `derived_from`. The anchor item gets no new revision.

**3. Regenerate five paths, keep earlier ones**
C: new GenerationRun (new `request_id`, `creative_path`); RunInputs (combination revision, selected analysis revisions, brief version); five `creative_path` items with revision 1 and `derived_from` → combination revision; state rows.
Untouched: all earlier paths, still visible and distinguishable by run.

**4. Select a revision, later detect a newer unselected one**
C: `selected(r2)`. Later, r3 arrives. With decision 2 = "yes", this happens through an AI rewrite (C: rewrite run + r3 `ai`) or an edit made while unselected.
U: state (`latest = r3`, `selected = r2`, `has_newer_unselected_revision = true`).

**5. Reject a hypothesis revision without discarding the item**
C: `rejected(r1, reason)`. If r1 was selected: `unselected(r1)` first, same `command_id`.
U: state. The item stays in the list. r1 cannot be reselected until `unrejected`.

**6. Discard and restore**
C: `discarded(item)`; later `restored(item)`.
U: state `is_discarded`. Selection is preserved throughout.
Untouched: the discard event forever.

**7. New brief version; find outputs based on the old one**
C: SourceVersion v2.
U: staleness in ContentItemState for the job.
Query: revisions whose RunInputs reach v1 transitively, whose evidence cites v1, or whose context is v1; decisions with context v1.
No revision, event or run is created.

**8. Keep earlier choices after a brief update, flagged, not invalidated**
C: nothing automatically. Selections stay. Flags per R14.
The user then chooses: `revalidated` (context v2), an edit (new revision), `unselected` / `rejected`, or a new analysis run on v2 (new items; old items remain selected until the user switches).

**9. Explain an AI output**
Read only: revision → run → InstructionVersion, model descriptor, parameters, user directive → RunInputs (source version + revisions with roles) → recursively their runs → EvidenceLinks (quote + offsets in the exact version text) → rendered input and raw output by reference.

**10. Resume an interrupted job**
C: nothing required.
U: runs stuck `running` past their lease → `failed / interrupted`; `Job.last_opened_at`; the projection is rebuilt if `last_event_seq` trails the log.
Everything saved was committed transactionally. Unsaved local drafts are restored from client storage if present; the model does not guarantee them.

**11. Retry a failed request**
C: GenerationRun attempt 2 (same `request_id`, `retry_of_run_id = R1`, same instruction version and parameters); identical RunInputs (`rendered_input_hash` must match, otherwise it is a new request); outputs on success.
U: the new run's lifecycle only.
Untouched: R1 stays `failed` with its error and raw output. A duplicate retry click hits unique (`request_id`, `attempt_number`) and returns the existing attempt.

**12. Finalist and presentation from exact revisions**
C: `selected(path rK)`, which makes it a finalist (optionally selections on its test revisions). GenerationRun `presentation_output` with RunInputs = the selected finalist revisions, selected analysis revisions, brief version. Outputs: `presentation_block` items (revision 1, `ai`), each with `derived_from` → the exact source revisions; a `presentation` item (revision 1, `ai`, `suggestion`) with `composes` → each block revision, with `position`.
Later block edit: block r2 (`user`) + presentation r2 (`user`, same order, `composes` re-pinned), one command.
U: state.
Result: every sentence in the output traces to a block revision → a finalist revision → a combination revision → material revisions → evidence in one brief version.

---

## 7. Open architectural decisions

These need product or technical input. Everything else above can be settled by modeling practice.

1. **Offline editing in the PWA?** Yes: client-generated IDs (UUIDv7), a sync queue, and the fork handling in §3.D.1 becomes routine. No: forks stay rare. [Rec] Client-generated IDs either way; defer offline.
2. **When a selected revision is edited, does the selection follow the edit?** [Rec] Yes: the edit command writes `unselected` + `selected` under one `command_id`, since it is the user's own act. Operation 4 still happens through AI rewrites.
3. **Selection cardinality per analysis slot.** Business problem, communication problem and central message are surely single. Are audience and human tension single, or can there be a primary and a secondary?
4. **Human truth vs human tension.** Is the selected tension automatically a material in the human truths list? A separate concept? The same one? This decides the type list and the combination rule.
5. **Answers to open questions.** Human notes (`human_text`, never facts), or evidence (a new source type `client_answer`, facts allowed)? [Rec] MVP: `human_text`. If the user wants it as fact, they add it to the brief and create a new version.
6. **Erasure vs "never delete."** LGPD and user-requested deletion of a job or account, plus retention of rendered prompts and raw outputs that contain client text. [Rec] A job-level purge as the only hard delete, logged outside the job.
7. **Presentation shape.** One living presentation per job, or several independent outputs (per round, per client meeting)? Is the block structure a fixed template (context, insight, idea, headline) or free?

[Assume] Test verdicts inform but do not gate finalists, consistent with "the AI never makes the final creative decision."

---

## 8. Recommendation for the next phase

**The revised model is ready to become an ERD once decisions 1 to 4 are answered.** Decision 1 affects keys; decisions 2 to 4 change commands and types, not table shapes. Decisions 5 to 7 can follow the ERD but must precede SQL.

Before generating SQL, decide:
1. Database engine. [Assume] PostgreSQL.
2. ID strategy (client-generated UUIDv7 recommended).
3. The **content schema catalog**: the JSON shape and version for every MVP content type.
4. Offset unit for evidence (code points recommended, with conversion at the client boundary).
5. Immutability mechanism (privileges, triggers, or both).
6. Blob storage for rendered inputs and raw outputs.
7. `seq` allocation and projection write strategy (same transaction).

**Proposed next deliverables:** ERD + content schema catalog + **command catalog** (every user action → the exact records it writes, atomically). I would push hardest for the command catalog. Most of the rules in this review live in commands, not in tables, and that is where a lean model either holds or leaks.
