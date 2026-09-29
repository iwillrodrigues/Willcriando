# Acceptance Criteria: Data Model v1.4

Primary reference: `docs/data-model/content-relation-matrix-v1.3.md` (approved), as amended by the 25 confirmed v1.4 decisions (listed in Appendix A, referenced as **D1** to **D25**).

This package is self-contained: every rule needed to derive a test is stated here. Where the approved material does not settle a rule, the criterion is marked **[Default OI-n]** or **[Default C-n]** and the gap is described in §13. Defaults are recommendations, not approved policy. Tests built on them must be tagged so they can be changed when the product owner decides.

**Revision 2.** Four further product decisions, **R1** to **R4** (Appendix B), resolve former issues C-1, C-2, OI-3 and OI-16. Criteria that depend only on those decisions no longer carry a default marker.

**Revision 3.** Decisions **R5** to **R8** (Appendix B) resolve C-3, OI-21 and OI-22, and confirm the retry reading of AC-COMB-029. They also exposed C-4, OI-23 and OI-24.

**Revision 4.** Decisions **R9** to **R11** (Appendix B) resolve C-4, OI-23 and OI-24. They exposed C-5 and OI-25 to OI-27.

**Revision 5.** Decisions **R12** to **R15** (Appendix B) resolve C-5, OI-25, OI-26 and OI-27. They expose two new gaps (OI-28, OI-29), described in §13.

---

## 1. Scope and terminology

### 1.1 What these criteria cover

**Covered:**
1. The domain data model of one job.
2. The policy layer that validates commands against it.
3. The projections rebuilt from it.
4. The validation of AI output before it becomes content.

**Not covered:**
1. UI behavior (except where a rule is explicitly UI-only, marked [POL]).
2. API shape, storage engine, SQL, performance, authentication mechanics.
3. Prompt quality, and the semantic truth of AI text.
4. Offline editing. The MVP requires a connection for editing and generation.

**System boundary.** A *command* is one user or system intent submitted to the domain layer, for example "edit revision", "select", or "commit run output". A command is atomic: it commits all of its records or none of them.

### 1.2 Terms

| Term | Meaning in these criteria |
|---|---|
| **Job** | Stable container for one creative process. Owned by exactly one user. Carries the counter `job_version`. |
| **Source** | Stable identity of an input source. MVP: exactly one `source_type = brief` per job. |
| **SourceVersion** | Immutable text version of a Source: `version_number`, `raw_text`, `text_hash`. Created only by the user. |
| **ContentItem** | Immutable, stable identity of one unit of thought: `id`, `job_id`, `content_type`, `created_at`. Its type never changes. |
| **ContentRevision** | Immutable version of a ContentItem. Fields: `revision_number`, `source_revision_id`, `produced_by_run_id`, `payload`, `schema_version`, `authorship` (`ai`, `user`), `assertion_type` (`extracted_fact`, `hypothesis`, `suggestion`, `human_text`), `change_type` (`initial`, `user_edit`, `ai_rewrite`, `relink`), `job_sequence`, `policy_version`. |
| **EvidenceLink** | Immutable link from a ContentRevision to an exact span of an exact SourceVersion: `quoted_text`, `start_offset`, `end_offset`, in Unicode code points. |
| **GenerationRequest** | Immutable intent of an AI request: `request_kind`, `instruction_version_id`, `user_instruction`, `requested_settings`, its RunInput records, `policy_version`. |
| **RunInput** | Immutable, exact input of a request: kind (`source_version`, `content_revision`, `presentation_block`), reference, role, position. |
| **GenerationRun** | One execution attempt of a request: `attempt_number`, `status`, `provider`, `resolved_model`, `resolved_settings`, `provider_request_id`, timestamps, `error_code`, raw response reference. Only lifecycle fields change, and only forward. |
| **DecisionEvent** | Immutable human decision. Fields: `action`, target (a ContentItem, optionally one of its revisions, or a Presentation), `selection_role`, `actor_user_id`, `command_id`, `job_sequence`, `policy_version`, `reason`. |
| **ContentRelation** | Immutable edge from an exact `from` revision to an exact `to` revision: `relation_type`, `to_item_id` (denormalized), `position`. Written only together with its `from` revision. |
| **Presentation** | Stable identity of one presentation. A job may have several. |
| **PresentationVersion** | Immutable version of a Presentation: `version_number`, `base_version_id`, `job_sequence`, `policy_version`. |
| **PresentationBlock** | Immutable block inside one PresentationVersion: `position`, `text`, `authorship`, `produced_by_run_id`, `derived_from_block_id`. |
| **PresentationBlockReference** | Immutable citation from a block to an exact ContentRevision: `role` (`presents`, `supports`, `evaluation`), `position`. |
| **Projection** | Derived, rebuildable state: current selections, flags, warnings, drift. It is never the source of truth. |
| **job_sequence** | Per-job, strictly increasing, gap-free integer assigned to each append-only record a command creates. |
| **job_version** | The highest `job_sequence` committed in the job. |
| **Idempotency record** | Technical record, outside the domain, keyed by **(`job_id`, `command_id`)**. It holds at least: `job_id`, `command_id`, the actor (user) ID, the command type, a canonical payload fingerprint with the version of the canonicalization rules used, the deterministic completed result returned to the caller (accepted, with the created record IDs; or rejected, with the error code and response), and creation and completion timestamps. It is **technical state, not domain state**: it has no `job_sequence`, never changes `job_version`, is never a domain history event, and never takes part in domain replay or reconstruction. It follows the retention, deletion, anonymization and purge policy of its job. [R10, R14] |
| **Deterministic outcome** | A completed result of a command that is committed together with its idempotency record: an acceptance, a domain-rule rejection (REJECT), or an idempotency conflict. Only deterministic outcomes are replayed from the idempotency record. [R15] |
| **Technical failure** | A failure that leaves no completed result committed: process crash, transaction rollback, unavailable storage, network interruption before commit, or an equivalent infrastructure failure. It is not a rejection, leaves no domain change and no idempotency record, and the same (`job_id`, `command_id`) may be attempted again. [R15] |
| **policy_version** | Version of the policy configuration active when a record or event was accepted. |

### 1.3 Standard outcomes

These names are used in the criteria below so each one does not have to repeat them.

| Outcome | Observable meaning |
|---|---|
| **REJECT(code)** | The command fails with error `code`. Zero domain records are committed or modified (ContentItem, ContentRevision, ContentRelation, EvidenceLink, DecisionEvent, GenerationRequest, GenerationRun, PresentationVersion and their children); `job_version` and the projection are unchanged. The only write is the **idempotency record** of its (`job_id`, `command_id`) with the rejection result, committed atomically (AC-GLOBAL-029, 036). A technical failure is never a REJECT. [R10, R15] |
| **DROP** | (AI output only) The output element is not persisted as content. The raw response stays on the run, and the run's validation report lists the element with a reason. |
| **DOWNGRADE** | (AI output only) The element is persisted with the weaker assertion for its type (§4.3), plus the warning `claimed_fact_unverified`. |
| **WARN(kind)** | The command succeeds and the projection shows a warning of `kind`. No event is written. |
| **TECHNICAL FAILURE** | Nothing is committed: no domain record, no completed result, no idempotency record. `job_version` and the projection are unchanged, and the same (`job_id`, `command_id`) remains retryable. [R15] |

### 1.4 Tags

**Enforcement:**
1. **[DB]**: the storage layer can enforce this with keys, checks, uniqueness or privileges.
2. **[APP]**: enforced by transactional command validation.
3. **[PROJ]**: a projection-only rule; it never blocks a write.
4. **[POL]**: product policy outside the data model, typically the UI.

A [DB] rule is still tested at the command level. [DB] means it must *also* hold when the application is bypassed.

**Test level:**
1. **U**: unit.
2. **P**: property (generated inputs).
3. **I**: integration (domain plus storage).
4. **E**: end to end.

### 1.5 The 16 MVP content types

business_problem, communication_problem, audience, human_truth, human_tension, central_message, restriction, open_question, human_note, brand_element, category_element, creative_mechanism, combination, creative_path, memory_test, pr_headline.

---

## 2. Global invariants

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-GLOBAL-001 | Records of these types can never be updated: SourceVersion, ContentItem, ContentRevision, ContentRelation, EvidenceLink, GenerationRequest, RunInput, DecisionEvent, PresentationVersion, PresentationBlock, PresentationBlockReference. | A committed record of each type | Any update attempt through the domain or with the domain storage role fails; the record's content hash is unchanged. | Storage error; nothing changes | DB | I |
| AC-GLOBAL-002 | The records in 001 can never be deleted by any domain command or by the domain storage role. | Same | The delete attempt fails; the record is still readable. | Storage error | DB | I |
| AC-GLOBAL-003 | On GenerationRun, only the lifecycle fields change (`status`, `provider`, `resolved_model`, `resolved_settings`, `provider_request_id`, timestamps, `error_code`, error text, raw response reference). `request_id` and `attempt_number` never change. | A run in any status | Updating a non-lifecycle field fails. | Storage error | DB | I |
| AC-GLOBAL-004 | Every domain record belongs to exactly one job, and every job to exactly one user. | none | Every record has a non-null `job_id` whose job has a non-null owner. | Insert without job fails | DB | I |
| AC-GLOBAL-005 | Only the job owner can submit commands on a job. | Job owned by user A | A command from user B is refused. | REJECT(E_FORBIDDEN) | APP | I |
| AC-GLOBAL-006 | No record may reference a record of another job. This covers relation endpoints, RunInput targets, EvidenceLink source version, block references, decision targets, `source_revision_id`, `derived_from_block_id` and `base_version_id`. | Jobs J1 and J2 | Any cross-job reference is refused. | REJECT(E_CROSS_JOB) | DB | I |
| AC-GLOBAL-007 | References whose meaning depends on wording store an exact revision ID: `ContentRelation.to_revision_id`, content RunInputs, `PresentationBlockReference.content_revision_id`, and the target of revision-scoped decisions. | none | A reference given only as an item ID is refused. | REJECT(E_REVISION_REQUIRED) | DB | U |
| AC-GLOBAL-008 | Every denormalized item ID equals the item of the referenced revision (`ContentRelation.to_item_id`, `DecisionEvent` item and revision pair). | none | A mismatched pair is refused. | REJECT(E_REFERENCE_MISMATCH) | DB | I |
| AC-GLOBAL-009 | Creating a newer revision never changes any existing reference to an older one. | Relations, RunInputs, block references and decisions pin r1; r2 is then created | Every reference still points to r1. | n/a | APP | P |
| AC-GLOBAL-010 | Re-submitting a command **in the same job** with the same `command_id` and the same canonical payload returns the stored deterministic result and writes nothing, whether C was accepted or rejected (for rejected commands, see AC-GLOBAL-030). [R10, R14] | Command C has a committed idempotency record | The second response equals the first (accepted: same record IDs and `job_sequence` range; rejected: same error code and response); `job_version` is unchanged. | n/a | APP | I |
| AC-GLOBAL-011 | Re-using a `command_id` **in the same job** with a different canonical payload is refused as an idempotency conflict, whether the original command was accepted or rejected. The conflict response does not change the stored idempotency record. [R10, R14] | Command C has a committed idempotency record | The new payload is refused. | REJECT(E_COMMAND_ID_CONFLICT) | APP | I |
| AC-GLOBAL-012 | `job_sequence` is unique, strictly increasing and gap-free per job. It is assigned to every SourceVersion, ContentRevision, DecisionEvent, GenerationRequest, GenerationRun and PresentationVersion. **[Default OI-20]** for runs and presentation versions. | Any command history | The sequences committed in a job form exactly 1..job_version. | n/a | DB | P |
| AC-GLOBAL-013 | Records created by one command get consecutive `job_sequence` values in write order. A failed command consumes none. | A command writing k records | They hold n+1..n+k; after a failed command, the next accepted record holds n+1. | n/a | DB | I |
| AC-GLOBAL-014 | Replay order is `job_sequence` only; timestamps are never used for ordering. | Events with identical or reversed `created_at` values | The projection built from the log is identical whatever the timestamps. | n/a | PROJ | P |
| AC-GLOBAL-015 | A user command that carries `expected_job_version` is accepted only if it equals the current `job_version`. **[Default OI-6]** | Current job_version = 40 | A command expecting 40 is accepted; one expecting 39 is refused and the response includes 40. | REJECT(E_STALE_JOB_VERSION) | APP | I |
| AC-GLOBAL-016 | System commits of run outputs are serialized under the same job lock, but are never refused for staleness. | A user command committed during the run | Run outputs commit; `job_version` advances. | n/a | APP | I |
| AC-GLOBAL-017 | Requested and resolved AI settings are stored separately. `requested_settings` (on the request) is never modified by execution; `resolved_settings`, `provider` and `resolved_model` (on the run) are always recorded, even when they equal the requested values. [D18] | A completed run | Both sets can be read, and the request's settings hash is unchanged from creation. | n/a | DB | I |
| AC-GLOBAL-018 | Only user commands write DecisionEvents. `actor_user_id` equals the job owner, and no DecisionEvent references a GenerationRun. [D24] | Any run output | Zero DecisionEvents are created by run commits. | A run commit containing a decision: DROP of that element | DB+APP | I |
| AC-GLOBAL-019 | `authorship = ai` if and only if `produced_by_run_id` is set, on ContentRevision and on PresentationBlock. | none | A mismatched record is refused. | REJECT(E_PROVENANCE) | DB | U |
| AC-GLOBAL-020 | Only user commands create SourceVersions. No request kind outputs a SourceVersion. | none | A run commit never contains a SourceVersion. | DROP | APP | I |
| AC-GLOBAL-021 | Every SourceVersion stays retrievable with its `raw_text` byte-identical and `text_hash` matching. `version_number` is contiguous from 1 per Source. | Versions v1..vn | Reading v1 after vn is created returns identical bytes. | n/a | DB | P |
| AC-GLOBAL-022 | Creating a SourceVersion does not modify earlier SourceVersions, EvidenceLinks, revisions or DecisionEvents. [D9, D19] | Evidence cites v1 | After v2, the hashes of all pre-existing records are unchanged. | n/a | DB | I |
| AC-GLOBAL-023 | Erasure and anonymization are available only to a separate administrative process, never as a domain command. | none | A domain command requesting erasure is refused. | REJECT(E_FORBIDDEN) | APP | I |
| AC-GLOBAL-024 | Each erasure or anonymization writes an ErasureRecord outside the job scope: job ID, scope, operator, timestamp, reason. | Admin erasure of job J | The ErasureRecord exists and stays readable after J's data is gone. | n/a | APP | I |
| AC-GLOBAL-025 | After a full job erasure, no payload, source text, rendered input, raw AI response or idempotency record of that job can be retrieved through any interface or blob store. [R14] | Admin erasure of job J | Every retrieval returns not-found. | n/a | APP | E |
| AC-GLOBAL-026 | After anonymization (text scrubbed, structure kept), rebuilding the projection gives identical selection, rejection, favorite and discard state. The job's idempotency records are anonymized under the same policy (no content text remains in stored results). [R14] | Anonymized job | The rebuilt projection's text-independent fields equal those before anonymization. | n/a | PROJ | I |
| AC-GLOBAL-027 | Deleting the whole projection and rebuilding it from the log reproduces it exactly. | Any history | The rebuilt projection equals the stored one field by field. | See AC-ERR-013 | PROJ | P |
| AC-GLOBAL-028 | Every ContentRevision, DecisionEvent, GenerationRequest and PresentationVersion records the `policy_version` active when it was accepted. | none | The field is non-null and equals the active version at commit. | Insert without it fails | DB | U |
| AC-GLOBAL-029 | **Rejected commands are recorded for idempotency only.** Every command rejected by a domain rule stores an idempotency record (all fields of §1.2) with the rejection result. No domain record is created or modified. [R10, R14] | Any rejected command | The idempotency record exists; domain record counts and hashes, `job_version` and projection are unchanged. | n/a | APP | P |
| AC-GLOBAL-030 | **Replaying a rejected command does not re-execute it.** Re-submitting a rejected `command_id` with the identical payload returns the stored rejection, even if the command would now succeed (e.g. the missing evidence or `chosen` role now exists). [R10] | Command C rejected with E_COMBINATION_NOT_CHOSEN; K r1 is chosen afterwards | Same rejection returned; no validation runs; nothing written. | n/a | APP | I |
| AC-GLOBAL-031 | **Domain state and the idempotency record are separate.** Idempotency records have no `job_sequence`, never change `job_version`, never appear as domain history events, and are ignored by projection rebuild and domain replay; deleting them changes no domain record or projection. They are never counted as domain records in any criterion of this document. [R10, R14] | Any history | Rebuild and history outputs are identical with and without idempotency records. | n/a | PROJ | P |
| AC-GLOBAL-032 | **Scope is (`job_id`, `command_id`).** The same `command_id` used in two different jobs identifies two independent commands; each is validated and executed on its own, and neither returns the other's result nor conflicts with it. [R14] | Job J1 has a record for c-1 | c-1 in job J2 executes normally. | n/a | APP+DB | I |
| AC-GLOBAL-033 | **Record contents.** Every committed idempotency record contains non-null `job_id`, `command_id`, actor ID, command type, canonical payload fingerprint, canonicalization version, completed result and creation and completion timestamps. (`job_id`, `command_id`) is unique. [R14] | Any processed command | All fields present. | Duplicate key: the second insert fails | DB | U |
| AC-GLOBAL-034 | **Canonical comparison.** Two submissions carry the same canonical payload exactly when their fingerprints, computed with the canonicalization version stored in the original record, are equal. Payloads that differ only in serialization (field order, insignificant whitespace between fields, equivalent number encodings) have the same fingerprint; payloads that differ in any field value have different fingerprints. A replay is always fingerprinted with the original record's canonicalization version, so a later change of rules never turns a replay into a conflict. [R14] Text normalization inside values and whether the command type is part of the comparison: **[Default OI-28]**. | Generated payload pairs | Equal fingerprints exactly for serialization-only differences. | n/a | APP | P |
| AC-GLOBAL-035 | **Retention follows the job.** Idempotency records are kept, deleted, anonymized and purged together with their job under the job's policy, including administrative erasure (AC-GLOBAL-023 to 026). [R14] | Job purged | No idempotency record of the job remains. | n/a | APP | I |
| AC-GLOBAL-036 | **Atomic persistence.** For every deterministic outcome, the completed result and its idempotency record are committed atomically; for an accepted command, the domain changes are part of the same atomic transaction. No committed state ever holds domain changes without the record, or the record without its domain changes. [R15] | Fault injected at each write of the commit | Either everything is committed or nothing is. | TECHNICAL FAILURE | DB+APP | P |
| AC-GLOBAL-037 | **Only deterministic outcomes are stored.** Idempotency records exist only for acceptances, domain-rule rejections and idempotency conflicts where applicable. (A conflict never overwrites the record that holds its key.) A technical failure never creates a record and never reserves its identifier. [R15] | Crash, rollback, storage outage or network loss before commit | No record exists for the (`job_id`, `command_id`). | n/a | APP | I |

