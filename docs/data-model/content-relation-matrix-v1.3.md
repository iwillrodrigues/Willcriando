# Content Type and Relation Matrix: Review of v1.3, Proposal for v1.4

Labels: **[Req]** confirmed domain decision. **[Rec]** recommendation. **[Assume]** assumption to confirm.

Running example used throughout (fictional brand): **Pausa**, an instant coffee brand losing share among young adults to specialty coffee.

---

## 1. Verdict

**Ready with changes.** The vocabulary is sound, and nothing is structurally unsafe once four contradictions are removed (below).

**Main semantic risk, in one sentence:** for combinations, answers and tests, what makes something a new item or a new revision depends on its structure, not its wording, and the v1.3 rule "wording change = revision" does not cover those cases.

Four contradictions to remove before this becomes policy:

1. **`authorship = brief`.** The brief never authors anything. An AI extraction marked `brief` looks unauthored and hides the run that chose the span (breaks invariants 3 and 4). A user highlighting brief text is `user + extracted_fact` with validated evidence. Remove `brief`.
2. **`presentation_content` duplicates PresentationBlock.** Block text would live in two places. Remove the content type; block text belongs to the immutable PresentationVersion.
3. **`format_version` + `schema_version`.** Two version axes with no stated difference. Keep one `schema_version` per content type; if text markup matters (plain or markdown), declare it inside the schema.
4. **`change_type = import`.** There is no import in the MVP. Remove it. Add `relink` (see §4), which v1.3 needs and lacks.

Two smaller gaps:

5. **DependencyWarning `changed`** implies fuzzy matching, which is not deterministic unless the algorithm is pinned. The warning needs an `algorithm_version`, or it cannot be rebuilt.
6. **`event_sequence` orders only decisions.** To reconstruct "what was selected when this revision was written", revisions need the same per-job counter. Rename it `job_sequence` and assign it to revisions, decisions and requests alike.

---

## 2. Definitions and boundaries

### 2.0 Rules shared by every type

**Assertion by nature of the type.** One rule removes most per-type exceptions:

| Nature | Types | AI may assert | User may assert |
|---|---|---|---|
| **Descriptive** (a claim about reality) | business_problem, communication_problem, audience, human_truth, human_tension, restriction, brand_element, category_element | `extracted_fact` (with evidence) or `hypothesis` | `human_text`, or `extracted_fact` with validated evidence |
| **Prescriptive** (what to say or ask) | central_message, open_question | `extracted_fact` (only when the brief mandates it) or `suggestion` | `human_text`, or `extracted_fact` with validated evidence |
| **Creative** (an idea or device) | creative_mechanism, combination, creative_path, memory_test, pr_headline | `suggestion` | `human_text` |
| **Human only** | human_note | never | `human_text` |

**Evidence policy by assertion:**

| assertion_type | Evidence |
|---|---|
| `extracted_fact` | **Required**: at least one EvidenceLink validated by exact match in an exact SourceVersion, at write time |
| `hypothesis` | **Optional** (grounding: "inferred from this passage") |
| `suggestion` | **Forbidden**, except `open_question` (optional: points to the ambiguous passage) |
| `human_text` | **Forbidden** (to become evidence, the text must enter a new SourceVersion [Req 5]) |

**Validation is synchronous.** A fact is never stored in an "unusable, awaiting validation" state. It is validated in the same transaction, or it is written as the weaker assertion (§7.4). That removes a lifecycle state entirely.

**Authorship and run:** `ai` if and only if `produced_by_run_id` is set.

### 2.1 Per-type definitions

Legend for **Decisions**: S = select (with role), R = reject, F = favorite, D = discard.

**business_problem**
1. What the business needs to change (sales, share, penetration, price).
2. New item: a different business problem. Rewording the same problem is a revision.
3. Authorship: ai, user.
4. Assertion: descriptive.
5. Evidence: per assertion.
6. AI generates: yes (brief_analysis, alternatives).
7. Decisions: S `chosen` (max 1 per job), R, F, D.
8. AI input: yes.
9. Minimum payload: `{statement}`.
10. Example: "Pausa lost 4 share points among 25 to 34 year olds in 2025." (fact, quoted from the brief)

**communication_problem**
1. What must change in people's minds for the business problem to move.
2. New item: a different perception to change.
3. Authorship: ai, user.
4. Assertion: descriptive.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: S `chosen` (max 1 per job), R, F, D.
8. AI input: yes.
9. Minimum payload: `{statement}`.
10. Example: "Young adults see instant coffee as a compromise, not a choice." (hypothesis)

**audience**
1. Who the communication must move.
2. New item: a different group. Refining the description of the same group is a revision.
3. Authorship: ai, user.
4. Assertion: descriptive.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: S `primary` (max 1 per job) / `secondary` (N), R, F, D.
8. AI input: yes.
9. Minimum payload: `{label, description}`.
10. Example: "Hybrid workers, 25 to 34, in large cities." (fact)