---

## 3. Content type policy matrix

### 3.1 Nature, authorship, assertion, evidence, payload

Evidence policy by assertion (applies to every type unless the row says otherwise):
1. `extracted_fact`: **required**, at least one validated EvidenceLink in the same transaction.
2. `hypothesis`: **optional**.
3. `suggestion`: **forbidden**, except for open_question, where it is optional.
4. `human_text`: **forbidden**.

| content_type | Nature | Authorship | Assertion: ai | Assertion: user | Evidence | Required payload |
|---|---|---|---|---|---|---|
| business_problem | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `statement` (non-empty) |
| communication_problem | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `statement` |
| audience | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `label`, `description` |
| human_truth | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `statement` |
| human_tension | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `statement`, `desire`, `reality` (all non-empty) |
| restriction | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `statement`, `kind` ∈ {mandatory, prohibited} |
| brand_element | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `name`, `description` |
| category_element | descriptive | ai, user | extracted_fact, hypothesis | human_text, hypothesis, extracted_fact | by assertion | `name`, `description` |
| central_message | prescriptive | ai, user | extracted_fact, suggestion | human_text, extracted_fact | fact: required; suggestion: forbidden | `statement` |
| open_question | prescriptive | ai, user | suggestion | human_text | suggestion: optional; human_text: forbidden | `question` |
| creative_mechanism | creative | ai, user | suggestion | human_text | forbidden | `name`, `description` |
| combination | creative | ai, user | suggestion | human_text | forbidden | none (optional `label`, `rationale`) plus a valid `combines` set |
| creative_path | creative | ai, user | suggestion | human_text | forbidden | `title`, `idea` |
| memory_test | creative | ai, user | suggestion | human_text | forbidden | `retelling`, `verdict` ∈ {pass, weak, fail} |
| pr_headline | creative | ai, user | suggestion | human_text | forbidden | `headline` (optional `verdict`, `rationale`) |
| human_note | human only | user | none | human_text | forbidden | `text` |

A user `extracted_fact` requires a validated EvidenceLink created by the same command (the "highlight in the brief" action). A user `hypothesis` (descriptive types only, R5) needs no evidence; links are optional and must validate exactly.

### 3.2 Identity and revision rules [D12, D13, D17]

| content_type | Identity (what the item *is*) | New revision when | New item required when | Machine-checked part |
|---|---|---|---|---|
| business_problem, communication_problem, audience, human_truth, central_message, restriction, open_question, brand_element, category_element, creative_mechanism | The proposition or thing | The user chooses **Edit** (`user_edit`) or requests `rewrite` (`ai_rewrite`) | The user chooses **New / Alternative**, or requests `alternatives` | Only the command path: Edit always gives the same item, New always a new one (AC-CONTENT-026) |
| human_tension | The pair (desire, reality) | Edit, rewrite, or `relink` of `grounded_in` | Different desire or reality: user chooses New | Command path; `relink` requires an identical payload |
| human_note | "My answer to question Q" (the item of its `answers` target) | Edit of the text (including a changed answer), or `relink` to a newer revision of Q | It answers a different question | `answers` target item constant across revisions |
| combination | Its **set of member items** | Label or rationale edit (`user_edit`); re-pin a member to a newer revision of the same item, or reorder (`relink`) | Any member item added, removed or replaced | Member item set constant across revisions |
| creative_path | The idea, and the exact combination revision it was built on (if any) | Edit or rewrite of the text, keeping the exact `based_on` target (which need not still be chosen) | Different idea, or a different exact `based_on` target, including another revision of the same combination item; the new path's first `based_on` target must be chosen [R12] | `based_on` target revision constant across revisions |
| memory_test, pr_headline | "This test of **this exact** path revision" | Edit or rewrite of the test text or verdict | A different path revision is to be tested | `evaluates` target revision constant across revisions |

### 3.3 Relations and decisions per type

| content_type | Outgoing relations (from) | Incoming relations (to) | Block reference roles | Selection roles | Reject | Favorite | Discard |
|---|---|---|---|---|---|---|---|
| business_problem | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| communication_problem | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| audience | none | none | supports | primary, max 1 per job; secondary, N (the final state of every command must have an active, non-discarded primary audience whenever a secondary exists; R3) | yes | yes | yes |
| human_truth | none | grounded_in, combines | supports | chosen, N | yes | yes | yes |
| human_tension | grounded_in (0..5) | combines | supports | primary, max 1 per job; secondary, N (same final-state rule, per type; R3) | yes | yes | yes |
| central_message | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| restriction | none | none | supports | chosen, N | yes | **no** | yes |
| open_question | none | answers | supports | chosen, N | yes | **no** | yes |
| human_note | answers (exactly 1) | none | supports | **none** | **no** | **no** | yes |
| brand_element | none | combines | supports | **none** | yes | yes | yes |
| category_element | none | combines | supports | **none** | yes | yes | yes |
| creative_mechanism | none | combines | supports | **none** | yes | yes | yes |
| combination | combines (2..5, composition rule) | based_on | none | chosen, N, no cap; assigned and removed by the user only; a revision must currently be chosen to be a path_generation input (R1) | yes | yes | yes |
| creative_path | based_on (0..1) | evaluates | presents | finalist, N, no cap [D7] | yes | yes | yes |
| memory_test | evaluates (exactly 1) | none | evaluation | chosen, max 1 per evaluated path revision | yes | **no** | yes |
| pr_headline | evaluates (exactly 1) | none | evaluation | chosen, max 1 per evaluated path revision | yes | yes | yes |

Block reference roles are **[Default OI-13]**.

**Presentations** (not content types): the only allowed actions are `archived`, `discarded` and `restored` [D10]. Favorite and every selection or rejection action are forbidden.

---

## 4. Type, authorship, and assertion criteria

### 4.1 Oracle

The full space is 16 types × 2 authorships × 4 assertions = **128 triples**. Exactly **57** are allowed [R5]:
1. descriptive: 8 types × 5 pairs = 40 (ai: extracted_fact, hypothesis; user: human_text, hypothesis, extracted_fact);
2. central_message: 4;
3. open_question: 2;
4. creative: 5 types × 2 pairs = 10;
5. human_note: 1.

The other **71** are forbidden. Tests should enumerate all 128.

The 71 forbidden triples break down as follows (a cross-check for the test generator):
1. `user` + `hypothesis` on the 8 non-descriptive types: 8;
2. `user` + `suggestion` on every type: 16;
3. `user` + `extracted_fact` on open_question, the five creative types and human_note: 7;
4. `ai` + `human_text` on every type: 16;
5. other AI assertions not allowed for their type: 24 (descriptive `suggestion` 8; central_message `hypothesis` 1; open_question `extracted_fact` and `hypothesis` 2; creative `extracted_fact` and `hypothesis` 10; human_note `extracted_fact`, `hypothesis` and `suggestion` 3).

### 4.2 Criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-CONTENT-001 | Exactly the 57 allowed triples of §3.1 are accepted; all 71 others fail. [R5] | Enumerate all 128 triples, with valid payload and evidence where required | 57 accepted; 71 fail with the outcome given by 002 to 016 and 034. | as below | APP (+DB for 012) | P |
| AC-CONTENT-002 | A descriptive `ai` + `extracted_fact` is accepted only with ≥1 validated EvidenceLink committed in the same transaction. [D25] | AI output with a valid quote | Revision stored as `extracted_fact` with ≥1 link. | Invalid or missing quote: DOWNGRADE to `hypothesis` | APP+DB | I |
| AC-CONTENT-003 | A descriptive `ai` + `hypothesis` is accepted with 0..N validated links. | AI output | Stored as `hypothesis`. | An invalid link is dropped; the item is kept (AC-EVID-008) | APP | U |
| AC-CONTENT-004 | A descriptive `ai` + `suggestion` is not allowed. | AI output | none | DROP | APP | U |
| AC-CONTENT-005 | `ai` + `human_text` is never allowed, for any type. | AI output | none | DROP (DB check rejects any bypass) | DB+APP | U |
| AC-CONTENT-006 | A descriptive `user` + `human_text` is accepted without evidence. | User command | Stored. | Command includes evidence: REJECT(E_EVIDENCE_FORBIDDEN) | APP | U |
| AC-CONTENT-007 | A `user` + `extracted_fact` (descriptive types and central_message) is accepted only with a validated EvidenceLink in the same command. Otherwise the whole command is rejected: it is never downgraded or reclassified (AC-CONTENT-031 to 033). [R4] | User highlights brief text | Stored as `extracted_fact` with its link. | Missing link: REJECT(E_EVIDENCE_REQUIRED); invalid link: REJECT(E_EVIDENCE_INVALID); no revision, link, event or projection change | APP | I |
| AC-CONTENT-008 | `user` + `suggestion` is never allowed. `user` + `hypothesis` is allowed only on the eight descriptive types (AC-CONTENT-034); on central_message, open_question, the five creative types and human_note it is refused. [R5] | User command | none | REJECT(E_ASSERTION_NOT_ALLOWED) | DB+APP | U |
| AC-CONTENT-009 | central_message: `ai` + `extracted_fact` requires evidence; `ai` + `suggestion` forbids it; `ai` + `hypothesis` is not allowed. | AI output | Fact and suggestion accepted as specified. | Hypothesis: DROP; fact without valid evidence: DOWNGRADE to `suggestion`; suggestion with evidence: link dropped, item kept | APP | U |
| AC-CONTENT-010 | open_question: `ai` + `suggestion` is accepted with 0..N validated links; `ai` + `extracted_fact` and `ai` + `hypothesis` are not allowed. | AI output | Suggestion accepted. | Fact: DOWNGRADE to `suggestion`; hypothesis: DROP | APP | U |
| AC-CONTENT-011 | open_question: `user` + `human_text` is accepted without evidence; `user` + `extracted_fact` is not allowed. | User command | Stored. | Fact: REJECT(E_ASSERTION_NOT_ALLOWED); evidence: REJECT(E_EVIDENCE_FORBIDDEN) | APP | U |
| AC-CONTENT-012 | Creative types: `ai` allows only `suggestion`; `user` allows only `human_text`; evidence is forbidden. | Any creative type | Accepted as specified. | AI fact: DOWNGRADE to `suggestion`; AI hypothesis: DROP; AI evidence: link dropped, item kept; user evidence or other assertion: REJECT | DB+APP | U |
| AC-CONTENT-013 | human_note: only `user` + `human_text`, with no evidence. No request kind may output a human_note. | none | User note accepted. | AI note: DROP; user evidence: REJECT(E_EVIDENCE_FORBIDDEN) | APP | U |
| AC-CONTENT-014 | `authorship` outside {ai, user}, including `brief` and `system`, is refused. [D12] | none | none | REJECT(E_INVALID_ENUM) | DB | U |
| AC-CONTENT-015 | `assertion_type` outside the four values is refused. | none | none | REJECT(E_INVALID_ENUM) | DB | U |
| AC-CONTENT-016 | `content_type` outside the 16 MVP types is refused, including `presentation_content` and `finalist`. [D13] | none | none | REJECT(E_INVALID_ENUM) | DB | U |
| AC-CONTENT-017 | `change_type` outside {initial, user_edit, ai_rewrite, relink} is refused, including `import`. [D15] | none | none | REJECT(E_INVALID_ENUM) | DB | U |
| AC-CONTENT-018 | `change_type = initial` if and only if `revision_number = 1` if and only if `source_revision_id` is null. | none | A consistent revision is accepted. | REJECT(E_CHANGE_TYPE) | DB | U |
| AC-CONTENT-019 | `revision_number` is unique and contiguous from 1 per item. `source_revision_id` belongs to the same item and has a lower number. | Item with r1..r3 | The next revision is r4; its source is one of r1..r3. | REJECT(E_REVISION_LINEAGE) | DB | P |
| AC-CONTENT-020 | `user_edit` requires `user` and a payload that differs from the source revision in canonical form. | Source r2 | A changed payload is accepted. | Identical payload with identical relations: REJECT(E_NO_CHANGE) | APP | U |
| AC-CONTENT-021 | `ai_rewrite` requires `ai`, a run whose request has exactly one `anchor` input, and `source_revision_id` equal to that anchor. | rewrite request | The revision's source is the anchor. | Output not matching the anchor: DROP | APP | I |
| AC-CONTENT-022 | `relink` requires `user`, a payload canonically equal to the source revision, a different outgoing relation set, and a type in {human_note, human_tension, combination}. | Source r1 | Accepted; payload hash equals r1's. | Other types: REJECT(E_RELINK_NOT_ALLOWED); changed payload: REJECT(E_RELINK_PAYLOAD_CHANGED); same relations: REJECT(E_NO_CHANGE) | APP | U |
| AC-CONTENT-023 | The payload must validate against the schema of its `content_type` at its `schema_version`; the required fields of §3.1 are non-empty after trimming. [D14] | none | Accepted. | User: REJECT(E_SCHEMA); AI: DROP (except 024) | APP | U |
| AC-CONTENT-024 | An AI human_tension missing `desire` or `reality` is dropped. It is never retyped as human_truth. **[Default OI-15]** | AI output | none | DROP | APP | U |
| AC-CONTENT-025 | Revisions stay readable at their original `schema_version` after a newer schema is introduced, and are never migrated in place. | r1 at schema 1; schema 2 becomes current | Reading r1 returns its schema 1 payload; its hash is unchanged. | n/a | APP | I |
| AC-CONTENT-026 | Identity is decided by the command, never inferred: *Edit* always creates a revision of the same item, *New / Alternative* always a new item. | none | The item ID is observed per command. | n/a | APP | I |
| AC-CONTENT-027 | Structural identity keys are constant across all revisions of an item: combination member item set, human_note `answers` target item, creative_path `based_on` target revision, memory_test and pr_headline `evaluates` target revision. [D17] | Any revision sequence | For every item, the key computed on each revision is equal. | A command that would change the key: REJECT(E_IDENTITY_CHANGE) | APP | P |
| AC-CONTENT-028 | A `user_edit` of an `extracted_fact` must declare its `assertion_type`. Declaring `human_text`, or `hypothesis` on a descriptive type [R5], is accepted without evidence. Declaring `extracted_fact` is accepted only with evidence validated in the same command. The system never derives the new assertion from the source revision. An `ai_rewrite` of a fact is a fact only with newly validated evidence. EvidenceLinks are never copied automatically. [R4] | A fact revision r1 | The new revision's assertion is exactly the declared one; r1's links are unchanged. | User declares fact without valid evidence: REJECT(E_EVIDENCE_REQUIRED / E_EVIDENCE_INVALID); no declared assertion: REJECT(E_SCHEMA); AI without evidence: DOWNGRADE | APP | I |
| AC-CONTENT-029 | `user_edit`, `relink` and `ai_rewrite` on a discarded item are refused. **[Default OI-4]** | Item discarded | none | REJECT(E_ITEM_DISCARDED) | APP | I |
| AC-CONTENT-030 | Every AI-produced revision has `authorship = ai`, `produced_by_run_id` set, and `change_type` of `initial` (new item) or `ai_rewrite`. | Run commit | Fields as stated. | n/a | DB+APP | I |
| AC-CONTENT-031 | **No silent reclassification of human content.** Every user command that creates a revision declares `assertion_type`, and the stored value always equals the declared one. The system never replaces a user's declared `extracted_fact` with `hypothesis`, `human_text` or any other value. [R4] | Generated user commands | For every accepted command, stored assertion = declared assertion. | Any other outcome is a defect | APP | P |
| AC-CONTENT-032 | **No partial writes after a rejected fact.** A rejected user fact command creates no ContentItem, ContentRevision, EvidenceLink, ContentRelation or DecisionEvent, and leaves `job_version` and the projection unchanged. This holds even when the command also carried selection-move events or relations. Only the idempotency record is written (AC-GLOBAL-029). [R4, R10] | Edit of a selected fact declaring `extracted_fact` with an invalid quote | Record counts, `job_version` and projection are identical before and after. | n/a | APP | P |
| AC-CONTENT-033 | The rejection response for E_EVIDENCE_REQUIRED or E_EVIDENCE_INVALID lists the alternative assertion types the user may resubmit with. Accepting one requires a **new** command, with a **new `command_id`**, declaring the chosen assertion explicitly. Re-using the rejected command's `command_id` for it is an idempotency conflict (AC-GLOBAL-011). The system never resubmits on the user's behalf. [R4, R5, R10] The list is exactly the user assertions allowed for the item's type other than `extracted_fact`: `human_text` and `hypothesis` for the eight descriptive types; `human_text` only for central_message. | Rejected fact command | The response contains the list; zero domain records are written until a new command arrives. | Alternative sent with the rejected `command_id`: REJECT(E_COMMAND_ID_CONFLICT) | APP | I |
| AC-CONTENT-034 | A `user` + `hypothesis` revision is accepted on the eight descriptive types with 0..N EvidenceLinks; each link must satisfy AC-EVID-001. [R5] | User command on audience | Stored as `user` + `hypothesis`. | Invalid link: REJECT(E_EVIDENCE_INVALID), nothing stored | APP | U |
| AC-CONTENT-035 | **No silent reclassification after a rejected fact.** After a user fact command is rejected, no revision with `hypothesis`, `human_text` or any other assertion exists for that content unless a separate, later user command declared it. The rejection itself never creates one, and the server never submits the alternative. [R4, R5] | Rejected fact command followed by no further command | Zero revisions for the content. | Any stored revision is a defect | APP | P |

### 4.3 Weaker assertion map (for DOWNGRADE)

| Nature | AI `extracted_fact` that fails validation, or is not allowed for the type, becomes |
|---|---|
| descriptive | `hypothesis` |
| prescriptive | `suggestion` |
| creative | `suggestion` |
| human only | no downgrade: DROP |

---

## 5. Relation criteria

### 5.1 Allowed triples (oracle)

The space is 16 × 16 × 5 = 1,280 (from_type, to_type, relation_type) triples. Exactly **10** are allowed:

| relation_type | from_type | to_type | Out cardinality (per from revision) |
|---|---|---|---|
| answers | human_note | open_question | exactly 1 |
| grounded_in | human_tension | human_truth | 0..5 |
| combines | combination | human_truth, human_tension, brand_element, category_element, creative_mechanism (5 triples) | 2..5 plus the composition rule (§6) |
| based_on | creative_path | combination | 0..1 |
| evaluates | memory_test, pr_headline (2 triples) | creative_path | exactly 1 |

Incoming cardinality is 0..N for every relation. The source is always the dependent revision; the target is the one it depends on.

### 5.2 General relation criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-REL-001 | `relation_type` is one of the five values. | none | none | REJECT(E_INVALID_ENUM) | DB | U |
| AC-REL-002 | Only the 10 triples of §5.1 are accepted. | Enumerate 1,280 triples | 10 accepted; 1,270 fail. | REJECT(E_RELATION_PAIR) for users; DROP of the relation for AI | APP | P |
| AC-REL-003 | Relations are created only in the same command that creates their `from` revision. | Existing revision r1 | none | Adding an edge to r1 afterwards: REJECT(E_RELATION_IMMUTABLE) | APP+DB | I |
| AC-REL-004 | Both endpoints are in the same job. | none | none | REJECT(E_CROSS_JOB) | DB | I |
| AC-REL-005 | `to_revision_id` references an existing revision, and `to_item_id` equals its item. | none | none | Missing: REJECT(E_REFERENCE_NOT_FOUND); mismatch: REJECT(E_REFERENCE_MISMATCH) | DB | I |
| AC-REL-006 | (from_revision, to_revision, relation_type) is unique. | none | none | REJECT(E_DUPLICATE_RELATION) | DB | U |
| AC-REL-007 | Cycles and self-edges cannot occur. | Randomly generated accepted histories | The relation graph of every job is acyclic. | n/a | APP (structural) | P |
| AC-REL-008 | When the `from` item gets a new revision, every outgoing edge is carried forward to the same target revisions, except edges the command explicitly re-pins where re-pinning is allowed. | Item with edges on rN | rN+1 has the same edge set, or the declared re-pins. | n/a | APP | P |
| AC-REL-009 | When the `to` item gets a new revision, existing edges do not change. The projection shows `target_superseded` on the source item. | Edge to r1; r2 created | The edge still targets r1. | WARN(target_superseded) | APP+PROJ | I |
| AC-REL-010 | A **new** edge (not carried forward) may not target a rejected revision or a revision of a discarded item. Carried-forward edges are exempt and produce a warning. | Target rejected or discarded | Carried edge kept. | New edge: REJECT(E_TARGET_INACTIVE); carried: WARN(target_inactive) | APP | I |
| AC-REL-011 | A re-pin moves the edge to a revision of the **same** target item with a **higher** `revision_number`. | Edge to r2 | Re-pin to r3 accepted. | To r1: REJECT(E_REPIN_BACKWARD); to another item: per relation below | APP | U |
| AC-REL-012 | A relation has no authorship of its own; it is attributed to the authorship of its `from` revision. | none | An edge on an AI revision reads as AI. | n/a | APP | U |
| AC-REL-013 | An AI-proposed edge may target only a RunInput revision of the same request or a revision produced by the same run. | Run output | Accepted. | DROP of the edge; if the edge is mandatory for the item, DROP of the item | APP | I |

### 5.3 Per-relation criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-REL-020 | **answers**: every human_note revision has exactly one `answers` edge, to an open_question revision. [D9] | none | A note with one edge is accepted. | 0 or 2 edges: REJECT(E_CARDINALITY) | APP | U |
| AC-REL-021 | **answers**: an open_question may be answered by any number of notes. | Question Q | Three notes answering Q are accepted. | n/a | APP | U |
| AC-REL-022 | **answers**: a `relink` may re-pin the edge to a newer revision of the same question. Pointing it to a different question requires a new note item. | Note on Q r1; Q r2 exists | Relink to Q r2 is accepted, with the note payload unchanged. | Target another question: REJECT(E_IDENTITY_CHANGE) | APP | U |
| AC-REL-023 | **answers**: a new note may not answer a rejected question revision or a discarded question. | none | none | REJECT(E_TARGET_INACTIVE) | APP | U |
| AC-REL-030 | **grounded_in**: a human_tension revision has 0..5 edges to human_truth revisions. | none | 0 to 5 accepted. | 6: REJECT(E_CARDINALITY) | APP | U |
| AC-REL-031 | **grounded_in**: two revisions of the same truth item may not appear in one tension revision. **[Default OI-5]** | none | none | REJECT(E_DUPLICATE_TARGET_ITEM) | APP | U |
| AC-REL-032 | **grounded_in**: a `relink` may add, remove or re-pin edges without changing the tension's identity. | Tension r1 with 1 edge | r2 (relink) with 2 edges is accepted, same item. | n/a | APP | U |
| AC-REL-033 | **grounded_in**: direction is tension → truth only. | none | none | truth → tension: REJECT(E_RELATION_PAIR) | APP | U |
| AC-REL-040 | **based_on**: a creative_path revision has 0 or 1 edge, to a combination revision. | none | 0 or 1 accepted. | 2: REJECT(E_CARDINALITY) | APP | U |
| AC-REL-041 | **based_on**: for an AI path from a `path_generation` request with a combination input, the command writes `based_on` to exactly that input revision. Any combination reference in the AI output is ignored. | Request with combination C r2 | Every path from the run has `based_on` = C r2. | n/a | APP | I |
| AC-REL-042 | **based_on**: an AI path from a request with no combination input has no `based_on`. | none | Zero edges. | n/a | APP | U |
| AC-REL-043 | **based_on**: no re-pin. A new path revision keeps exactly the same target, and `relink` is not valid for creative_path. The carried target need not be chosen (AC-REL-056). [R11, R12] | Path r1 based_on C r1; C r2 exists | Edit gives path r2 with based_on C r1. | Changing the target: REJECT(E_REPIN_NOT_ALLOWED) | APP | U |
| AC-REL-044 | **based_on** (AI paths): the target is always the request's combination input. That exact revision was `chosen` when the request was created (AC-COMB-024) and when each retry was submitted (AC-COMB-029). The edge is written at commit even if the combination lost `chosen` after the run was validly created; `chosen` is not re-validated at any later point (AC-GEN-020, 028, 029). [R1, R8, R9, R13] | Request with chosen K r2 | Every AI path has based_on = K r2. | Unchosen at request creation: the request is refused (AC-COMB-024) | APP | I |
| AC-REL-050 | **evaluates**: every memory_test and pr_headline revision has exactly one edge, to a creative_path revision. | none | Accepted. | 0 or 2: REJECT(E_CARDINALITY) | APP | U |
| AC-REL-051 | **evaluates**: for AI tests from `path_evaluation`, the command writes the edge to the request's single `subject` revision. | Subject path P r2 | Every test from the run evaluates P r2. | n/a | APP | I |
| AC-REL-052 | **evaluates**: no re-pin. Testing a newer path revision requires a new test item. | Test on P r1; P r2 exists | Edit gives test r2 still evaluating P r1. | Changing the target: REJECT(E_REPIN_NOT_ALLOWED) | APP | U |
| AC-REL-053 | **evaluates**: a new test may not target a rejected path revision or a discarded path. | none | none | REJECT(E_TARGET_INACTIVE) | APP | U |
| AC-REL-054 | **based_on** (user-written paths): when a user command creates a `based_on` edge **for the first time** (a new path item), its exact combination revision must hold `chosen` in that same transaction. Edits that carry the same exact target are covered by AC-REL-056. An edit that changes the target is an identity violation (AC-REL-058), never a `chosen` check. [R6, R11, R12] | K r1 not chosen | none | REJECT(E_COMBINATION_NOT_CHOSEN); no ContentItem, ContentRevision or ContentRelation is created | APP | I |
| AC-REL-055 | A creative_path with no `based_on` edge is valid for every author and needs no combination check. [R6] | No chosen combination exists | A user path with no `based_on` is accepted. | n/a | APP | U |
| AC-REL-056 | **Carried-forward based_on.** A content-only edit of a path (`user_edit`, or an `ai_rewrite` from a request that does not use the combination directly) that keeps exactly the same `based_on` target revision is accepted whether or not that revision still holds `chosen`. The exception creates, transfers, restores or infers no decision role on any combination revision. The path's own selection follows AC-DEC-024 unchanged. [R11] | Path P r1 based_on K r1; K r1 no longer chosen (e.g. K r2 chosen instead) | P r2 created with based_on K r1; no DecisionEvent concerns K r1 or K r2. | n/a | APP | I |
| AC-REL-057 | Wherever the `chosen` check applies (first creation of `based_on` on a new path, a new request, a retry), choosing a newer revision of the same combination item does not satisfy it for an older revision. `chosen` on K r2 never validates K r1, and vice versa. [R6, R8, R11, R12] | K r2 chosen, K r1 not | based_on K r2 accepted. | based_on K r1: REJECT(E_COMBINATION_NOT_CHOSEN) | APP | U |
| AC-REL-058 | **Changed based_on target is an identity violation.** A command whose new path revision has a `based_on` target different from its source revision's exact target is refused with E_REPIN_NOT_ALLOWED. This includes another revision of the same combination item. A path on a different exact combination revision must be a new path item (AC-REL-060). [R12] | Path P r1 based_on K r1 | none | Target K r2, or K2 r1: REJECT(E_REPIN_NOT_ALLOWED); no revision or relation created | APP | U |
| AC-REL-059 | **Identity is checked before selection.** For a command that changes a path's `based_on` target, the identity check runs first; the `chosen` state of the new target is never evaluated and never changes the error. The error is always E_REPIN_NOT_ALLOWED, never E_COMBINATION_NOT_CHOSEN. [R12] | Generated target changes with chosen and unchosen targets | Always E_REPIN_NOT_ALLOWED. | n/a | APP | P |
| AC-REL-060 | **A different combination revision needs a new path.** A path for another exact combination revision (including a newer revision of the same combination item) is created as a new creative_path item, whose initial `based_on` target must hold `chosen` (AC-REL-054). The original path and its revisions are unchanged. [R12] | P based_on K r1; K r2 exists | New path P2 based_on K r2 accepted when K r2 is chosen. | K r2 not chosen: REJECT(E_COMBINATION_NOT_CHOSEN); no item, revision or relation | APP | I |

---

## 6. Combination criteria