**human_truth [Req 2]**
1. An observation about behavior, experience, motivation or context.
2. New item: a different observation.
3. Authorship: ai, user.
4. Assertion: descriptive. An AI truth is a `hypothesis` unless the brief cites it.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: S `chosen` (N), R, F, D.
8. AI input: yes.
9. Minimum payload: `{statement}`.
10. Example: "People reward themselves with small rituals on bad workdays."

**human_tension [Req 3]**
1. A conflict between desire and reality.
2. New item: a different desire or a different reality.
3. Authorship: ai, user.
4. Assertion: descriptive.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: S `primary` (max 1 per job) / `secondary` (N), R, F, D.
8. AI input: yes.
9. Minimum payload: **`{statement, desire, reality}`**. The two required fields make the truth/tension distinction machine-checkable: a tension without both sides is a truth.
10. Example: "I want a real break, but I only have three minutes." desire: a real break; reality: three minutes.

**central_message**
1. The single thing the communication must say.
2. New item: a different proposition.
3. Authorship: ai, user.
4. Assertion: prescriptive.
5. Evidence: required for fact (brief-mandated message), forbidden for suggestion.
6. AI generates: yes.
7. Decisions: S `chosen` (max 1 per job), R, F, D.
8. AI input: yes.
9. Minimum payload: `{statement}`.
10. Example: "Pausa turns three minutes into a real break." (suggestion)

**restriction**
1. A mandatory or a prohibition the work must respect.
2. New item: a different rule.
3. Authorship: ai, user.
4. Assertion: descriptive. An inferred regulatory rule is a `hypothesis`.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: S `chosen` (N), meaning "in force"; R; D. F forbidden: taste does not apply to a rule.
8. AI input: yes.
9. Minimum payload: `{statement, kind: mandatory | prohibited}`.
10. Example: "Do not show the product prepared with milk." (fact, prohibited)

**open_question**
1. Information missing from the brief that the creative should obtain.
2. New item: a different question.
3. Authorship: ai, user.
4. Assertion: prescriptive (AI questions are `suggestion`).
5. Evidence: optional (the ambiguous passage).
6. AI generates: yes. **This is where invariant 1 lands:** missing information becomes a question, never a fact.
7. Decisions: S `chosen` (N), meaning "to ask"; R (irrelevant); D.
8. AI input: yes.
9. Minimum payload: `{question}`.
10. Example: "Does the new jar launch before the campaign?"