Terms used here: **human side** = human_truth or human_tension; **brand side** = brand_element or category_element; **mechanism** = creative_mechanism. **Components** are the `combines` edges of one combination revision.

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-COMB-001 | At least 1 human-side component. [D1] | none | Accepted with ≥1. | 0: REJECT(E_COMPOSITION) / AI: DROP | APP | U |
| AC-COMB-002 | At least 1 brand-side component. [D2] | none | Accepted with ≥1. | 0: REJECT(E_COMPOSITION) / AI: DROP | APP | U |
| AC-COMB-003 | Zero mechanisms is valid. [D3] | 1 human side + 1 brand side | Accepted. | n/a | APP | U |
| AC-COMB-004 | Exactly one mechanism is valid. [D3] | 1 human side + 1 brand side + 1 mechanism | Accepted. | n/a | APP | U |
| AC-COMB-005 | Two or more mechanisms is invalid. [D3] | none | none | REJECT(E_COMPOSITION) / AI: DROP | APP | U |
| AC-COMB-006 | Five components in total is valid. [D4] | e.g. 2 human + 2 brand + 1 mechanism | Accepted. | n/a | APP | U |
| AC-COMB-007 | Six or more components is invalid. [D4] | none | none | REJECT(E_COMPOSITION) / AI: DROP | APP | U |
| AC-COMB-008 | The smallest valid combination has 2 components (1 human side + 1 brand side). A single component is invalid. | none | 2 accepted. | 1: REJECT(E_COMPOSITION) | APP | U |
| AC-COMB-009 | The composition space is fully enumerated: for human h ∈ 0..5, brand b ∈ 0..5 and mechanism m ∈ 0..2, a combination is valid iff h ≥ 1, b ≥ 1, m ≤ 1 and h + b + m ≤ 5. | Generated counts | Validity equals the formula. | REJECT(E_COMPOSITION) | APP | P |
| AC-COMB-010 | A component type outside the five allowed types is invalid (e.g. central_message, audience, creative_path, combination). | none | none | REJECT(E_RELATION_PAIR) | APP | U |
| AC-COMB-011 | The same revision may not appear twice, and two revisions of the same item may not appear in one combination revision. | none | none | REJECT(E_DUPLICATE_TARGET_ITEM) | DB+APP | U |
| AC-COMB-012 | Truth and tension may appear together; two different truth items may appear together. | none | Accepted. | n/a | APP | U |
| AC-COMB-013 | A component from another job is invalid. | none | none | REJECT(E_CROSS_JOB) | DB | I |
| AC-COMB-014 | A new component may not be a rejected revision or a revision of a discarded item. | none | none | REJECT(E_TARGET_INACTIVE) | APP | U |
| AC-COMB-015 | Component positions are unique and contiguous from 1 within a combination revision. | none | Positions 1..n. | Gap or duplicate: REJECT(E_POSITION) | DB+APP | U |
| AC-COMB-016 | **Structural identity:** every revision of a combination has the same member item set. [D17] | Combination item K | For all revisions, the set of `to_item_id` is equal. | Adding, removing or replacing an item: REJECT(E_IDENTITY_CHANGE); a new combination item is required | APP | P |
| AC-COMB-017 | `relink` may re-pin components to newer revisions of the same items and may reorder positions; the payload stays identical. | K r1 with truth T r1; T r2 exists | K r2 (relink) with T r2 is accepted. | n/a | APP | U |
| AC-COMB-018 | `user_edit` changes only `label` or `rationale`; components are carried forward unchanged. | none | Same component edges on the new revision. | n/a | APP | U |
| AC-COMB-019 | The composition rule is re-evaluated for every revision, including relinks. | none | none | REJECT(E_COMPOSITION) | APP | U |
| AC-COMB-020 | When a component item gets a newer revision, the combination is unchanged and flagged. | T r2 created | K still pins T r1. | WARN(target_superseded) | PROJ | I |
| AC-COMB-021 | An AI-proposed combination has `authorship = ai`, `assertion = suggestion` and `produced_by_run_id` set; each component is an exact RunInput revision of its request. [D5] | combination_suggestion run | Accepted. | A component not in the inputs, or a newer revision than the input: DROP of the combination | APP | I |
| AC-COMB-022 | AI-proposed combinations are never selected by the system. The run commit writes zero DecisionEvents, even if the output says "select". [D5] | Run output | Zero events. | n/a | APP | I |
| AC-COMB-023 | Only the user may assign `chosen` to a combination revision, and there is no cap on the number of chosen combinations. [R1] | User command | DecisionEvent `selected(K rN, chosen)` with `actor_user_id` = owner; a 10th chosen combination is accepted. | Any other actor: REJECT(E_FORBIDDEN) | APP | I |
| AC-COMB-024 | The exact combination revision used as a `path_generation` input must hold an active `chosen` selection when the request is created. [R1] | K r1 not chosen | none | REJECT(E_COMBINATION_NOT_CHOSEN) | APP | I |
| AC-COMB-025 | Combination revisions carry no EvidenceLinks. | none | none | REJECT(E_EVIDENCE_FORBIDDEN) / AI: link dropped | APP | U |
| AC-COMB-026 | A payload with no fields is valid; `label` and `rationale` are optional strings. | none | `{}` accepted. | n/a | APP | U |
| AC-COMB-027 | Only the user may remove `chosen` from a combination. A run commit never writes `unselected`, whatever the AI output contains. [R1] | K r1 chosen; AI output says "drop K" | K r1 stays chosen; zero events from the run. | n/a | APP | I |
| AC-COMB-028 | `chosen` is revision-exact. When K r1 is chosen and K r2 exists but is not chosen, only K r1 may be used as a path_generation input. [R1] | K r1 chosen, K r2 not chosen | A request with K r1 is accepted. | Request with K r2: REJECT(E_COMBINATION_NOT_CHOSEN) | APP | I |
| AC-COMB-029 | A retry of a path_generation request is accepted only if its exact combination input revision holds `chosen` when the retry is submitted. `chosen` on a newer revision of the same combination item does not count. A retry is a new use of the input. [R1, R8] | Attempt 1 failed; the user then unselected K r1, or moved `chosen` to K r2 | none | REJECT(E_COMBINATION_NOT_CHOSEN); no new GenerationRun, the request and attempt 1 are unchanged, `job_version` unchanged | APP | I |

---

## 7. Decision event criteria

### 7.1 Vocabulary and shape

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-DEC-001 | The allowed actions are: on content, selected, unselected, rejected, unrejected, favorited, unfavorited, discarded, restored; on presentations, archived, discarded, restored. [D10] | none | Any other action fails. | REJECT(E_INVALID_ENUM) | DB | U |
| AC-DEC-002 | `actor_user_id` equals the job owner. No event is created by a run commit. [D24] | none | none | REJECT(E_FORBIDDEN) | DB+APP | I |
| AC-DEC-003 | Target shape: selected, unselected, rejected and unrejected need an item **and** one of its revisions; favorited, unfavorited, discarded and restored on content need an item and no revision; presentation actions need a presentation and no content target. **[Default OI-1]** for the presentation target field. | none | none | REJECT(E_TARGET_SHAPE) | DB | U |
| AC-DEC-004 | `selection_role` is required for selected and unselected and null for every other action. Its values are chosen, primary, secondary, finalist. | none | none | REJECT(E_TARGET_SHAPE) | DB | U |
| AC-DEC-005 | The role must be allowed for the item's type (§3.3). | e.g. finalist on audience | none | REJECT(E_ROLE_NOT_ALLOWED) | APP | U |
| AC-DEC-006 | Every event records `command_id`, `job_sequence` and `policy_version`. The events of one command are committed all together or not at all. | Multi-event command | Consecutive sequences, same `command_id`. | Any failure: REJECT; none committed | DB+APP | I |

### 7.2 Selection and roles

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-DEC-010 | An item holds at most one active selection (one revision, one role). | Item selected | none | A second selection on any revision or role: REJECT(E_ITEM_ALREADY_SELECTED) | DB (projection index) + APP | I |
| AC-DEC-011 | **chosen, capped:** business_problem, communication_problem and central_message allow at most one active `chosen` per job. Selecting while another item holds it requires an explicit `unselected` of the holder earlier in the same command. | Holder A active | [unselected(A), selected(B)] is accepted. | selected(B) alone: REJECT(E_SLOT_OCCUPIED) | DB (projection index) + APP | I |
| AC-DEC-012 | **chosen, uncapped:** human_truth, restriction, open_question and combination [R1] allow any number of `chosen`. | none | 3 chosen accepted. | n/a | APP | U |
| AC-DEC-013 | **primary:** audience and human_tension allow at most one active `primary` per job per type. [D4] | Primary A active | [unselected(A, primary), selected(B, primary)] is accepted. | selected(B, primary) alone: REJECT(E_SLOT_OCCUPIED) | DB (projection index) + APP | I |
| AC-DEC-014 | **No automatic demotion:** after a new primary is selected, the previous primary holds no selection unless the same command explicitly wrote `selected(A, secondary)`. [D8] | As 013 | A holds no selection. | n/a | APP+PROJ | I |
| AC-DEC-015 | **Final-state invariant for secondaries.** After every accepted command, for each of audience and human_tension separately: if any active `secondary` exists, exactly one active `primary` of the same type exists on a **non-discarded** item. The check runs once, on the final state of the whole command; intermediate states between its events are not checked. It applies to every command that writes decision events (select, unselect, reject, discard, edit with selection move). [D6, R3] | No primary audience | none | selected(X, secondary) alone: REJECT(E_PRIMARY_REQUIRED) | APP | P |
| AC-DEC-016 | **Removing the primary:** a command whose final state keeps active secondaries of a type but no active primary of that type is refused. [R3] | Primary A with secondary B | [unselected(A, primary)] alone fails. [unselected(B, secondary), unselected(A, primary)] succeeds. [unselected(A, primary), unselected(B, secondary), selected(B, primary)] succeeds. | REJECT(E_PRIMARY_REQUIRED) | APP | I |
| AC-DEC-017 | **Role change on one item** is written explicitly as unselected(old role) + selected(new role) in the same command. [D8] | B is secondary | Promoting B writes both events. | selected(B, primary) without unselected(B, secondary): REJECT(E_ITEM_ALREADY_SELECTED) | APP | U |
| AC-DEC-018 | **finalist:** only creative_path; any number per job, with no cap. [D7] | 3 finalists | A 4th finalist is accepted. | Non-path: REJECT(E_ROLE_NOT_ALLOWED) | APP | U |
| AC-DEC-019 | The "recommend up to three finalists" guidance is UI only and never causes a rejection. [D7] | 10 finalists | Accepted. | n/a | POL | E |
| AC-DEC-020 | **Test chosen:** at most one active `chosen` memory_test, and one pr_headline, per evaluated path revision. The scope key is the `evaluates` target. | Chosen test T1 on P r1 | Chosen T2 on P r2 is accepted; chosen T3 on P r1 needs unselected(T1) first. | REJECT(E_SLOT_OCCUPIED) | DB (projection index) + APP | I |
| AC-DEC-021 | A rejected revision cannot be selected. | r1 rejected | none | REJECT(E_REVISION_REJECTED) | APP | U |
| AC-DEC-022 | A revision of a discarded item cannot be selected. | Item discarded | none | REJECT(E_ITEM_DISCARDED) | APP | U |
| AC-DEC-023 | No-op events are refused: selecting an already active (revision, role), or unselecting a (revision, role) that is not active. | none | none | REJECT(E_NO_OP) | APP | U |
| AC-DEC-024 | **Selection moves on edit** [D10 of v1.3]: a `user_edit` whose source is the actively selected revision writes, in one command, rN+1, unselected(rN, role) and selected(rN+1, same role), with consecutive `job_sequence`. The earlier events stay in history. This applies to `user_edit` only; a `relink` never moves a selection (AC-DEC-047). | rN selected as primary | Three records; rN+1 is primary. | n/a | APP | I |
| AC-DEC-025 | A `user_edit` from a non-selected revision writes no selection events. | r3 selected, edit from r1 | r4 created; r3 stays selected. | n/a | APP | U |
| AC-DEC-026 | An `ai_rewrite` never moves or creates a selection. | r2 selected | r3 (ai) created; r2 stays selected; the projection shows `has_newer_unselected_revision`. | n/a | APP+PROJ | I |
| AC-DEC-027 | Selection movement on a primary with active secondaries satisfies AC-DEC-016 at command end. | Primary A r1, secondary B | Edit of A gives A r2 primary; B unchanged. | n/a | APP | I |
| AC-DEC-028 | Selecting a revision with an active `claimed_fact_unverified` warning requires the command to acknowledge that warning explicitly. The acknowledgment is recorded on the event. **[Default OI-8]** | Warning on r1 | Selected with acknowledgment: accepted. | No acknowledgment: REJECT(E_WARNING_NOT_ACKNOWLEDGED) | APP | I |

### 7.3 Reject, favorite, discard, restore

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-DEC-030 | `rejected` targets one revision and changes no other revision or item flag. | Item with r1, r2 | Only r1 is flagged rejected. | n/a | PROJ | U |
| AC-DEC-031 | Rejecting a selected revision requires `unselected` of it earlier in the same command. | r1 selected | [unselected(r1), rejected(r1)] is accepted. | rejected(r1) alone: REJECT(E_REVISION_SELECTED) | APP | U |
| AC-DEC-032 | Rejecting an already rejected revision, or unrejecting one that is not rejected, is refused. | none | none | REJECT(E_NO_OP) | APP | U |
| AC-DEC-033 | `unrejected` does not restore any earlier selection. | r1 selected, then unselected + rejected, then unrejected | r1 not selected. | n/a | PROJ | U |
| AC-DEC-034 | Reject is not allowed on human_note. | none | none | REJECT(E_ACTION_NOT_ALLOWED) | APP | U |
| AC-DEC-035 | Favorite is item-scoped and allowed only on the types of §3.3. | restriction, open_question, human_note, memory_test | none | REJECT(E_ACTION_NOT_ALLOWED) | APP | U |
| AC-DEC-036 | A favorite survives new revisions of the item. | Item favorited, then r2 created | Still favorited. | n/a | PROJ | U |
| AC-DEC-037 | Discarding sets only the discard flag; selection, rejection and favorite state are unchanged. [D21] | Item selected (primary), favorited, r1 rejected | After discarding, all three are unchanged in the projection. | n/a | PROJ | I |
| AC-DEC-038 | A discard command may include explicit unselected or unfavorited events; each is a separate event with the same `command_id`. [D21] | none | Three events recorded. | n/a | APP | U |
| AC-DEC-039 | On a discarded item, only these are allowed: restored, unselected, unfavorited, rejected, unrejected. selected, favorited and discarded are refused. | Item discarded | none | REJECT(E_ITEM_DISCARDED) | APP | P |
| AC-DEC-040 | Restoring a non-discarded item is refused. | none | none | REJECT(E_NO_OP) | APP | U |
| AC-DEC-041 | Restore returns the item to exactly its state before the discard. | Any state S, then discard, then restore | The projection equals S (except the last-event fields). | n/a | PROJ | P |
| AC-DEC-042 | A selected but discarded item still counts toward role caps until it is explicitly unselected. It is excluded from effective selection and flagged. A discarded primary never supports a secondary, even though its `selected` event stays in history (AC-DEC-015, 043). [R3] | Primary A discarded, no secondaries | A new primary needs unselected(A) first; selected(B, secondary) is refused. | WARN(selected_but_discarded); secondary: REJECT(E_PRIMARY_REQUIRED) | APP+PROJ | I |
| AC-DEC-043 | **Discarding a primary under secondaries.** Discarding an item that holds the active primary of a type with active secondaries is accepted only if the same command explicitly brings the final state back into AC-DEC-015: either it unselects every secondary of that type, or it unselects the discarded primary and selects another non-discarded primary. [R3, D21] | Primary A, secondary B | [discarded(A), unselected(B, secondary)] accepted: A stays primary but discarded, B unselected. [discarded(A), unselected(A, primary), unselected(B, secondary), selected(B, primary)] accepted. | [discarded(A)] alone: REJECT(E_PRIMARY_REQUIRED) | APP | I |
| AC-DEC-044 | **Rejecting a primary under secondaries.** Rejecting the primary revision (which requires unselecting it, AC-DEC-031) is accepted only if the same command restores AC-DEC-015 with explicit events. [R3] | Primary A r1, secondary B | [unselected(A r1, primary), rejected(A r1), unselected(B, secondary), selected(B, primary)] accepted. | [unselected(A r1, primary), rejected(A r1)] alone: REJECT(E_PRIMARY_REQUIRED) | APP | I |
| AC-DEC-045 | **Every role change is an explicit event.** For any accepted command, the difference between the selection projection before and after equals exactly the set of selected and unselected events the command wrote. No role is added, removed or changed implicitly (no automatic demotion, promotion or clean-up). [D8, R3] | Generated commands | Projection diff = the command's explicit events. | Any implicit change is a defect | APP+PROJ | P |
| AC-DEC-046 | **Rejected decision commands leave nothing behind.** When a command is refused by any decision rule (including AC-DEC-015), none of its events are stored, even the ones that were individually valid, and `job_version` and the projection are unchanged. [R3] | A 4-event command whose final state is invalid | Zero of the 4 events exist afterwards. | REJECT(code) | APP | P |
| AC-DEC-047 | **Relink never moves a role.** A revision created with `change_type = relink` never receives a selection role implicitly. Without explicit events in the same command, the previous revision keeps its role and the relink revision has none. To transfer a role, the command writes `unselected(old, role)` and `selected(new, role)` explicitly, and its final state must satisfy every selection invariant (AC-DEC-010, 013, 015). Applies to every role on the relinkable types: `chosen` on combination; `primary` and `secondary` on human_tension. (`finalist` is not applicable: creative_path cannot be relinked.) [R7] | Combination K r1 chosen; relink to K r2 | Without events: K r1 chosen, K r2 no role. With both events: K r2 chosen, K r1 no role. | `selected(K r2)` without `unselected(K r1)`: REJECT(E_ITEM_ALREADY_SELECTED) | APP | I |
| AC-DEC-048 | **Property: relink creates no implicit role.** For every accepted command containing a `relink` revision, the selection projection after the command differs from the one before by exactly the command's explicit selected and unselected events (a special case of AC-DEC-045). [R7] | Generated relink commands with and without transfer events | Projection diff = explicit events. | Any implicit role is a defect | APP+PROJ | P |

### 7.4 Presentation decisions

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-DEC-050 | `archived` on a presentation by its owner is recorded as an event. Archiving an archived presentation is refused. [D10] | none | Event stored. | REJECT(E_NO_OP) | APP | U |
| AC-DEC-051 | An archived presentation accepts no new versions. No unarchive action exists. **[Default OI-2]** | Archived | none | New version: REJECT(E_PRESENTATION_ARCHIVED) | APP | I |
| AC-DEC-052 | A presentation can be discarded and restored. A discarded presentation accepts no new versions until it is restored. [D10] | none | Events stored. | New version while discarded: REJECT(E_PRESENTATION_DISCARDED) | APP | I |
| AC-DEC-053 | favorited, unfavorited, selected, unselected, rejected and unrejected on a presentation are refused. [D10] | none | none | REJECT(E_ACTION_NOT_ALLOWED) | APP | U |
| AC-DEC-054 | Presentation decisions never change content decision state, and content decisions never change presentation state. | none | Projections are independent. | n/a | PROJ | U |

### 7.5 Replay

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-DEC-060 | The projection is a pure fold of recorded events in `job_sequence` order, and nothing more. selected adds (item, revision, role); unselected removes it; rejected and unrejected toggle the revision flag; favorited, unfavorited, discarded, restored and archived set item or presentation flags. | Any log | Output is a function of the log alone. | n/a | PROJ | P |
| AC-DEC-061 | Replay applies no policy: no validation, no implicit side effects, no events created. | none | The number of events is unchanged by a rebuild. | n/a | PROJ | P |
| AC-DEC-062 | Changing the active policy does not change the projection rebuilt from an existing log. Events accepted under an older `policy_version` stay effective even if the current policy would refuse them. | A log accepted under P1; P2 made active | The rebuild under P2 equals the rebuild under P1. | n/a | PROJ | P |
| AC-DEC-063 | A rebuild that differs from the stored projection is reported as an incident. The stored projection is flagged invalid and is not patched by guessing. | Tampered projection | Incident recorded; commands fail closed (AC-ERR-013). | n/a | PROJ | I |

---

## 8. Evidence criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-EVID-001 | An EvidenceLink is valid only if 0 ≤ start < end ≤ length(raw_text) in code points, `quoted_text` is non-empty, and `quoted_text` equals raw_text[start:end] exactly. | SourceVersion v1 | A valid link is accepted. | User: REJECT(E_EVIDENCE_INVALID); AI: link not stored | DB (check) + APP | P |
| AC-EVID-002 | The cited SourceVersion belongs to the job's Source. | none | none | REJECT(E_CROSS_JOB) | DB | I |
| AC-EVID-003 | Offsets are counted in Unicode code points. A text containing astral characters (e.g. emoji) before the quote validates only with code-point offsets. | "☕🔥 Pausa ..." | Code-point offsets are accepted. | UTF-16 offsets: invalid | APP | U |
| AC-EVID-004 | An `extracted_fact` revision has ≥1 valid link committed in the same transaction, checked at commit. [D25] | none | Accepted. | Commit without a link fails (DB deferred check); see 005 and 007 for handling | DB | I |
| AC-EVID-005 | An AI fact whose quote cannot be located exactly in its cited version is DOWNGRADED. The failed link is not stored. | AI output with a fabricated quote | Stored as hypothesis or suggestion (§4.3) with WARN(claimed_fact_unverified). | n/a | APP | I |
| AC-EVID-006 | An AI fact citing a SourceVersion that is not a RunInput of its request is DOWNGRADED. | Request input v2; output cites v1 | DOWNGRADE. | n/a | APP | I |
| AC-EVID-007 | A user fact with an invalid or missing link is refused, never downgraded or reclassified. Nothing from the command is stored, including any links in it that were individually valid (AC-CONTENT-032). [R4] | none | none | REJECT(E_EVIDENCE_INVALID / E_EVIDENCE_REQUIRED) | APP | U |
| AC-EVID-008 | A hypothesis (AI or user [R5]) may carry 0..N links; each must satisfy AC-EVID-001. An invalid AI link is dropped and the hypothesis is kept. | none | Valid links stored. | AI: link not stored, reported; user: REJECT(E_EVIDENCE_INVALID), nothing stored | APP | U |
| AC-EVID-009 | Links on suggestion (except open_question) and on human_text are forbidden. | none | none | User: REJECT(E_EVIDENCE_FORBIDDEN); AI: link not stored | APP | U |
| AC-EVID-010 | When the AI quote occurs several times in the version, the stored offsets are those of the first occurrence. | Quote occurs at 10 and 80 | start = 10. | n/a | APP | U |
| AC-EVID-011 | (revision, source_version, start, end) is unique. | none | none | REJECT(E_DUPLICATE_EVIDENCE) | DB | U |
| AC-EVID-012 | EvidenceLinks belong to one revision and are never copied to a later revision automatically. | Fact r1 with links; r2 created | r2 has only links created in its own command. | n/a | APP | U |
| AC-EVID-013 | A new SourceVersion leaves every EvidenceLink, assertion and decision unchanged. [D9, D19] | Facts cite v1; v2 created | All hashes are unchanged; facts stay `extracted_fact`; selections unchanged. | n/a | DB+APP | I |
| AC-EVID-014 | After a new SourceVersion vN, the projection holds exactly one drift record per EvidenceLink whose version is older than vN, compared against vN (the latest version). | Links on v1, v2; v3 created | One record per link, all against v3. | n/a | PROJ | I |
| AC-EVID-015 | Drift status is the first that applies, in this order: **current** (vN has the same text at the same offsets); **moved** (exact text elsewhere; offsets nearest the original start, ties to the lowest offset); **changed** (no exact match, but a match after normalization); **missing**. | none | Status per the rule. | n/a | PROJ | P |
| AC-EVID-016 | Every drift record stores `algorithm_version`. A `changed` record without it is invalid. [D16] | none | Field is non-null. | Rebuild error | PROJ | U |
| AC-EVID-017 | Drift is reproducible: the same link, version and `algorithm_version` always give the same status and offsets. | Randomized texts | Identical results on repeated runs. | n/a | PROJ | P |
| AC-EVID-018 | Recomputing with a new `algorithm_version` produces records tagged with the new version and never modifies EvidenceLinks. The normalization steps of each version are defined in the policy configuration. **[Default OI-9]** | Algorithm v1 then v2 | New records are tagged v2; links unchanged. | n/a | PROJ | I |
| AC-EVID-019 | Drift never writes DecisionEvents, never changes an assertion, and never creates revisions. | `missing` on a selected fact | The selection stays; the fact stays `extracted_fact`. | WARN(evidence_drift) | PROJ | I |
| AC-EVID-020 | Drift is computed for links on hypotheses and open questions too. | none | Records exist. | n/a | PROJ | U |
| AC-EVID-021 | A user fact created by highlighting stores the exact user-selected offsets, and they validate under AC-EVID-001. | none | Accepted. | Mismatch: REJECT(E_EVIDENCE_INVALID) | APP | I |

---

## 9. Generation criteria

Request kinds and their input and output tables are in §13 **[Default OI-10]**. The criteria below hold for every kind.

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-GEN-001 | A new request creates one GenerationRequest (with `request_kind`, `instruction_version_id`, `user_instruction`, `requested_settings`, RunInputs, `policy_version`) and one GenerationRun with `attempt_number = 1`, `status = pending`. | none | Both records exist. | n/a | APP | I |
| AC-GEN-002 | The request's fields and RunInputs are immutable. [D18] | Any run state | The request hash is unchanged after every attempt. | Update fails | DB | I |
| AC-GEN-003 | Every RunInput references an exact SourceVersion, ContentRevision or PresentationBlock of the same job, with a role allowed for the request kind; the required inputs are present. | none | Accepted. | REJECT(E_INPUT_NOT_ALLOWED / E_INPUT_MISSING / E_CROSS_JOB) | APP | I |
| AC-GEN-004 | A revision of a discarded item is never an input. A rejected revision is an input only with role `anchor`. | none | Anchor accepted. | REJECT(E_TARGET_INACTIVE) | APP | U |
| AC-GEN-005 | A retry creates a new GenerationRun on the same request with `attempt_number` = previous + 1. The request and earlier runs are unchanged. [D10 of v1.3] | Attempt 1 failed | Attempt 2 created. | n/a | APP | I |
| AC-GEN-006 | A retry is allowed only when the latest attempt is `failed` or `canceled`. | Latest attempt pending or running | none | REJECT(E_RUN_ACTIVE) | APP | U |
| AC-GEN-007 | A retry after `completed` or `partial` is refused; the user must create a new request. | none | none | REJECT(E_RETRY_NOT_ALLOWED) | APP | U |
| AC-GEN-008 | A retry is refused if any RunInput would now be refused as a new input (e.g. its item was discarded). **[Default OI-11]** (The combination `chosen` check at retry is approved separately: AC-COMB-029, R8.) | Input item discarded after attempt 1 | none | REJECT(E_TARGET_INACTIVE) | APP | I |
| AC-GEN-009 | Attempt numbers are unique and contiguous from 1 per request. | none | 1..n | Duplicate: REJECT (DB unique) | DB | P |
| AC-GEN-010 | A run records `provider`, `resolved_model` and `resolved_settings` (and `provider_request_id` when the provider returns one) whenever the provider was called. These are never copied into the request. | none | Fields set on the run only. | n/a | APP | I |
| AC-GEN-011 | Status moves only forward: pending → running → completed, partial or failed; pending or running → canceled. Terminal statuses never change. **[Default OI-17]** for the status names. | none | Legal transitions accepted. | Illegal transition: storage error | DB | P |
| AC-GEN-012 | `completed`: every output element is valid. `partial`: ≥1 valid and ≥1 dropped, or fewer than requested. `failed`: zero valid, or a provider error. | none | Status matches the output. | n/a | APP | P |
| AC-GEN-013 | Failed and canceled runs create zero ContentRevisions and zero PresentationVersions. | none | Zero records. | n/a | APP | I |
| AC-GEN-014 | Every response received from the provider is preserved raw on the run, with a hash, including invalid ones and late responses to canceled runs. | none | Retrievable; the hash matches. | n/a | APP | I |
| AC-GEN-015 | Structured-output validation follows §4 (assertions), §5 (relations), §6 (combinations) and §8 (evidence). Each dropped element appears in the run's validation report with a reason code. | none | The report lists each element. | n/a | APP | I |
| AC-GEN-016 | An output of a type not allowed for the request kind is dropped. | none | none | DROP | APP | U |
| AC-GEN-017 | Every AI revision records `produced_by_run_id` (this run), `authorship = ai`, and the active `policy_version`. | none | Fields set. | n/a | DB | U |
| AC-GEN-018 | Implied relations (`based_on`, `evaluates`) are written by the commit command from the request structure. | none | See AC-REL-041 and AC-REL-051. | n/a | APP | I |
| AC-GEN-019 | The AI cannot create decisions: a run commit writes zero DecisionEvents whatever the output contains. | Output includes "select this" | Zero events. | n/a | APP | I |
| AC-GEN-020 | Run outputs are committed even if their inputs were rejected, discarded, superseded or (for combinations) unselected while the run was executing. Rejected, discarded and superseded inputs are flagged. Once a run has been validly created (including while `pending`, queued, scheduled, leased or otherwise waiting), losing `chosen` neither cancels it, nor prevents its execution, nor blocks the commit or the `based_on` edge. It writes no event and never invalidates, discards or hides the outputs, which stay traceable to the exact input revision and to the request and run. This is the specific exception to AC-REL-054 for AI paths. It applies to every run that produces creative_path revisions. [R1, R8, R9, R13] | Input discarded or unselected during the run | Outputs stored. | WARN(target_inactive) for rejected or discarded inputs | APP+PROJ | I |
| AC-GEN-021 | The user can cancel a pending or running run. A response arriving later is stored raw and creates no content. | none | Status `canceled`. | Cancel on a terminal run: REJECT(E_NO_OP) | APP | I |
| AC-GEN-022 | A run left in `running` beyond its lease is set to `failed` with `error_code = interrupted`. **[Default OI-17]** | Lease expired | Status failed. | n/a | APP | I |
| AC-GEN-023 | `rewrite` has exactly one anchor; its output is the next revision of the anchor's item, with `change_type = ai_rewrite` and source = anchor. | none | As stated. | Output for another item: DROP | APP | I |
| AC-GEN-024 | `alternatives` produces new items of the anchor's type, with `change_type = initial`, and no relation to the anchor. Lineage is the RunInput `anchor`. | none | New items. | Different type: DROP | APP | I |
| AC-GEN-025 | Outputs are validated against the policy active at commit time, and record that `policy_version`. **[Default OI-7]** | Policy changed during the run | Invalid elements under the new policy are dropped. | DROP | APP | I |
| AC-GEN-026 | `instruction_version_id` references an immutable InstructionVersion. | none | none | Missing: REJECT(E_REFERENCE_NOT_FOUND) | DB | U |
| AC-GEN-027 | A `rewrite` request whose anchor is a creative_path revision with a `based_on` edge needs the combination to be chosen **only if** the request uses that combination revision directly as a RunInput. Otherwise the output is a content-only edit that carries the same target (AC-REL-056) and no `chosen` check applies, at request, retry or commit. [R9, R11] | Anchor P r1 based_on K r1; K r1 not chosen | Request without K as input: accepted; the output P r2 keeps based_on K r1. | Request with K r1 as a direct input: REJECT(E_COMBINATION_NOT_CHOSEN); no request or run is created | APP | I |
| AC-GEN-028 | **No re-validation after run creation.** After a run is validly created, the `chosen` state of its combination inputs is never read again: not when a worker starts it, acquires or renews a lease, resumes it, or commits its outputs. For any sequence of selection changes on those inputs after creation, the run's execution, its committed outputs, their `based_on` edges and their provenance (`produced_by_run_id`, request, exact RunInputs) are identical. [R9, R13] | Generated selection histories after run creation | Identical commit outcome in every history. | n/a | APP | P |
| AC-GEN-029 | **The chosen check and run creation are one step.** A request (attempt 1) or retry validates `chosen` on its exact combination revision in the same transaction that creates the GenerationRun. If the check fails, no run and no request (for a new request) is created, and the command gets no protection. [R13] | Request or retry submitted | Accepted: run exists with `pending`; rejected: no run. | REJECT(E_COMBINATION_NOT_CHOSEN) | APP | I |
| AC-GEN-030 | **Races are resolved by commit order.** A user command that removes `chosen` and a request or retry that uses the same exact revision are serialized under the job lock. If the removal commits first, the request or retry is rejected and creates no run. If the request or retry commits first, its run is protected (AC-GEN-020, 028). [R13] | Both commands submitted concurrently | Exactly one of the two orders is observed, with the matching outcome. | n/a | APP | I |
| AC-GEN-031 | **Only the user cancels.** Losing `chosen` never cancels a run or changes its status. A run leaves `pending` or `running` only by execution, by user cancellation (AC-GEN-021) or by lease expiry (AC-GEN-022). [R13] | `chosen` removed while the run is `pending` | Run status unchanged by the removal. | n/a | APP | I |

---