**human_note [Req 5]**
1. The human's answer to one open question.
2. **New item: an answer to a different question.** A changed answer to the same question is a **new revision** (the item's identity is "my answer to Q", not the proposition). History shows how the answer changed.
3. Authorship: **user only**. AI never writes one, because an AI answer would be invented information.
4. Assertion: `human_text` only.
5. Evidence: forbidden. The note never becomes evidence unless its content is added to a new SourceVersion.
6. AI generates: no.
7. Decisions: D only. Retract by editing or discarding. Selecting or rejecting your own answer has no meaning.
8. AI input: yes, only with role `human_note`. The AI must treat it as human context and may never cite it as evidence for an `extracted_fact`.
9. Minimum payload: `{text}`, plus exactly one `answers` relation.
10. Example: "Client confirmed by email: the jar launches in March."

**brand_element**
1. Something the brand owns: product attribute, name, heritage, asset, tone.
2. New item: a different element.
3. Authorship: ai, user.
4. Assertion: descriptive. **Brand claims from model knowledge are `hypothesis`** and must be verified.
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: R, F, D. No S: commitment to a material happens by using it in a combination.
8. AI input: yes.
9. Minimum payload: `{name, description}`.
10. Example: "The name literally means 'pause'." (fact)

**category_element**
1. A code or convention of the category, to use or to break.
2. New item: a different code.
3. Authorship: ai, user.
4. Assertion: descriptive (usually `hypothesis`).
5. Evidence: per assertion.
6. AI generates: yes.
7. Decisions: R, F, D.
8. AI input: yes.
9. Minimum payload: `{name, description}`.
10. Example: "Coffee ads show slow mornings and rising steam."

**creative_mechanism**
1. A device that turns material into an idea: reversal, exaggeration, format hijack, real-time stunt.
2. New item: a different device.
3. Authorship: ai, user.
4. Assertion: creative.
5. Evidence: forbidden. A mandated format is a `restriction`, not a mechanism.
6. AI generates: yes.
7. Decisions: R, F, D.
8. AI input: yes.
9. Minimum payload: `{name, description}`.
10. Example: "Time compression: a full ritual shown in real time, in three minutes."

**combination**
1. A deliberate collision of exact material revisions.
2. **Identity = the set of member items.** A different member item means a new combination. Re-pinning a member to a newer revision of the same item, or changing the label, is a new revision (`relink` or `user_edit`).
3. Authorship: ai, user.
4. Assertion: creative.
5. Evidence: forbidden.
6. AI generates: yes, through combination_suggestion, and only from members given as inputs. [Decision PO-4]
7. Decisions: R, F, D. No S: generating a path from it is the commitment, and RunInput records that.
8. AI input: yes.
9. Minimum payload: `{}` (optional `label`, `rationale`), plus `combines` edges meeting the composition rule (§4).
10. Example: tension "real break vs three minutes" × brand "name means pause" × mechanism "time compression".

**creative_path**
1. A creative direction, defensible in one sentence.
2. New item: a different idea. Rewording, or adding a sketch to the same idea, is a revision.
3. Authorship: ai, user.
4. Assertion: creative.
5. Evidence: forbidden. Facts reach the presentation through cited revisions, not path text.
6. AI generates: yes.
7. Decisions: S `finalist` (N), R, F, D.
8. AI input: yes.
9. Minimum payload: `{title, idea}`. `idea` is one sentence; a length cap is product policy.
10. Example: title "The three-minute holiday"; idea "Pausa sells three-minute holidays, packaged in a jar."

**memory_test**
1. How a person would retell the path after one exposure, with a verdict.
2. **New item: a test of a different path revision.** It never follows the path to a new revision. Editing the retelling or verdict is a revision.
3. Authorship: ai, user.
4. Assertion: creative. An AI verdict is a `suggestion`.
5. Evidence: forbidden.
6. AI generates: yes (path_evaluation).
7. Decisions: S `chosen` (max 1 per evaluated path revision), meaning "I endorse this verdict"; R; D. No F.
8. AI input: yes (presentation_draft).
9. Minimum payload: `{retelling, verdict: pass | weak | fail}`, plus exactly one `evaluates`.
10. Example: retelling "The coffee that sells three-minute holidays." verdict pass.

**pr_headline**
1. The headline the idea would earn in the press. It is both a test and a piece of copy.
2. Identity rule: same as memory_test.
3. Authorship: ai, user.
4. Assertion: creative.
5. Evidence: forbidden.
6. AI generates: yes.
7. Decisions: S `chosen` (max 1 per evaluated path revision), R, F (headlines are copy; taste applies), D.
8. AI input: yes.
9. Minimum payload: `{headline}` (optional `verdict`, `rationale`), plus exactly one `evaluates`.
10. Example: "Coffee brand starts selling three-minute holidays to burned-out workers."

### 2.2 Flags

| Type | Flag | Reason |
|---|---|---|
| `presentation_content` | **Remove; move to PresentationBlock** | It is a presentation block. Keeping both puts block text in two places (principle 4). Block authorship and run provenance live on the block and its PresentationVersion. |
| `human_note` | **Keep, constrain** (exactly one `answers`) | Without the constraint it becomes a general-purpose back door for unlabeled "facts". Renaming to `question_answer` would be more honest; kept as is because it was confirmed. |
| `combination` | **Keep, with a structural identity rule** | It is a structure, but it carries decisions (F, R, D) and is a generation input, so it needs ContentItem identity. |
| `memory_test`, `pr_headline` | **Keep separate** | Different payloads and favorite policy. Merging them saves nothing. |
| `brand_element`, `category_element` | **Keep separate** | Different creative use: exploit an owned asset vs use or break a shared code. |
| `finalist` | Stays excluded [Req 7] | Finalist is a role on a DecisionEvent. |

---

## 3. Content type matrix

Selection roles: `chosen`, `primary`, `secondary`, `finalist`. Scope: J = per job; P = per evaluated path revision. Every type allows D. "AI input" means allowed as a GenerationRequest input; rejected revisions are allowed only with role `anchor` (§6.5), and discarded items never.

| content_type | Purpose | Authorship | Assertion (ai / user) | Evidence | Decisions | AI input | Special invariants |
|---|---|---|---|---|---|---|---|
| business_problem | Business change needed | ai, user | fact, hypothesis / human_text, fact* | fact: req; hyp: opt; else forbidden | S chosen ≤1 J; R; F | yes | none |
| communication_problem | Perception to change | ai, user | fact, hypothesis / human_text, fact* | same | S chosen ≤1 J; R; F | yes | none |
| audience | Who to move | ai, user | fact, hypothesis / human_text, fact* | same | S primary ≤1 J, secondary N; R; F | yes | One role per item |
| human_truth | Observation | ai, user | fact, hypothesis / human_text, fact* | same | S chosen N; R; F | yes | none |
| human_tension | Desire vs reality | ai, user | fact, hypothesis / human_text, fact* | same | S primary ≤1 J, secondary N; R; F | yes | Payload requires `desire` and `reality` |
| central_message | Single proposition | ai, user | fact, suggestion / human_text, fact* | fact: req; else forbidden | S chosen ≤1 J; R; F | yes | none |
| restriction | Mandatory or prohibition | ai, user | fact, hypothesis / human_text, fact* | fact: req; hyp: opt | S chosen N ("in force"); R; no F | yes | Warning if a fact restriction is not selected |
| open_question | Missing information | ai, user | suggestion / human_text | optional (the gap) | S chosen N ("to ask"); R; no F | yes | Missing information becomes this type, never a fact |
| human_note | Answer to one question | **user only** | none / human_text | forbidden | D only | yes, role `human_note` only | Exactly one `answers`; never evidence |
| brand_element | Owned asset or attribute | ai, user | fact, hypothesis / human_text, fact* | fact: req; hyp: opt | R; F; no S | yes | Hypothesis cited as `supports` in a presentation gives a warning |
| category_element | Category code | ai, user | fact, hypothesis / human_text, fact* | same | R; F; no S | yes | none |
| creative_mechanism | Creative device | ai, user | suggestion / human_text | forbidden | R; F; no S | yes | none |
| combination | Collision of materials | ai, user | suggestion / human_text | forbidden | R; F; no S | yes | Identity = member item set; composition rule; AI members only from inputs |
| creative_path | Direction | ai, user | suggestion / human_text | forbidden | S finalist N; R; F | yes | 0..1 `based_on`; `finalist` is the only role |
| memory_test | Retelling + verdict | ai, user | suggestion / human_text | forbidden | S chosen ≤1 P; R; no F | yes | Exactly one `evaluates`; never re-pinned |
| pr_headline | Earned headline | ai, user | suggestion / human_text | forbidden | S chosen ≤1 P; R; F | yes | Exactly one `evaluates`; never re-pinned |

\* User `extracted_fact` is allowed only with a validated EvidenceLink created in the same command (the "highlight in the brief" action).

**Context rules:**

1. **AI never receives a selection automatically.** Only user commands write DecisionEvents (invariant 3). An `ai_rewrite` of a selected revision leaves the selection on the old revision.
2. **Rewriting a fact.** An `ai_rewrite` or `user_edit` of an `extracted_fact` produces a fact only if new evidence is validated in the same command. Otherwise it produces `hypothesis` (AI, descriptive type), `suggestion` (AI, prescriptive type) or `human_text` (user).
3. **The type of an item never changes.** ContentItem is fully immutable.

---

## 4. Relation vocabulary

Five types. **Convention: `from` is always the dependent revision, `to` is the revision it depends on.** Every relation is written in the same transaction as its `from` revision and is immutable. A relation has no authorship of its own: it inherits the authorship of its `from` revision.

**Structural guarantees that make validation simple:**

1. **No cycles, by construction.** Every allowed pair connects different types in a fixed order (note → question, tension → truth, combination → materials, path → combination, test → path). No runtime cycle detection is needed.
2. **Cardinality is fully checkable at write time.** Every minimum and maximum is on the outgoing side, and all of a revision's outgoing edges are created with it. Incoming sides are all 0..N.
3. **Same job, always.** Enforced by composite keys with `job_id`.
4. **No duplicates.** Unique (`from_revision`, `to_revision`, `relation_type`). For `combines`, also unique (`from_revision`, `to_item`): no two revisions of the same member item in one combination.

**When either side receives a new revision:**

1. **Source side (the `from` item gets revision n+1).** Its outgoing edges are **carried forward** onto n+1, pinned to the same targets, unless the command explicitly changes them where re-pinning is allowed. A relation-only change uses `change_type = relink`.
2. **Target side (the `to` item gets a new revision).** **Nothing moves.** Principle 7. A projection warning `target_superseded` appears on the source.

| | `answers` | `grounded_in` | `combines` | `based_on` | `evaluates` |
|---|---|---|---|---|---|
| **Meaning** | This note answers this question | This tension rests on this truth | This combination includes this exact material | This path was built from this exact combination | This test judges this exact path revision |
| **From → to** | human_note → open_question | human_tension → human_truth | combination → human_truth, human_tension, brand_element, category_element, creative_mechanism | creative_path → combination | memory_test, pr_headline → creative_path |
| **Out cardinality** | exactly 1 | 0..5 | composition rule below | 0..1 | exactly 1 |
| **In cardinality** | 0..N | 0..N | 0..N | 0..N | 0..N |
| **Duplicates** | no | no | no, and one revision per member item | no | no |
| **Cycles** | impossible | impossible | impossible | impossible | impossible |
| **Written by** | user | ai (analysis may propose) or user | ai (combination_suggestion) or user | derived by the generation command from the request, or user | derived by the evaluation command from the request, or user |
| **Same job** | yes | yes | yes | yes | yes |
| **Source edited** | carried; re-pin to a newer question revision allowed | carried; add, remove or re-pin allowed (`relink`) | carried; re-pin to a newer revision of the **same** item allowed; a different item means a new combination | carried; **no re-pin** (historical fact) | carried; **no re-pin**: a new path revision needs a new test item |
| **Target edited** | warning; the answer may no longer fit | warning | warning; path generation from a stale combination is allowed but flagged | warning | none needed: the test is about that wording by definition |
| **Valid** | "Jar launches in March" → "Does the jar launch before the campaign?" r1 | "real break vs three minutes" r2 → "people reward themselves with small rituals" r1 | combination r1 → tension r2, brand element r1, mechanism r1 | "Three-minute holiday" r1 → combination r1 | memory test r1 → "Three-minute holiday" r2 |
| **Invalid** | note → human_truth (wrong target type); an AI-authored note | truth → tension (wrong direction) | combination → central_message (strategy is not material); two revisions of the same truth | path → two combinations; path → brand_element | test with no `evaluates`; the edge carried to path r3 after the path was edited |

**Combination composition rule** (policy default, configurable) [Decision PO-1]: at least one human side (`human_truth` or `human_tension`), at least one brand side (`brand_element` or `category_element`), at most one `creative_mechanism`, at most five members in total.

**Removed or never adopted:** `alternative_to`, `derived_from`, `uses_*`, `supports_path`, `composes_output`, `related_to`. Each is covered below by a narrower mechanism.

---

## 5. Relation compatibility matrix

### 5.1 ContentRelation pairs (rows = from, columns = to)

| from \ to | open_question | human_truth | human_tension | brand_element | category_element | creative_mechanism | combination | creative_path |
|---|---|---|---|---|---|---|---|---|
| human_note | answers | | | | | | | |
| human_tension | | grounded_in | | | | | | |
| combination | | combines | combines | combines | combines | combines | | |
| creative_path | | | | | | | based_on | |
| memory_test | | | | | | | | evaluates |
| pr_headline | | | | | | | | evaluates |

Every other pair is invalid. The tables in §4 and §5.1 are the whole ContentRelation policy.

### 5.2 Which mechanism holds which fact

**Authority rule:**
1. RunInput is authoritative for **what the AI saw**.
2. ContentRelation is authoritative for **what a revision is built on or about**.
3. DecisionEvent is authoritative for **what the human committed to**.
4. PresentationBlockReference is authoritative for **what a presentation shows**.

Where two of them record the same pair, a write-time validation requires them to agree.

| # | Case | Mechanism | Authoritative record and why |
|---|---|---|---|
| 1 | human_truth → human_tension | **ContentRelation `grounded_in`** (tension → truth). Also RunInput if AI generated the tension with truths as input. | Not a duplicate: the AI may see ten truths and ground the tension in one. RunInput = seen; `grounded_in` = claimed basis. |
| 2 | open_question → human_note | **ContentRelation `answers`** (note → question). RunInput role `human_note` only when a note feeds a later generation. | `answers` is authoritative. |
| 3 | Strategic revisions → combination | **Not a relation.** Problems, audience and message are the frame shared by every combination; they enter path generation as **RunInput** context. Truths and tensions can still be members, because they are also material. | RunInput. Putting strategy in every combination would duplicate the frame N times. |
| 4 | Creative material → combination | **ContentRelation `combines`**. Plus RunInput when AI proposed the combination. | `combines` defines the combination's identity. |
| 5 | Combination → creative_path | **ContentRelation `based_on`** plus **RunInput** role `combination` for AI paths. | `based_on` is authoritative for lineage and is the only record for user-written paths. RunInput is authoritative for execution. Validation: for an AI path, `based_on` must equal the request's `combination` input. |
| 6 | Strategy (problems, audience, tension, message) → creative_path | **RunInput only** (roles such as `chosen_business_problem`, `primary_audience`, `secondary_audience`, `primary_tension`, `central_message`, `restriction`). | RunInput. For user-written paths, the strategic context is reconstructed as-of the revision's `job_sequence` from the decision log. No relation needed. |
| 7 | creative_path → memory_test | **ContentRelation `evaluates`** (test → path) plus RunInput role `subject`. | `evaluates` is authoritative. A path_evaluation request takes exactly one subject, so the command writes the edge; the AI never chooses it. |
| 8 | creative_path → pr_headline | Same as 7. | Same as 7. |
| 9 | Alternatives | **No relation and no group id.** Competition = same content type in the same job, governed by selection policy. Batch = GenerationRequest. AI lineage = RunInput role `anchor`. User-written alternatives are independent items. | RunInput for lineage. The question "which one wins" is answered by DecisionEvent, which is the only place competition matters. |
| 10 | Presentation content | **PresentationVersion → PresentationBlock** (text, position, authorship, `derived_from_block_id`) → **PresentationBlockReference** (exact ContentRevision, role, position). No ContentItem, no ContentRelation. Reference roles: `presents` (the idea shown), `supports` (strategic backing or fact), `evaluation` (a test shown). | PresentationBlockReference for what is shown; DecisionEvent for finalist status. Showing a non-finalist path gives a warning, not an error. |

---

## 6. Selection and decision policy

### 6.1 Where the role lives

Put it in a **controlled `selection_role` column on DecisionEvent**, required for `selected` and `unselected` and null for every other action.

Not in a payload: the role is part of the replay key and of uniqueness checks, so it must be typed and indexable. Not in another record: a role is an attribute of the commitment itself.

### 6.2 Policies

**1 and 2. Audience and human tension: one primary, several secondaries [Req 4]**
1. Each item holds at most one active selection (one revision, one role).
2. At most one `primary` per job per type.
3. A secondary without a primary is allowed and produces a warning [Decision PO-2].
4. **Promote B to primary while A is primary.** One command writes, in order: `unselected(A, primary)`, `selected(A, secondary)` (default demotion; product may choose plain unselect), `unselected(B, secondary)`, `selected(B, primary)`.
5. **Change role on the same item:** `unselected(old role)` + `selected(new role)`, same `command_id`.

**3. Finalists [Req 7]**
1. Role `finalist` on a `creative_path` revision.
2. At most one per item. Optional cap per job, in config [Decision PO-3].
3. The target revision must be neither rejected nor on a discarded item.
4. Tests do not gate finalists [Assume]. A finalist without a chosen test on its current revision gives a warning.

**4. Selection moves after an edit [Req 10]**
1. The trigger is a `user_edit` whose `source_revision_id` is the currently selected revision.
2. The command writes: new revision rN+1, `unselected(rN, role)`, `selected(rN+1, same role)`, one `command_id`.
3. Editing from a non-selected revision does not move the selection.
4. An `ai_rewrite` never moves it.
5. Relations, RunInputs and block references pinned to rN stay pinned.
6. Tests evaluating rN stay on rN.

**5. Reject and unreject**
1. Revision-scoped. Rejecting one revision does not affect the item or its other revisions.
2. Rejecting a selected revision requires `unselected` first, in the same command.
3. A rejected revision cannot be selected, cannot be the target of a **new** relation, and can be an AI input only as `anchor` (to ask "rewrite this").
4. `unrejected` restores eligibility. It does not restore a prior selection.

**6. Favorite scope: ContentItem**
1. Favorite is coherent at item level because the type rules define the item as the idea, and a wording change is by definition the same idea.
2. A revision-level favorite would vanish on every typo fix.
3. Precision belongs to selection, not favorite.

**7. Discard and restore [Req 11]**
1. Discard changes only `is_discarded`.
2. Selection, rejection and favorite stay as they were.
3. The discard command may bundle explicit `unselected` / `unfavorited` events if the user asks.
4. On a discarded item these are **allowed**: `restored`, `unselected`, `unfavorited`, `rejected`, `unrejected`.
5. These are **forbidden**: `selected`, `favorited`, new relations targeting it, and use as an AI input.
6. Downstream "effective selection" = selected and not discarded. A selected discarded item produces a warning, and it still counts for cardinality until it is explicitly unselected.
7. Restore returns the item exactly to its prior state.

### 6.3 Deterministic rebuild

1. **Fold** every DecisionEvent in `job_sequence` order:
   1. `selected` adds (item, revision, role);
   2. `unselected` removes it;
   3. `rejected` / `unrejected` toggle the revision flag;
   4. `favorited` / `unfavorited` and `discarded` / `restored` toggle item flags.
2. **The fold is policy-free.** No validation and no implicit side effects. All policy runs at command time, and every event records `policy_version`. Events written under an older policy therefore replay identically after the matrix changes.
3. A rebuild that disagrees with the stored projection is a data incident. It is reported, never auto-corrected by guessing.

### 6.4 Uniqueness constraints and command validations

These are enforced by partial unique indexes on the selection projection, which is updated in the same transaction as the event:

1. One active selection per item.
2. One `primary` per (job, content_type) for audience and human_tension.
3. One `chosen` per (job, content_type) for business_problem, communication_problem and central_message.
4. One `chosen` per (evaluated path revision, content_type) for memory_test and pr_headline. The projection row stores the evaluated revision as its scope key.

Command validations: the role is allowed for the type; the target is not rejected and not discarded; the displaced holder is explicitly unselected in the same command; `unselected` names the active role; no-op events are refused.

---

## 7. Validation catalog

### 7.1 Database-enforceable constraints

1. **Append-only** SourceVersion, ContentItem, ContentRevision, ContentRelation, EvidenceLink, DecisionEvent, GenerationRequest, RunInput, PresentationVersion, PresentationBlock, PresentationBlockReference. Enforced with no UPDATE/DELETE privileges plus a trigger. The only exception is the administrative erasure path [Req 9], run under a separate role.
2. **Composite foreign keys with `job_id`** on every cross-record reference (invariant 14).
3. **Unique:** (item, revision_number); (job, job_sequence); (from_revision, to_revision, relation_type); (from_revision, to_item) for `combines`; (request, attempt_number).
4. **Check `authorship` / run:** `ai` iff `produced_by_run_id` is not null.
5. **Check global authorship / assertion pairs:** `user` allows only human_text or extracted_fact; `ai` never allows human_text.
6. **Check `change_type` consistency:**
   1. `initial` iff revision 1 iff no `source_revision_id`;
   2. `ai_rewrite` requires `ai`;
   3. `user_edit` and `relink` require `user`.
7. **Check decision shape:**
   1. revision-scoped actions require `content_revision_id`, item-scoped actions forbid it;
   2. `selection_role` is required iff the action is `selected` or `unselected`;
   3. the revision must belong to the event's item (composite foreign key).
8. **Check evidence offsets:** start < end. `quoted_text` equals the substring at the offsets (trigger, or command if the engine makes that awkward).
9. **Selection partial unique indexes** (§6.4).
10. **Deferred check at commit:** an `extracted_fact` has at least one EvidenceLink.

### 7.2 Transactional command validations

Every failure here **rejects the command**. Nothing is written.

1. Payload matches the type's schema version.
2. The (type, authorship, assertion) triple is allowed by the matrix.
3. Evidence is located by exact match in a SourceVersion of the job's source. If the quote appears more than once, take the first occurrence.
4. Relation pairs are allowed (§5.1) and outgoing cardinality is met (§4).
5. The combination composition rule holds. A new revision keeps the same member item set; a changed set means a new item.
6. `based_on` and `evaluates` are carried forward unchanged.
7. New relations never target rejected revisions or discarded items. Carried-forward edges are exempt and produce warnings.
8. Decision transitions are valid against the projection, read under the job lock (§6).
9. Selection movement on edit is written explicitly (§6.2.4).
10. GenerationRequest inputs:
    1. types and roles are allowed for the request kind;
    2. required inputs are present;
    3. no discarded items;
    4. rejected revisions only as `anchor`;
    5. all in the same job.
11. A retry reuses the request unchanged and creates a new run attempt. Changed intent means a new request.
12. `job_sequence` is allocated under a per-job lock. Online-only [Req] makes this sufficient; there is no merge.

### 7.3 Asynchronous and projection rules

Every failure here **creates a warning**. It never writes an event, never rewrites history, never revokes a decision.

1. **Evidence drift** (DependencyWarning), on each new SourceVersion:
   1. `current`: same text at the same offsets;
   2. `moved`: exact text elsewhere (nearest to the original offset; ties go to the lowest offset);
   3. `changed`: found only after normalization;
   4. `missing`.
   
   Store `algorithm_version`. The warning compares; it never edits the EvidenceLink.
2. `target_superseded`: a relation, RunInput or block reference points to a revision that is no longer its item's latest.
3. `target_inactive`: the target was rejected or its item discarded after the link was made.
4. **Selection health:**
   1. secondary without primary;
   2. selected but discarded;
   3. finalist without a chosen test on its selected revision;
   4. fact restriction not selected (unacknowledged mandate).
5. **Presentation health:**
   1. `supports` cites a `hypothesis`;
   2. `presents` cites a non-finalist;
   3. a reference is superseded.
6. Open questions without an answer.
7. A periodic rebuild compares the stored projection with a replay.

### 7.4 AI output validation

The raw response is always preserved on the GenerationRun.

| Failure | Behavior |
|---|---|
| Unparseable or schema-invalid output | **Preserve the raw response, create nothing.** Run `failed / invalid_output`. |
| Some items valid, some not | Create the valid ones. Run `partial`. Report each dropped item. |
| Type not allowed for the request kind, AI `human_text`, AI `human_note` | Drop the item and report it. |
| `extracted_fact` whose quote is not found exactly in the input SourceVersion, or that cites a version not in RunInput | **Downgrade**: `hypothesis` for descriptive types, `suggestion` for prescriptive types. Create the item with warning `claimed_fact_unverified`. It **requires human review** before selection. |
| `human_tension` without `desire` and `reality` | Drop, or reclassify as `human_truth` **only if** the request kind allows truths. Report it. |
| AI-proposed relation targets a revision that is neither a RunInput nor an output of the same run | Drop the relation. If the relation is mandatory for the item (`combines` composition), drop the item. |
| Implied relations (`based_on`, `evaluates`) | Written by the command from the request structure, never taken from the AI. |
| Output count differs from the requested count | Keep what is valid. Run `partial` if fewer. |
| Verbatim duplicate of an existing item (payload hash) | Create it, with warning `duplicate_of`. |
| Suggestion text that asserts brief facts ("the brief says...") | **Not machine-enforceable.** Prompt policy and human review. |

### 7.5 Product policy, not database constraints

1. Combination composition limits [PO-1].
2. Secondary without primary: warn or block [PO-2].
3. Finalist cap and demotion default [PO-3].
4. Whether AI may propose combinations [PO-4].
5. Verdict scales for tests.
6. The one-sentence cap on `creative_path.idea`.
7. Presenting non-finalists.
8. **What counts as "semantically different".** The UI decides this by offering distinct *Edit* and *New alternative* commands. The database cannot judge meaning.

---

## 8. v1.4 changes and unresolved decisions

### 8.1 Final content type list (16)

business_problem, communication_problem, audience, human_truth, human_tension, central_message, restriction, open_question, human_note, brand_element, category_element, creative_mechanism, combination, creative_path, memory_test, pr_headline

### 8.2 Final relation type list (5)

answers, grounded_in, combines, based_on, evaluates

### 8.3 Removed or renamed

| Change | Reason |
|---|---|
| `presentation_content` removed | Duplicates PresentationBlock text |
| `authorship = brief` removed | The brief is a source, not an author |
| `change_type = import` removed; `relink` added | No import in the MVP; relation-only revisions needed a name |
| `format_version` merged into `schema_version` | Two version axes with no defined difference |
| `event_sequence` renamed `job_sequence` and extended to revisions and requests | As-of reconstruction of context for user-written content |
| `alternative_to`, `alternative_group_id`, `derived_from`, `uses_*` never adopted | Covered by type + selection (competition), request (batch), RunInput `anchor` (lineage), `combines` |

### 8.4 Required fields

1. **ContentItem:** `id, job_id, content_type, created_at`. Fully immutable.
2. **ContentRevision:**
   1. `+ job_id`, `+ job_sequence`, `+ policy_version`;
   2. `authorship: ai | user`;
   3. `change_type: initial | user_edit | ai_rewrite | relink`;
   4. single `schema_version`.
3. **ContentRelation:** `id, job_id, from_revision_id, to_revision_id, to_item_id` (denormalized for the `combines` uniqueness; composite foreign key with `to_revision_id`), `relation_type, position` (nullable; order of combination members), `created_at`.
4. **DecisionEvent:** `+ selection_role` (`chosen | primary | secondary | finalist`), `+ command_id`, `+ policy_version`. `job_sequence` replaces `event_sequence`.
5. **DependencyWarning:** `+ warning_kind` (`evidence_drift | target_superseded | target_inactive | selection_health | presentation_health`), `+ algorithm_version`. Its status values apply to `evidence_drift`.
6. **PresentationBlock:** `authorship`, `derived_from_block_id`. **PresentationVersion:** `produced_by_run_id` (nullable).

### 8.5 Application configuration structure

One versioned document (`policy_version`) with four sections. Every row is testable as a table-driven case:

1. **content_types:** per type:
   1. `nature`;
   2. `schema_versions` + current;
   3. allowed assertions per authorship;
   4. evidence policy per assertion;
   5. required payload fields;
   6. allowed decisions;
   7. selection roles with max and scope (job or evaluated path revision);
   8. allowed as input (per request kind and role);
   9. identity rule (documentation plus its validation hook).
2. **relation_types:** per type:
   1. allowed (from, to) pairs;
   2. outgoing min and max;
   3. unique target item;
   4. carry-forward;
   5. re-pin allowed;
   6. new targets must be active.
3. **request_kinds:** per kind:
   1. input roles with allowed types, min, max, and whether rejected is allowed;
   2. allowed output types;
   3. implied relations.
   
   MVP kinds: `brief_analysis`, `alternatives`, `rewrite`, `material_expansion`, `combination_suggestion`, `path_generation`, `path_evaluation`, `presentation_draft`.
4. **warnings:** kind, severity, and whether a warning blocks selection until reviewed (only `claimed_fact_unverified` does).

### 8.6 Decisions for the product owner

1. **PO-1:** combination composition. Is the default (≥1 human side, ≥1 brand side, ≤1 mechanism, ≤5 total) right, or must there always be a mechanism?
2. **PO-2:** secondary audience or tension without a primary. Warn (recommended) or block?
3. **PO-3:** finalist cap per job? When a new primary is chosen, does the old one become secondary (recommended) or get unselected?
4. **PO-4:** may the AI propose combinations, or is combining a purely human act? This is the most "creative judgment" step in the flow; keeping it human is a defensible product stance.
5. **PO-5:** standalone human notes (not answering a question). Excluded here to keep notes from becoming unlabeled facts. Needed?
6. **PO-6:** presentation lifecycle. Can a presentation be discarded or favorited? (DecisionEvent currently targets only ContentItem.) Can AI rewrite a single block, which would add `presentation_version` as a RunInput kind?

### 8.7 Migration note, v1.3 to v1.4

[Assume] No production data yet, so this is a vocabulary change, not a data migration.

If any data exists:
1. `presentation_content` revisions become block text in their PresentationVersions.
2. `brief` authorship becomes `ai` (when a run exists) or `user` (with evidence revalidated).
3. The two version fields collapse into `schema_version`.
4. Existing `selected` events get a role by type (`finalist` for paths, `primary` for the first audience or tension, otherwise `chosen`).
5. Revisions get `job_sequence` backfilled in `created_at` order, with id as the tie-break. This is done once and never repeated.

### 8.8 Go or no go

**Go** for acceptance criteria, on the confirmed decisions plus the defaults above. PO-1 and PO-4 should be answered first, because they change which tests get written for combinations. The rest can be settled while writing criteria.

Suggested shape for the acceptance criteria: one table-driven suite generated from the §8.5 configuration, which covers every type × authorship × assertion, every relation pair, and every decision transition, plus one scenario per walkthrough. If the matrix is right, most of the tests write themselves.