## 10. Presentation criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-PRES-001 | A job can have any number of presentations; each belongs to exactly one job. [D8 of v1.3] | none | Two presentations in one job are accepted. | n/a | DB | U |
| AC-PRES-002 | `version_number` is unique and contiguous from 1 per presentation; versions are immutable. [D22] | none | 1..n | Update fails | DB | P |
| AC-PRES-003 | A version has ≥1 block **[Default OI-14]**; block `position` is unique and contiguous from 1; reads return blocks in ascending position. | none | Stable order on every read. | REJECT(E_POSITION / E_EMPTY_VERSION) | DB+APP | U |
| AC-PRES-004 | Block structure is free: no required block kinds and no required count beyond 1. `text` is non-empty after trimming. **[Default OI-14]** | none | Any sequence of text blocks is accepted. | Empty text: REJECT(E_SCHEMA) | APP | U |
| AC-PRES-005 | Provenance is recorded per **block**: each block records `authorship` (ai or user) and an optional `produced_by_run_id`, set if and only if `authorship = ai` (AC-GLOBAL-019). A version-level run field, if one exists, is informational and never replaces block-level provenance. [R2] | none | Fields per block. | Missing authorship: REJECT(E_PROVENANCE) | DB | U |
| AC-PRES-006 | A block has 0..N references. Each points to an exact ContentRevision of the same job, with a role in {presents, supports, evaluation} and a position unique and contiguous within the block. [D20] | Block citing 3 revisions | Accepted. | Cross-job: REJECT(E_CROSS_JOB); bad role: REJECT(E_INVALID_ENUM) | DB+APP | I |
| AC-PRES-007 | (block, revision, role) is unique. | none | none | REJECT(E_DUPLICATE_REFERENCE) | DB | U |
| AC-PRES-008 | Role and type compatibility: `presents` → creative_path; `evaluation` → memory_test or pr_headline; `supports` → any other type. **[Default OI-13]** | none | none | REJECT(E_ROLE_TYPE) | APP | U |
| AC-PRES-009 | A **new** reference may not target a rejected revision or a discarded item. References carried unchanged into a new version are exempt and flagged. **[Default OI-13]** | none | Carried reference kept. | New: REJECT(E_TARGET_INACTIVE); carried: WARN(target_inactive) | APP | I |
| AC-PRES-010 | Warnings: `supports` citing a hypothesis; `presents` citing a revision that is not an active finalist; any reference to a revision that is no longer its item's latest. | none | none | WARN(presentation_health) | PROJ | I |
| AC-PRES-011 | A new version declares `base_version_id`, which must be the presentation's latest version. | Latest is v3 | Base v3 accepted. | Base v2: REJECT(E_STALE_PRESENTATION_VERSION) | APP | I |
| AC-PRES-012 | **User edit of one block** creates version N+1. The edited block is a new row with `authorship = user`, no run, and `derived_from_block_id` = the source block. Every other block is copied with its text, authorship, `produced_by_run_id` and references unchanged, and `derived_from_block_id` = its predecessor. Version N is unchanged. [D11, D22] | Version N | As stated. | n/a | APP | I |
| AC-PRES-013 | **AI rewrite of one block**: the request has the source block (RunInput kind `presentation_block`) and its referenced revisions as inputs. On commit, version N+1 contains the rewritten block with `authorship = ai`, `produced_by_run_id` = the run, and `derived_from_block_id` = the source block; the other blocks are copied as in 012; version N is unchanged. [D11] | Version N | As stated. | n/a | APP | I |
| AC-PRES-014 | The rewritten block keeps the source block's references unchanged. **[Default OI-12]** | Source block with 2 references | New block with the same 2 references. | n/a | APP | U |
| AC-PRES-015 | A failed or canceled rewrite run creates no version. | none | Latest version unchanged. | n/a | APP | I |
| AC-PRES-016 | If the presentation has advanced beyond the rewrite's base version when the run completes, the output is **not applied**: no version is created, the raw response is kept, and the run is `completed` with the report reason `base_advanced`. **[Default OI-12]** | Base v3; user creates v4 during the run | No v5 from the run. | WARN(rewrite_not_applied) | APP | I |
| AC-PRES-017 | Archiving and discarding follow AC-DEC-050 to AC-DEC-053. Favoriting a presentation is refused. [D10] | none | none | REJECT(E_ACTION_NOT_ALLOWED) | APP | U |
| AC-PRES-018 | Every PresentationVersion records `job_sequence` and `policy_version`. | none | Non-null. | n/a | DB | U |
| AC-PRES-019 | Version numbering is independent per presentation. | P1 at v3, P2 new | P2 starts at 1. | n/a | DB | U |
| AC-PRES-020 | Showing a non-finalist with `presents` is allowed (it produces only the warning of 010) and never changes finalist state. | none | Accepted. | WARN(presentation_health) | APP+PROJ | U |
| AC-PRES-021 | Presentation text is never stored as a ContentItem. [D13] | none | There is no ContentItem for block text. | Any command creating `presentation_content`: REJECT(E_INVALID_ENUM) | DB | U |
| AC-PRES-022 | One version may contain blocks with different authors and different runs. Each copied block keeps its original `authorship` and `produced_by_run_id`. [R2] | v1 drafted by run R1; the user edits b1 (v2); run R2 rewrites b3 (v3) | In v3: b1 is `user` with no run, b2 is `ai` + R1, b3 is `ai` + R2. | n/a | APP | I |
| AC-PRES-023 | A rewritten block (user or AI) sets `derived_from_block_id` to the exact source block, which must belong to the base version of the same presentation. A block newly added in a version has no `derived_from_block_id`. [R2] | Base v3 | Rewrite of v3's b2 accepted. | Source block from another version, another presentation or another job: REJECT(E_SOURCE_BLOCK_INVALID) | DB+APP | I |
| AC-PRES-024 | A block rewrite never mutates the previous version: all blocks and references of version N keep identical content hashes after N+1 is created. [R2, D22] | Version N | Hashes unchanged. | Any update attempt: storage error | DB | P |

---

## 11. Error and concurrency criteria

Columns: **Whole command rejected?** / **Raw diagnostics retained?** / **Domain records committed?**

Three kinds of outcome must be kept apart [R10, R14, R15]:
1. **Domain state:** the domain records of §1.2. Only accepted commands change it.
2. **Technical idempotency state:** the idempotency record of a deterministic outcome (acceptance, domain-rule rejection, idempotency conflict where applicable). It is not counted under "Domain records committed".
3. **Uncommitted technical failure:** nothing is committed; the same (`job_id`, `command_id`) stays retryable.

Every row where the command is rejected by a domain rule also writes its idempotency record (AC-GLOBAL-029). To retry a rejected command after fixing the cause (for example after E_STALE_JOB_VERSION), the client must use a new `command_id`. Whether E_PROJECTION_UNAVAILABLE is a stored rejection or a technical failure: **[Default OI-29]**.

| ID | Failure | Preconditions | Expected result | Rejected / Diagnostics / Records | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-ERR-001 | Stale `expected_job_version` | job_version 40; command expects 39 | E_STALE_JOB_VERSION; the response includes 40. | Yes / error log only / **none** | APP | I |
| AC-ERR-002 | Two commands from two tabs with the same `expected_job_version` | Both expect 40 | Exactly one is accepted; the other gets E_STALE_JOB_VERSION. | Loser: Yes / log / none | APP | I |
| AC-ERR-003 | Duplicate `command_id`, identical payload (e.g. a retry after a network drop) | Command accepted or rejected earlier | The original response is returned without re-executing the command. [R10] | No / n/a / **none new** | APP | I |
| AC-ERR-004 | Duplicate `command_id`, different payload | Command accepted or rejected earlier | E_COMMAND_ID_CONFLICT; the stored idempotency record is unchanged. [R10] | Yes / log / none | APP | I |
| AC-ERR-005 | Partial transaction failure (any write in the command fails, including the projection update or the idempotency record) | Fault injected after the first event insert | Full rollback; job_version and projection unchanged; the next accepted record takes the next sequence with no gap. This is a TECHNICAL FAILURE, not a domain rejection: no idempotency record is kept, so the same (`job_id`, `command_id`) can be retried and will execute. [R15] | Yes / error log / **none** | DB | I |
| AC-ERR-006 | Invalid cross-job reference | none | E_CROSS_JOB. | Yes / log / none | DB+APP | I |
| AC-ERR-007 | Missing referenced revision (non-existent ID) | none | E_REFERENCE_NOT_FOUND. | Yes / log / none | DB | I |
| AC-ERR-008 | Policy version mismatch: the command declares a `policy_version` different from the active one **[Default OI-7]** | Active P2; command declares P1 | E_POLICY_VERSION_MISMATCH; the response includes P2. | Yes / log / none | APP | I |
| AC-ERR-009 | Policy changes between request creation and run commit | Request under P1; P2 active at commit | Outputs validated under P2; invalid elements dropped. | No (system commit) / raw kept / valid elements only | APP | I |
| AC-ERR-010 | AI provider failure (error or timeout) | none | Run `failed` with `error_code` provider_error or timeout; the request stays; a retry is possible. | n/a / **provider error payload kept** / request and run records only, zero content | APP | I |
| AC-ERR-011 | Invalid structured output (unparseable or schema-invalid) | none | Run `failed`, `error_code = invalid_output`. | n/a / **raw response kept** / zero content | APP | I |
| AC-ERR-012 | Mixed valid and invalid output | 5 requested, 3 valid | Run `partial`; 3 items committed; 2 reported. | n/a / raw kept / valid elements only | APP | I |
| AC-ERR-013 | Projection rebuild failure or detected divergence | Rebuild throws, or the comparison mismatches | Projection flagged invalid; every command that validates against it is refused with E_PROJECTION_UNAVAILABLE (fail closed); the log and history reads keep working; an incident is recorded. | Yes / incident record / none | APP+PROJ | I |
| AC-ERR-014 | Projection recovery | State after 013 | A full rebuild from the log succeeds; the projection equals the fold; commands are accepted again. | n/a / incident closed / none (the rebuild writes only projection) | PROJ | I |
| AC-ERR-015 | Run output commit races a user command | User command expects 40; the run commits first (41) | The run commit succeeds; the user command gets E_STALE_JOB_VERSION. | User: Yes / log / none | APP | I |
| AC-ERR-016 | Retry submitted twice with the same `command_id` | Attempt 1 failed | Exactly one attempt 2. | Second: No / n/a / none new | APP | I |
| AC-ERR-017 | Unknown enum value in any field | none | E_INVALID_ENUM. | Yes / log / none | DB | U |
| AC-ERR-018 | Replay of a rejected command, same `command_id`, same payload | C rejected with E_EVIDENCE_REQUIRED | The stored rejection is returned; no validation runs. [R10] | Yes (same rejection) / n/a / **none** | APP | I |
| AC-ERR-019 | Reuse of a rejected command's `command_id` with a different payload (including the same content under another claim type) | C rejected | E_COMMAND_ID_CONFLICT. [R10] | Yes / log / none | APP | I |
| AC-ERR-020 | Resubmission under a new `command_id` after a rejection | C rejected; C' has a new id and a corrected payload | C' is validated and executed independently of C; C's idempotency record is unchanged. [R10] | Depends on C' / n/a / C' records only | APP | I |
| AC-ERR-021 | Crash, rollback, unavailable storage or network interruption **before** commit | No committed idempotency record for (J, c-1) | Re-sending c-1 in J executes the command as new. [R15] | n/a (TECHNICAL FAILURE) / error log / **none** | APP | I |
| AC-ERR-022 | Response lost **after** commit (network drop after the idempotency record was committed) | Record for (J, c-1) committed | Re-sending c-1 in J returns the stored result without re-executing. [R15] | No / n/a / **none new** | APP | I |
| AC-ERR-023 | Fault while committing domain changes, completed result and idempotency record | Fault injected at each of the three writes in turn | In every case none of the three is committed and c-1 stays retryable. [R15] | TECHNICAL FAILURE / error log / **none** | DB | P |
| AC-ERR-024 | Same `command_id` in two jobs | c-1 committed in J1 | c-1 in J2 is executed independently; J1's record is untouched. [R14] | Depends on the J2 command / n/a / J2 records only | APP | I |
| AC-ERR-025 | A stored record whose canonicalization version is older than the current rules | Record for (J, c-1) with version v1; current rules v2 | A replay with the same payload is fingerprinted with v1 and returns the stored result, not a conflict. [R14] | No / n/a / none | APP | I |

---

## 12. Given, When, Then scenarios

Scenario IDs use each family's prefix, numbered from 101. The examples use Pausa, a fictional instant coffee brand.

### Global

**AC-GLOBAL-101: Editing a component never moves references to it** (I)
Given combination K r1 combines human truth T r1, and T r1 is a RunInput of path request R
When the user edits T (T r2)
Then K r1 still combines T r1, R's RunInput still references T r1, and K shows WARN(target_superseded)
And no record other than T r2 was written

**AC-GLOBAL-102: Anonymization keeps decision state** (I)
Given a job with 30 decision events and a stored projection
When an administrator anonymizes the job's text
Then an ErasureRecord exists outside the job
And a projection rebuild gives identical selection, rejection, favorite and discard state
And a domain command asking for erasure is refused with E_FORBIDDEN

### Content

**AC-CONTENT-101: Editing a selected AI fact** (I)
Given audience A r1 (`ai`, `extracted_fact`, one EvidenceLink) is selected as primary
When the user edits the description, declares `assertion_type = human_text` and attaches no evidence
Then A r2 is `user` + `human_text` + `user_edit` with no EvidenceLink
And unselected(r1, primary) and selected(r2, primary) are written in the same command
And A r1 and its EvidenceLink are unchanged
And A r2's assertion was declared by the user, not derived by the system (AC-CONTENT-031)

**AC-CONTENT-102: `brief` authorship is refused** (U)
Given any content command
When `authorship = brief`
Then the command is refused with E_INVALID_ENUM

**AC-CONTENT-103: Relink is limited to three types** (U)
Given creative_path P r1
When the user submits a `relink` revision
Then the command is refused with E_RELINK_NOT_ALLOWED

**AC-CONTENT-104: AI tension without reality** (U)
Given a brief_analysis output with a human_tension that has `desire` but no `reality`
When the run is committed
Then the tension is dropped and listed in the validation report
And no human_truth is created from it
And the run is `partial` if other elements are valid

**AC-CONTENT-105: A user fact without evidence is rejected, not relabeled** (I)
Given job version 40 and brief v1
When the user saves a new business_problem declared as `extracted_fact` with no EvidenceLink
Then the command is refused with E_EVIDENCE_REQUIRED
And the response lists `human_text` and `hypothesis` as alternatives
And no ContentItem, ContentRevision, EvidenceLink or DecisionEvent exists for it, and job version is still 40
When the user resubmits as a new command declaring `hypothesis`
Then the revision is stored as `user` + `hypothesis`, with no evidence required

**AC-CONTENT-106: Editing a selected fact with a bad quote leaves nothing behind** (I)
Given audience A r1 (`extracted_fact`) is primary and audience B is secondary
When the user edits A, declares `extracted_fact`, and attaches a quote that does not match v1
Then the command is refused with E_EVIDENCE_INVALID
And A r2 does not exist, no EvidenceLink was written, and no unselected or selected events were written
And A r1 is still primary and B is still secondary

**AC-CONTENT-107: No alternative is saved by the system** (P)
Given the user saves a human_truth declared as `extracted_fact` with a quote that is not in v1
When the command is refused with E_EVIDENCE_INVALID
And the user sends no further command
Then no revision of any assertion exists for that content, and no server process creates one later

**AC-CONTENT-108: Alternatives offered depend on the type** (U)
Given the user saves a central_message declared as `extracted_fact` with no evidence
When the command is refused with E_EVIDENCE_REQUIRED
Then the response lists only `human_text`
When the user resubmits declaring `hypothesis`
Then that command is refused with E_ASSERTION_NOT_ALLOWED

**AC-CONTENT-109: A user hypothesis on a descriptive type** (U)
Given brief v1
When the user writes the audience "Night-shift nurses who drink coffee at 3 a.m." declared as `hypothesis`, with no evidence
Then it is stored as `user` + `hypothesis`
When the user writes a creative_path declared as `hypothesis`
Then the command is refused with E_ASSERTION_NOT_ALLOWED

**AC-CONTENT-110: Resubmitting under another claim type needs a new command_id** (I)
Given command C (id c-1) saved an audience declared `extracted_fact` with no evidence, and was refused with E_EVIDENCE_REQUIRED
When the client re-sends c-1 with the identical payload
Then the same E_EVIDENCE_REQUIRED response is returned, the command is not re-executed, and nothing is written
When the client sends c-1 with the same audience declared `hypothesis`
Then the command is refused with E_COMMAND_ID_CONFLICT and nothing is written
When the client sends a new id c-2 with the audience declared `hypothesis`
Then it is accepted as `user` + `hypothesis`, and c-1's idempotency record still holds the original rejection

### Relations

**AC-REL-101: Re-pinning an answer** (I)
Given note N r1 answers question Q r1, and the user edits Q (Q r2)
When the user relinks N to Q r2
Then N r2 has `change_type = relink`, a payload equal to N r1, and `answers` → Q r2
And N r1 still answers Q r1

**AC-REL-102: Answering a different question needs a new note** (U)
Given note N answers Q1
When the user relinks N to question Q2
Then the command is refused with E_IDENTITY_CHANGE

**AC-REL-103: A test does not follow the path** (I)
Given memory test M r1 evaluates path P r1, and P r2 exists
When the user edits M's verdict
Then M r2 evaluates P r1
And no `evaluates` to P r2 can be created on M

**AC-REL-104: A path cannot change its combination** (U)
Given path P r1 is based_on K1 r1
When the user edits P with based_on → K2 r1
Then the command is refused with E_REPIN_NOT_ALLOWED

**AC-REL-105: A manual path on an unchosen combination** (I)
Given combination K r1 exists and is not chosen, and job version is 50
When the user writes a new creative_path based_on K r1
Then the command is refused with E_COMBINATION_NOT_CHOSEN
And no ContentItem, ContentRevision or ContentRelation exists for it, and job version is still 50
When the user writes the same path with no `based_on`
Then it is accepted

**AC-REL-106: Editing a path whose combination moved on** (I)
Given path P r1 based_on K r1, and the user later edited K's label so `chosen` moved to K r2 (AC-DEC-024)
When the user edits P's title
Then P r2 is created with `based_on` K r1, although K r1 is no longer chosen [R11]
And no DecisionEvent is written for K r1 or K r2: K r2 stays chosen, K r1 stays unchosen
And if P r1 was a finalist, the selection moves to P r2 only through the explicit events of AC-DEC-024

**AC-REL-107: Changing the combination of a path is an identity violation** (U)
Given path P r1 based_on K r1, combination K2 r1 is not chosen and K3 r1 is chosen
When the user edits P with `based_on` → K2 r1
Then the command is refused with E_REPIN_NOT_ALLOWED and nothing is written
When the user edits P with `based_on` → K3 r1
Then the command is also refused with E_REPIN_NOT_ALLOWED; the chosen state of K3 r1 plays no part
When the user writes a new path item based_on K2 r1
Then it is refused with E_COMBINATION_NOT_CHOSEN; a new path item based_on K3 r1 is accepted

**AC-REL-108: Moving an idea to a newer revision of the same combination** (I)
Given path P r1 based_on K r1, and K r2 exists
When the user edits P with `based_on` → K r2
Then the command is refused with E_REPIN_NOT_ALLOWED, whether or not K r2 is chosen
When K r2 is not chosen and the user writes a new path item P2 based_on K r2
Then it is refused with E_COMBINATION_NOT_CHOSEN and no item, revision or relation exists
When the user chooses K r2 and writes P2 again
Then P2 r1 is created based_on K r2, and P and its revisions are unchanged

### Combinations

**AC-COMB-101: The five-component boundary** (U)
Given truths T1, T2, brand element B1, category element C1 and mechanism M1
When the user creates a combination of all five
Then it is accepted
When the user adds tension H1 as a sixth
Then the command is refused with E_COMPOSITION

**AC-COMB-102: Two mechanisms** (U)
Given truth T1, brand element B1 and mechanisms M1, M2
When the user creates the combination {T1, B1, M1, M2}
Then the command is refused with E_COMPOSITION

**AC-COMB-103: No brand side** (U)
Given truth T1 and tension H1
When the user creates {T1, H1}
Then the command is refused with E_COMPOSITION

**AC-COMB-104: AI invents a member** (I)
Given a combination_suggestion request whose inputs are T1 r1, B1 r1, M1 r1
When the AI proposes {T1 r1, B2 r1}, where B2 was not an input
Then that combination is dropped and reported
And the run is `partial` or `failed` depending on the other outputs

**AC-COMB-105: The AI cannot select its own combination** (I)
Given the AI proposes a valid combination K whose output text says "recommended: select"
When the run is committed
Then K exists with `authorship = ai`, `suggestion`, and zero DecisionEvents
And K r1 cannot be a path_generation input until the user chooses it (AC-COMB-024)
When the user writes selected(K r1, chosen)
Then the event has `actor_user_id` = owner

**AC-COMB-106: Relink versus replacing a member** (U)
Given K r1 = {T r1, B r1} and T r2 exists
When the user relinks K to {T r2, B r1}
Then K r2 is accepted with `change_type = relink`
When the user tries {T2 r1, B r1}, where T2 is another truth item
Then the command is refused with E_IDENTITY_CHANGE

**AC-COMB-107: Unchosen combination as input** (I)
Given combination K with no active `chosen` selection
When the user creates a path_generation request with K
Then the command is refused with E_COMBINATION_NOT_CHOSEN
And no GenerationRequest, RunInput or GenerationRun exists for it

**AC-COMB-108: Chosen belongs to the exact revision** (I)
Given K r1 is chosen and the user edits K's label, creating K r2 (so the selection moves to K r2 per AC-DEC-024)
When the user creates a path_generation request with K r1
Then the command is refused with E_COMBINATION_NOT_CHOSEN
When the user creates it with K r2
Then it is accepted and its RunInput pins K r2

**AC-COMB-109: Unchoosing before a retry** (I)
Given path_generation request R with chosen K r1, and attempt 1 `failed`
And the user then writes unselected(K r1, chosen)
When the user retries R
Then the command is refused with E_COMBINATION_NOT_CHOSEN
And R and attempt 1 are unchanged, and no attempt 2 exists

**AC-COMB-110: The AI cannot remove chosen** (I)
Given K r1 is chosen and a combination_suggestion run outputs "replace K with K2", together with an unselected instruction
When the run is committed
Then K2 is stored as an AI suggestion, K r1 is still chosen, and the run wrote zero DecisionEvents

**AC-COMB-111: A newer chosen revision does not rescue a retry** (I)
Given path_generation request R used K r1, and attempt 1 `failed`
And the user relinked K to K r2 and transferred `chosen` with explicit events (K r2 chosen, K r1 not)
When the user retries R
Then the command is refused with E_COMBINATION_NOT_CHOSEN
And no attempt 2 exists and job version is unchanged
When the user creates a new request with K r2
Then it is accepted

### Decisions

**AC-DEC-101: Secondary before primary** (U)
Given no audience is selected
When the user selects audience A as secondary
Then the command is refused with E_PRIMARY_REQUIRED

**AC-DEC-102: No automatic demotion** (I)
Given audience A is primary
When the user submits [unselected(A, primary), selected(B, primary)]
Then B is primary and A holds no selection
When the user submits selected(C, primary) alone
Then the command is refused with E_SLOT_OCCUPIED

**AC-DEC-103: Promoting a secondary** (I)
Given A is primary and B is secondary
When one command writes unselected(A, primary), unselected(B, secondary), selected(B, primary), selected(A, secondary)
Then the four events have consecutive `job_sequence` values and the same `command_id`
And B is primary and A is secondary

**AC-DEC-104: Removing the primary under secondaries** (U)
Given A is primary and B is secondary
When the user unselects A only
Then the command is refused with E_PRIMARY_REQUIRED
And A is still primary and B still secondary

**AC-DEC-105: A discarded primary cannot anchor a new secondary** (I)
Given primary tension H1 is discarded with no secondaries (still selected, D21)
When the user selects H2 as secondary
Then the command is refused with E_PRIMARY_REQUIRED
And the projection shows WARN(selected_but_discarded) on H1
And H1's original `selected` event is still in the log

**AC-DEC-106: Rejecting a selected revision** (U)
Given central message CM r2 is chosen
When the user rejects CM r2 without unselecting it
Then the command is refused with E_REVISION_SELECTED
When the user submits [unselected(r2, chosen), rejected(r2)]
Then it is accepted, and CM r1 is unaffected

**AC-DEC-107: Replay ignores the current policy** (P)
Given a log accepted under P1 that includes favorited(combination K)
And policy P2, which forbids favorites on combinations, is made active
When the projection is rebuilt
Then K is still favorited
And a new favorited(K2) under P2 is refused

**AC-DEC-108: Discard and restore round-trip** (P)
Given item X: r2 finalist, favorited, r1 rejected
When the user discards X and then restores it
Then the projection equals the pre-discard state
And while X was discarded, selected(X r3, finalist) was refused with E_ITEM_DISCARDED

**AC-DEC-109: Four finalists are fine** (U)
Given three finalists exist
When the user selects a fourth
Then it is accepted with no warning in the data model

**AC-DEC-110: Discarding a primary that has secondaries** (I)
Given audience A is primary and audiences B and C are secondary
When the user discards A alone
Then the command is refused with E_PRIMARY_REQUIRED and nothing changes
When one command writes discarded(A), unselected(A, primary), unselected(B, secondary), selected(B, primary)
Then it is accepted: A is discarded with no selection, B is primary, C is still secondary
And no event other than those four was written

**AC-DEC-111: Only the final state is checked** (I)
Given tension H1 is primary and H2 is secondary
When one command writes unselected(H1, primary) first and selected(H3, primary) last
Then it is accepted, although H2 was an orphaned secondary between the two events
And H1 holds no selection, since nothing demoted it to secondary

**AC-DEC-112: A refused multi-event command leaves no partial state** (P)
Given audience A is primary and B is secondary
When one command writes unselected(B, secondary), selected(D, secondary), unselected(A, primary)
Then it is refused with E_PRIMARY_REQUIRED, because the final state has secondary D but no primary
And none of the three events exists, even though unselected(B, secondary) was valid on its own, and job version is unchanged

**AC-DEC-113: Relink keeps the role on the old revision** (I)
Given combination K r1 is chosen and T r2 exists for a member T
When the user relinks K to T r2 without decision events
Then K r2 exists with no role and K r1 is still chosen
And the projection shows `has_newer_unselected_revision` for K
And a path_generation request with K r2 is refused with E_COMBINATION_NOT_CHOSEN

**AC-DEC-114: Transferring a primary through a relink** (I)
Given tension H r1 is primary and tension J is secondary
When one command writes H r2 (relink), unselected(H r1, primary), selected(H r2, primary)
Then it is accepted: H r2 is primary, H r1 has no role, J is still secondary
When instead the command writes H r2 (relink), unselected(H r1, primary) only
Then it is refused with E_PRIMARY_REQUIRED (J would have no primary) and H r2 does not exist

**AC-DEC-115: A relink that grabs a role without releasing it** (U)
Given combination K r1 is chosen
When one command writes K r2 (relink) and selected(K r2, chosen), without unselected(K r1)
Then it is refused with E_ITEM_ALREADY_SELECTED, and K r2 does not exist

### Evidence

**AC-EVID-101: A moved quote** (I)
Given fact F r1 cites v1 [120, 160)
When v2 inserts a paragraph before the quote
Then drift is `moved` with new offsets, and F r1's EvidenceLink still reads [120, 160) on v1
And F stays `extracted_fact` and any selection is unchanged

**AC-EVID-102: A whitespace change** (I)
Given the quote "três  minutos" in v1 (two spaces)
When v2 contains "três minutos"
Then drift is `changed` with `algorithm_version` recorded, never `current` or `moved`

**AC-EVID-103: A removed quote** (I)
Given fact F cites a sentence that v2 deletes
When v2 is created
Then drift is `missing`, F is unchanged, and no DecisionEvent is written

**AC-EVID-104: A fabricated AI quote** (I)
Given brief_analysis outputs business_problem "Pausa lost 4 share points" with a quote absent from v1
When the run is committed
Then the item is stored as `hypothesis` with WARN(claimed_fact_unverified) and no EvidenceLink
When the user selects it without acknowledging the warning
Then the command is refused with E_WARNING_NOT_ACKNOWLEDGED [Default OI-8]

**AC-EVID-105: Emoji offsets** (U)
Given raw_text "☕🔥 Pausa é pausa"
When a link cites "Pausa" at code points [3, 8)
Then it validates; the UTF-16 offsets [4, 9) are refused

**AC-EVID-106: A user highlight with a wrong quote** (U)
Given the user highlights [10, 20) but sends a different `quoted_text`
When the fact is submitted
Then the command is refused with E_EVIDENCE_INVALID, and nothing is stored as human_text either

### Generation

**AC-GEN-101: Retry after a provider failure** (I)
Given request R, attempt 1 `failed` (provider_error, error payload kept)
When the user retries
Then attempt 2 exists on R, R's hash is unchanged, and attempt 1 is unchanged

**AC-GEN-102: Retry after partial** (U)
Given request R, attempt 1 `partial`
When the user retries
Then the command is refused with E_RETRY_NOT_ALLOWED

**AC-GEN-103: Requested versus resolved settings** (I)
Given R requests temperature 1.2
When the provider runs at 1.0
Then R shows 1.2 and the run shows 1.0

**AC-GEN-104: Cancel, then a late response** (I)
Given run X is `running`
When the user cancels and the provider responds 5 seconds later
Then X stays `canceled`, the raw response is stored, and zero revisions exist from X

**AC-GEN-105: An AI rewrite does not steal a selection** (I)
Given central message CM r2 is chosen
When a rewrite run produces CM r3
Then CM r2 stays chosen and the projection flags `has_newer_unselected_revision`

**AC-GEN-106: An input discarded during a run** (I)
Given path_generation R with combination K r1 is running
When the user discards K and then R completes
Then the paths are committed with based_on K r1 and WARN(target_inactive)

**AC-GEN-107: The combination loses chosen while the run executes** (I)
Given path_generation request R with chosen K r1, and attempt 1 is `running`
When the user writes unselected(K r1, chosen), and then the run completes with 5 valid paths
Then the run is `completed`, and the 5 paths are stored with `based_on` K r1 and `produced_by_run_id` = attempt 1, with no `chosen` check at commit [R9]
And no DecisionEvent is written, and the paths are neither discarded nor hidden
And each path traces to request R, attempt 1 and K r1

**AC-GEN-108: A new request or retry from an unchosen revision after a successful run** (I)
Given the state at the end of AC-GEN-107 (K r1 unchosen, 5 paths saved)
When the user creates a new path_generation request with K r1
Then it is refused with E_COMBINATION_NOT_CHOSEN and no request or run exists
When the user retries request R
Then it is refused with E_RETRY_NOT_ALLOWED (attempt 1 completed), and in any case no attempt 2 exists

**AC-GEN-109: Rewriting a path whose combination is no longer chosen** (I)
Given path P r1 based_on K r1, and K r1 is no longer chosen
When the user requests a `rewrite` of P r1 without K r1 as a RunInput
Then the request is accepted and the output P r2 (`ai_rewrite`) keeps `based_on` K r1
When the user requests a rewrite that includes K r1 as a direct RunInput
Then it is refused with E_COMBINATION_NOT_CHOSEN

**AC-GEN-110: Losing chosen while the run is queued** (I)
Given path_generation request R with chosen K r1 created run attempt 1, still `pending` in the queue
When the user writes unselected(K r1, chosen)
And a worker later starts the run, renews its lease twice, and the run completes with 5 valid paths
Then the run was never cancelled or blocked, no `chosen` check ran at start, lease renewal or commit
And the 5 paths are stored with `based_on` K r1, `produced_by_run_id` = attempt 1, and RunInputs pinning K r1

**AC-GEN-111: Losing chosen before the request is validated** (I)
Given K r1 is chosen
When the user's unselected(K r1, chosen) commits before the path_generation request that uses K r1
Then the request is refused with E_COMBINATION_NOT_CHOSEN, and no GenerationRequest or GenerationRun exists
When instead the request commits first
Then its run exists and is protected, and the later unselect does not affect it

**AC-GEN-112: Losing chosen before a retry is validated** (I)
Given request R with K r1, attempt 1 `failed`, and the user unselected K r1
When the user retries R
Then the retry is refused with E_COMBINATION_NOT_CHOSEN, no attempt 2 exists, and no protection applies

### Presentations

**AC-PRES-101: Single-block AI rewrite** (I)
Given presentation PR v3 with blocks b1..b4
When the AI rewrites b2 and the run completes
Then PR v4 exists with b2' (`ai`, the run, `derived_from_block_id` = b2, b2's references)
And b1, b3, b4 are copied with lineage, and v3 is unchanged

**AC-PRES-102: Rewrite after the user moved on** [Default OI-12] (I)
Given a rewrite of b2 based on v3 is running
When the user edits b4, creating v4, and then the run completes
Then no v5 is created, the raw response is kept, and WARN(rewrite_not_applied) is shown

**AC-PRES-103: Archived and favorite** (U)
Given presentation PR
When the user favorites it
Then the command is refused with E_ACTION_NOT_ALLOWED
When the user archives PR and then saves a new version
Then the command is refused with E_PRESENTATION_ARCHIVED

**AC-PRES-104: A block citing three revisions** (I)
Given block b1 references path P r2 (presents), tension H r1 (supports, `hypothesis`), memory test M r1 (evaluation)
When the version is saved
Then it is accepted with WARN(presentation_health) for the hypothesis support
And, if P r2 is not a finalist, a second presentation_health warning

**AC-PRES-105: Stale base version** (I)
Given PR's latest version is v5
When a user command declares base v4
Then the command is refused with E_STALE_PRESENTATION_VERSION

**AC-PRES-106: Mixed provenance in one version** (I)
Given presentation PR v1 drafted by run R1 with blocks b1, b2, b3 (all `ai` + R1)
When the user edits b1 (creating v2) and then run R2 rewrites v2's b3 (creating v3)
Then v3's blocks are: b1'' (`user`, no run), b2'' (`ai` + R1), b3'' (`ai` + R2, `derived_from_block_id` = v2's b3)
And v1 and v2 and all their blocks keep identical content hashes

### Errors

**AC-ERR-101: Fault in the projection update** (I)
Given a user_edit whose projection update fails after the revision insert
When the command runs
Then nothing is committed, job_version is unchanged, and the next accepted record takes job_version + 1

**AC-ERR-102: Recovering from a corrupted projection** (I)
Given the stored projection was altered outside the domain
When the periodic check runs
Then an incident is recorded and the projection is flagged invalid
And select commands fail with E_PROJECTION_UNAVAILABLE
When a full rebuild succeeds
Then commands are accepted again and the projection equals the fold

**AC-ERR-103: A rejected command stays rejected on replay** (I)
Given command c-7 creating a manual path based_on K r1 was refused with E_COMBINATION_NOT_CHOSEN
And the user then chose K r1
When the client re-sends c-7 with the identical payload
Then the original E_COMBINATION_NOT_CHOSEN response is returned and no path is created
When the client sends the same payload under a new id c-8
Then the path is created

**AC-ERR-104: Idempotency records are not domain state** (P)
Given a job history with accepted and rejected commands
When all idempotency records are removed and the projection is rebuilt
Then every domain record, the projection and the job history are identical to before
And `job_version` counts only domain records, never rejections

**AC-ERR-105: Same command_id in two jobs** (I)
Given job J1 has a committed record for c-1 (a rejected fact)
When the client sends c-1 in job J2 with a different payload
Then it is validated and executed in J2 on its own, with no idempotency conflict
And J1's record for c-1 is unchanged

**AC-ERR-106: Replay and conflict within one job** (I)
Given (J, c-2) was accepted and created audience A r1
When the client re-sends c-2 in J with the same payload serialized with its fields in another order
Then the stored result (A r1) is returned and nothing is written
When the client re-sends c-2 in J with a changed audience label
Then it is refused with E_COMMAND_ID_CONFLICT and the stored record is unchanged

**AC-ERR-107: Crash before commit** (I)
Given the server crashes while executing (J, c-3), before its transaction commits
When the client re-sends c-3 in J
Then the command executes as new and commits exactly once
And no idempotency record for c-3 existed between the crash and the resend

**AC-ERR-108: Atomic failure while committing** (I)
Given an accepted command (J, c-4) that writes a revision, a decision event and its idempotency record
When storage fails while writing the idempotency record
Then neither the revision, nor the event, nor the record is committed, and job version is unchanged
When the client re-sends c-4 in J
Then the command executes and commits all three together

---

## 13. Open issues

Each item states the gap, its impact on testing, and the **recommended default** used above. None of these defaults is approved policy.

### Contradictions

None currently.

### Resolved

| Former ID | Resolved by | Where |
|---|---|---|
| C-1: combination selection | R1 | §3.3; AC-DEC-012; AC-REL-044; AC-COMB-023, 024, 027 to 029; AC-GEN-020; scenarios AC-COMB-105, 107 to 110 |
| C-2: presentation provenance | R2 | AC-PRES-005, 022 to 024; scenario AC-PRES-106 |
| OI-3: secondary without an active primary | R3 | §3.3; AC-DEC-015, 016, 042 to 046; scenarios AC-DEC-104, 105, 110 to 112 |
| OI-16: user fact without evidence | R4 | AC-CONTENT-007, 028, 031 to 033; AC-EVID-007; scenarios AC-CONTENT-101, 105, 106 |
| C-3: offering `hypothesis` to a user | R5 | §3.1, §4.1; AC-CONTENT-001, 008, 028, 033 to 035; AC-EVID-008; scenarios AC-CONTENT-105, 107 to 109 |
| OI-21: user-written paths on unchosen combinations | R6 | AC-REL-043, 054 to 057; AC-GEN-027; scenarios AC-REL-105, 106 |
| OI-22: relink and selections | R7 (the opposite of the former default: relink never moves a role) | AC-DEC-024, 047, 048; scenarios AC-DEC-113 to 115 |
| Retry reading of AC-COMB-029 (confirmed) | R8 | AC-COMB-029; AC-REL-044, 057; AC-GEN-020, 027; scenarios AC-COMB-109, 111; AC-GEN-107 |
| C-4: R6 at commit time versus runs already started | R9 | AC-REL-044; AC-GEN-020, 027, 028; scenarios AC-GEN-107 to 109 |
| OI-23: `command_id` of rejected commands | R10 | §1.2, §1.3, §11 intro; AC-GLOBAL-010, 011, 029 to 031; AC-CONTENT-032, 033; AC-ERR-003, 004, 018 to 020; scenarios AC-CONTENT-110, AC-ERR-103, 104 |
| OI-24: editing a path whose combination is no longer chosen | R11 | AC-REL-043, 054, 056 to 058; AC-GEN-027; scenarios AC-REL-106, 107, AC-GEN-109 |
| C-5: a changed `based_on` target under R11 | R12 | §3.2; AC-REL-043, 054, 057 to 060; scenarios AC-REL-107, 108 |
| OI-25: runs waiting to start | R13 | AC-REL-044; AC-GEN-020, 028 to 031; scenarios AC-GEN-110 to 112 |
| OI-26: scope, content and retention of idempotency records | R14 | §1.2; AC-GLOBAL-010, 011, 025, 026, 029, 031 to 035; AC-ERR-024, 025; scenarios AC-ERR-105, 106 |
| OI-27: technical failures versus rejections | R15 | §1.2, §1.3, §11 intro; AC-GLOBAL-036, 037; AC-ERR-005, 021 to 023; scenarios AC-ERR-107, 108 |

### Gaps

| ID | Gap | Testing impact | Recommended default |
|---|---|---|---|
| OI-1 | DecisionEvent targets only ContentItem, but D10 needs presentation events. | AC-DEC-003, AC-DEC-050 to 053 | A `target_kind` (content_item, presentation) with exactly one target set. |
| OI-2 | No approved compensating action for `archived`. | AC-DEC-051 | Archive is final in the MVP. If reversal is wanted, approve an `unarchived` action. |
| OI-4 | Editing a discarded item is not specified. | AC-CONTENT-029 | Refused; restore first. |
| OI-5 | grounded_in to two revisions of one truth item. | AC-REL-031 | Refused (same rule as `combines`). |
| OI-6 | Scope of `expected_job_version`. Every run commit advances `job_version`, so user commands go stale often during generation. | AC-GLOBAL-015, AC-ERR-015 | Required on user commands. The client refreshes and resubmits. Revisit if stale conflicts become frequent (a narrower per-item version is the alternative). |
| OI-7 | Whether commands declare a policy version, and which policy validates late run outputs. | AC-ERR-008, 009, AC-GEN-025 | Commands may declare it; a mismatch is refused. Run outputs are validated under the policy active at commit. |
| OI-8 | The matrix says `claimed_fact_unverified` blocks selection until reviewed, but no review action exists. | AC-DEC-028, AC-EVID-104 | The select command carries an explicit acknowledgment of the warning, recorded on the event. No new action. |
| OI-9 | Normalization steps for `changed` drift are undefined. | AC-EVID-015 to 018, 102 | algorithm v1 = Unicode NFC, case-fold, whitespace collapsed to one space, and the typographic quotes “ ” ‘ ’ mapped to straight quotes. No fuzzy distance in the MVP. |
| OI-10 | Per-kind input and output tables are not in the matrix, and D11 needs a block-rewrite kind and a `presentation_block` input kind. | AC-GEN-003, 016 | Table below. |
| OI-11 | Retry when an input was rejected or discarded after the first attempt. (A combination that lost `chosen` is settled by R1: AC-COMB-029.) | AC-GEN-008 | Refused; the user creates a new request. |
| OI-12 | A block rewrite completing after the presentation advanced; reference handling on rewrite. | AC-PRES-014, 016, 102 | Not applied, with a warning; references carried unchanged. |
| OI-13 | Block reference role/type compatibility; new references to inactive targets. | AC-PRES-008, 009 | presents → creative_path; evaluation → tests; supports → other types. New references to inactive targets are refused. |
| OI-14 | Minimum version and block content. | AC-PRES-003, 004 | ≥1 block per version; block text non-empty. |
| OI-15 | The matrix allowed "drop *or* reclassify" for a tension missing fields. | AC-CONTENT-024 | Drop, never reclassify (a type the AI did not claim would be invented). |
| OI-17 | Run status names (`completed` here, `succeeded` in the v1.2 review) and the lease or `interrupted` rule are not confirmed. | AC-GEN-011, 022 | `completed`; leases expire into `failed / interrupted`. |
| OI-18 | A new SourceVersion with text identical to the latest. | none yet | Refused with E_NO_CHANGE. |
| OI-19 | D19 allows drift as a projection or a separate entity. | AC-EVID-014, 018 | Projection; the tests assert only observable reads, so either implementation passes. |
| OI-20 | `job_sequence` on GenerationRun and PresentationVersion is not stated in the matrix. | AC-GLOBAL-012 | Assign it to both. |
| OI-28 | R14 requires a canonical payload fingerprint but does not say whether text **inside** field values is normalized (e.g. Unicode NFC versus NFD, trailing spaces), or whether the command type is part of the comparison. | AC-GLOBAL-034, scenario AC-ERR-106 | Text values are compared exactly, with no normalization, because a whitespace change in a creative text is a real change. The command type is part of the comparison: the same id with another command type is a conflict. |
| OI-29 | R15 separates deterministic rejections from technical failures, but E_PROJECTION_UNAVAILABLE (AC-ERR-013) is a completed, fail-closed response caused by an infrastructure condition. It is unclear whether it is stored (reserving the id) or treated as a technical failure (id stays retryable). | §11 intro, AC-ERR-013, 014 | Treat it as a technical failure: store no idempotency record, so the same id can be retried after the projection is rebuilt. |

### Default request-kind table (OI-10)

| Kind | Required inputs (role: types, count) | Optional inputs | Allowed outputs | Relations written by the command |
|---|---|---|---|---|
| brief_analysis | brief: SourceVersion, 1 | human_note (role `human_note`) | business_problem, communication_problem, audience, human_truth, human_tension, central_message, restriction, open_question, brand_element, category_element | grounded_in only as AI-proposed, subject to AC-REL-013 |
| alternatives | anchor: 1 revision of any type except human_note and combination; brief: 1 | chosen strategy revisions | new items of the anchor's type | none |
| rewrite | anchor: 1 revision of any type except human_note | brief, strategy | next revision of the anchor's item | carry-forward of the anchor's edges |
| material_expansion | brief: 1 | strategy, existing materials | human_truth, brand_element, category_element, creative_mechanism | none |
| combination_suggestion | materials: ≥2 human-side or brand-side revisions | mechanisms, strategy | combination | combines (members ⊆ inputs) |
| path_generation | at least one chosen strategy revision | combination: 0..1, and the exact revision must currently be chosen (R1); restrictions; human_note | creative_path | based_on when a combination input exists |
| path_evaluation | subject: exactly 1 creative_path revision | strategy | memory_test, pr_headline | evaluates → subject |
| presentation_draft | presents: ≥1 creative_path revision | strategy, facts, tests | one PresentationVersion (new presentation or new version) | block references |
| presentation_block_rewrite | source block: exactly 1 PresentationBlock, plus its referenced revisions | user_instruction | one replacement block in a new PresentationVersion | references carried from the source block |

---

## Appendix A: Confirmed v1.4 decisions and coverage

| Decision | Summary | Covered by |
|---|---|---|
| D1 | ≥1 human-side component | AC-COMB-001, 009, 103 |
| D2 | ≥1 brand-side component | AC-COMB-002, 009, 103 |
| D3 | Mechanism 0 or 1 | AC-COMB-003 to 005, 102 |
| D4 | ≤5 components | AC-COMB-006, 007, 101 |
| D5 | AI proposes combinations; only the user selects | AC-COMB-021 to 024, 027 to 029, 105, 107 to 111 (R1, R8); AC-REL-054 to 060 (R6, R11, R12); AC-GEN-020, 027 to 031 (R9, R13) |
| D6 | Secondary requires primary | AC-DEC-015, 016, 042 to 046, 101, 104, 105, 110 to 112 (R3) |
| D7 | No finalist cap; UI recommends 3 | AC-DEC-018, 019, 109 |
| D8 | Explicit role changes; no auto-demotion | AC-DEC-013, 014, 017, 102, 103 |
| D9 | Note answers exactly one question; no loose notes | AC-REL-020 to 023, AC-CONTENT-013 |
| D10 | Presentations archive and discard; no favorite | AC-DEC-050 to 053, AC-PRES-017, 103 |
| D11 | Block rewrite gives a new version with run and source block | AC-PRES-005, 012 to 016, 022 to 024, 101, 106 (R2) |
| D12 | No `brief` authorship | AC-CONTENT-014, 102 |
| D13 | No `presentation_content` | AC-CONTENT-016, AC-PRES-021 |
| D14 | Only `schema_version` | AC-CONTENT-023, 025 |
| D15 | `relink` replaces `import` | AC-CONTENT-017, 022 |
| D16 | Approximate match records `algorithm_version` | AC-EVID-016 to 018, 102 |
| D17 | Structural identity per type | §3.2, AC-CONTENT-027, AC-COMB-016 |
| D18 | Requested versus resolved separate | AC-GLOBAL-017, AC-GEN-002, 010, 103 |
| D19 | Drift never modifies EvidenceLink | AC-EVID-013 to 019 |
| D20 | Blocks reference many exact revisions | AC-PRES-006, 007, 104 |
| D21 | Discard does not undo other state | AC-DEC-037 to 042, 108 |
| D22 | Immutability | AC-GLOBAL-001, 002, AC-PRES-002 |
| D23 | Exact revision references | AC-GLOBAL-007 to 009, §5 |
| D24 | AI and human distinguishable and traceable | AC-GLOBAL-018, 019, AC-GEN-017, 019 |
| D25 | Fact validated in the same transaction, else weaker | AC-CONTENT-002, 007, 028, 031 to 035, 105 to 108, AC-EVID-004 to 008 (R4, R5) |

---

## Appendix B: Decisions from revisions 2 to 5

| ID | Decision | Resolves |
|---|---|---|
| R1 | Combinations support `chosen`, with no cap. Only the user assigns or removes it. The exact combination revision must currently be chosen before it is used as a path generation input. AI output alone never assigns `chosen`. | C-1 |
| R2 | Provenance is per PresentationBlock: `authorship`, optional `produced_by_run_id`, and the exact source block on rewrite. One version may mix authors and runs. A rewrite creates a new immutable version and never mutates the previous one. | C-2 |
| R3 | Validate the final state of the whole command. The final state never holds a secondary audience or tension without an active, non-discarded primary of the same type. A command may emit several explicit events; no automatic role change. A discarded primary never supports secondaries. | OI-3 |
| R4 | A human command saving an `extracted_fact` without validated evidence in the same transaction is rejected. The system may offer alternatives explicitly but never reclassifies silently. A rejected command creates no revision, link, event or partial state. | OI-16 (introduces C-3) |
| R5 | Users may author `hypothesis` on all eight descriptive types, with no evidence required (optional links must validate). The matrix becomes 57 allowed and 71 forbidden. After a rejected user fact, the system may offer `hypothesis` or `human_text`; the user must choose explicitly and submit a new command. Silent reclassification stays forbidden. | C-3 |
| R6 | Every creative_path revision with `based_on` must reference an exact combination revision that holds `chosen`, for AI and user paths alike, validated in the transaction that creates the revision and relation. Paths without a combination stay valid. A rejected command leaves no partial revision or relation. | OI-21 (its C-4 and OI-24 are resolved by R9 and R11) |
| R7 | A `relink` revision never inherits or receives a role implicitly. Transferring a role requires explicit events in the same transaction, whose final state must satisfy every selection invariant. | OI-22 |
| R8 | Every retry of path generation re-checks that the exact combination revision holds `chosen`; otherwise the retry is rejected with no run and no partial state. `chosen` on a newer revision does not count. If `chosen` is lost after a run started, the run may complete and its outputs stay valid and traceable. | Confirms AC-COMB-029 |
| R9 | For AI paths, the exact combination revision must be chosen when the request is created and when each retry is requested. Once a run has started, losing `chosen` never prevents its results from being saved; they stay valid and traceable, and `chosen` is not re-validated at commit. This is the specific exception to R6 for AI paths. | C-4 (its OI-25 is resolved by R13) |
| R10 | A rejected command creates or modifies no domain state, but its `command_id` is recorded with the rejection for idempotency. Same id and payload returns the same rejection without re-executing; same id with another payload is an idempotency conflict. Resubmitting under another claim type needs a new `command_id`. | OI-23 (its OI-26 and OI-27 are resolved by R14 and R15) |
| R11 | A path edit that keeps exactly the same `based_on` target does not need the combination to be chosen, and infers no role. `chosen` is required when `based_on` is created for the first time, when the target changes, and when a new request or a retry uses the combination directly. (R12 settles that a target change inside one path is an identity violation, so it is always refused.) | OI-24 (its C-5 is resolved by R12) |
| R12 | A creative_path never changes its exact `based_on` target between revisions. A different combination revision (even of the same combination item) needs a new path, whose initial target must be chosen. Such a change is an identity violation, rejected before selection validation. Edits keeping the exact target need no `chosen`. | C-5 |
| R13 | Protection against losing `chosen` starts when a run is validly created, including while queued, scheduled, leased or waiting. `chosen` is never revalidated at worker start, lease acquisition or renewal, resume, or commit. A request or retry rejected before run creation gets no protection and creates no run. | OI-25 |
| R14 | Idempotency is scoped by (`job_id`, `command_id`). A record holds job, command id, actor, command type, a canonical payload fingerprint under stable, versioned rules, the deterministic result, and timestamps. It is technical state following its job's retention and purge policy, with no sequence, version change, history event or replay role. Same id and canonical payload returns the stored result; a different canonical payload is a conflict. | OI-26 (introduces OI-28) |
| R15 | A technical failure without a committed record is not a stored rejection, and its (`job_id`, `command_id`) stays retryable. A completed result, its idempotency record and any domain changes are committed atomically, never one without the others. Only deterministic outcomes are stored for replay. | OI-27 (introduces OI-29) |
