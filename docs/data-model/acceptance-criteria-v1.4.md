# Acceptance Criteria: Data Model v1.4

Primary reference: `docs/data-model/content-relation-matrix-v1.3.md` (approved), as amended by the 25 confirmed v1.4 decisions (listed in Appendix A, referenced as **D1** to **D25**).

This package is self-contained: every rule needed to derive a test is stated here. Where the approved material does not settle a rule, the criterion is marked **[Default OI-n]** and the gap is described in §13. Defaults are recommendations, not approved policy. Tests built on them must be tagged so they can be changed when the product owner decides.

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
| **policy_version** | Version of the policy configuration active when a record or event was accepted. |

### 1.3 Standard outcomes

These names are used in the criteria below so each one does not have to repeat them.

| Outcome | Observable meaning |
|---|---|
| **REJECT(code)** | The command fails with error `code`. Zero domain records are committed, `job_version` is unchanged, and the projection is unchanged. |
| **DROP** | (AI output only) The output element is not persisted as content. The raw response stays on the run, and the run's validation report lists the element with a reason. |
| **DOWNGRADE** | (AI output only) The element is persisted with the weaker assertion for its type (§4.3), plus the warning `claimed_fact_unverified`. |
| **WARN(kind)** | The command succeeds and the projection shows a warning of `kind`. No event is written. |

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
| AC-GLOBAL-010 | Re-submitting a command with the same `command_id` and an identical payload returns the original result and writes nothing. | Command C was accepted | The second response equals the first (same record IDs, same `job_sequence` range); `job_version` is unchanged. | n/a | APP | I |
| AC-GLOBAL-011 | Re-using a `command_id` with a different payload is refused. | Command C was accepted | The new payload is refused. | REJECT(E_COMMAND_ID_CONFLICT) | APP | I |
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
| AC-GLOBAL-025 | After a full job erasure, no payload, source text, rendered input or raw AI response of that job can be retrieved through any interface or blob store. | Admin erasure of job J | Every retrieval returns not-found. | n/a | APP | E |
| AC-GLOBAL-026 | After anonymization (text scrubbed, structure kept), rebuilding the projection gives identical selection, rejection, favorite and discard state. | Anonymized job | The rebuilt projection's text-independent fields equal those before anonymization. | n/a | PROJ | I |
| AC-GLOBAL-027 | Deleting the whole projection and rebuilding it from the log reproduces it exactly. | Any history | The rebuilt projection equals the stored one field by field. | See AC-ERR-013 | PROJ | P |
| AC-GLOBAL-028 | Every ContentRevision, DecisionEvent, GenerationRequest and PresentationVersion records the `policy_version` active when it was accepted. | none | The field is non-null and equals the active version at commit. | Insert without it fails | DB | U |

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
| business_problem | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `statement` (non-empty) |
| communication_problem | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `statement` |
| audience | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `label`, `description` |
| human_truth | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `statement` |
| human_tension | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `statement`, `desire`, `reality` (all non-empty) |
| restriction | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `statement`, `kind` ∈ {mandatory, prohibited} |
| brand_element | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `name`, `description` |
| category_element | descriptive | ai, user | extracted_fact, hypothesis | human_text, extracted_fact | by assertion | `name`, `description` |
| central_message | prescriptive | ai, user | extracted_fact, suggestion | human_text, extracted_fact | fact: required; suggestion: forbidden | `statement` |
| open_question | prescriptive | ai, user | suggestion | human_text | suggestion: optional; human_text: forbidden | `question` |
| creative_mechanism | creative | ai, user | suggestion | human_text | forbidden | `name`, `description` |
| combination | creative | ai, user | suggestion | human_text | forbidden | none (optional `label`, `rationale`) plus a valid `combines` set |
| creative_path | creative | ai, user | suggestion | human_text | forbidden | `title`, `idea` |
| memory_test | creative | ai, user | suggestion | human_text | forbidden | `retelling`, `verdict` ∈ {pass, weak, fail} |
| pr_headline | creative | ai, user | suggestion | human_text | forbidden | `headline` (optional `verdict`, `rationale`) |
| human_note | human only | user | none | human_text | forbidden | `text` |

A user `extracted_fact` requires a validated EvidenceLink created by the same command (the "highlight in the brief" action).

### 3.2 Identity and revision rules [D12, D13, D17]

| content_type | Identity (what the item *is*) | New revision when | New item required when | Machine-checked part |
|---|---|---|---|---|
| business_problem, communication_problem, audience, human_truth, central_message, restriction, open_question, brand_element, category_element, creative_mechanism | The proposition or thing | The user chooses **Edit** (`user_edit`) or requests `rewrite` (`ai_rewrite`) | The user chooses **New / Alternative**, or requests `alternatives` | Only the command path: Edit always gives the same item, New always a new one (AC-CONTENT-026) |
| human_tension | The pair (desire, reality) | Edit, rewrite, or `relink` of `grounded_in` | Different desire or reality: user chooses New | Command path; `relink` requires an identical payload |
| human_note | "My answer to question Q" (the item of its `answers` target) | Edit of the text (including a changed answer), or `relink` to a newer revision of Q | It answers a different question | `answers` target item constant across revisions |
| combination | Its **set of member items** | Label or rationale edit (`user_edit`); re-pin a member to a newer revision of the same item, or reorder (`relink`) | Any member item added, removed or replaced | Member item set constant across revisions |
| creative_path | The idea, and the exact combination revision it was built on (if any) | Edit or rewrite of the text | Different idea, or a different `based_on` target | `based_on` target revision constant across revisions |
| memory_test, pr_headline | "This test of **this exact** path revision" | Edit or rewrite of the test text or verdict | A different path revision is to be tested | `evaluates` target revision constant across revisions |

### 3.3 Relations and decisions per type

| content_type | Outgoing relations (from) | Incoming relations (to) | Block reference roles | Selection roles | Reject | Favorite | Discard |
|---|---|---|---|---|---|---|---|
| business_problem | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| communication_problem | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| audience | none | none | supports | primary, max 1 per job; secondary, N (requires primary) | yes | yes | yes |
| human_truth | none | grounded_in, combines | supports | chosen, N | yes | yes | yes |
| human_tension | grounded_in (0..5) | combines | supports | primary, max 1 per job; secondary, N (requires primary) | yes | yes | yes |
| central_message | none | none | supports | chosen, max 1 per job | yes | yes | yes |
| restriction | none | none | supports | chosen, N | yes | **no** | yes |
| open_question | none | answers | supports | chosen, N | yes | **no** | yes |
| human_note | answers (exactly 1) | none | supports | **none** | **no** | **no** | yes |
| brand_element | none | combines | supports | **none** | yes | yes | yes |
| category_element | none | combines | supports | **none** | yes | yes | yes |
| creative_mechanism | none | combines | supports | **none** | yes | yes | yes |
| combination | combines (2..5, composition rule) | based_on | none | chosen, N **[Default C-1]** | yes | yes | yes |
| creative_path | based_on (0..1) | evaluates | presents | finalist, N, no cap [D7] | yes | yes | yes |
| memory_test | evaluates (exactly 1) | none | evaluation | chosen, max 1 per evaluated path revision | yes | **no** | yes |
| pr_headline | evaluates (exactly 1) | none | evaluation | chosen, max 1 per evaluated path revision | yes | yes | yes |

Block reference roles are **[Default OI-13]**.

**Presentations** (not content types): the only allowed actions are `archived`, `discarded` and `restored` [D10]. Favorite and every selection or rejection action are forbidden.

---

## 4. Type, authorship, and assertion criteria

### 4.1 Oracle

The full space is 16 types × 2 authorships × 4 assertions = **128 triples**. Exactly **49** are allowed:
1. descriptive: 8 types × 4 pairs = 32;
2. central_message: 4;
3. open_question: 2;
4. creative: 5 types × 2 pairs = 10;
5. human_note: 1.

The other **79** are forbidden. Tests should enumerate all 128.

### 4.2 Criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-CONTENT-001 | Exactly the 49 allowed triples of §3.1 are accepted; all 79 others fail. | Enumerate all 128 triples, with valid payload and evidence where required | 49 accepted; 79 fail with the outcome given by 002 to 016. | as below | APP (+DB for 012) | P |
| AC-CONTENT-002 | A descriptive `ai` + `extracted_fact` is accepted only with ≥1 validated EvidenceLink committed in the same transaction. [D25] | AI output with a valid quote | Revision stored as `extracted_fact` with ≥1 link. | Invalid or missing quote: DOWNGRADE to `hypothesis` | APP+DB | I |
| AC-CONTENT-003 | A descriptive `ai` + `hypothesis` is accepted with 0..N validated links. | AI output | Stored as `hypothesis`. | An invalid link is dropped; the item is kept (AC-EVID-008) | APP | U |
| AC-CONTENT-004 | A descriptive `ai` + `suggestion` is not allowed. | AI output | none | DROP | APP | U |
| AC-CONTENT-005 | `ai` + `human_text` is never allowed, for any type. | AI output | none | DROP (DB check rejects any bypass) | DB+APP | U |
| AC-CONTENT-006 | A descriptive `user` + `human_text` is accepted without evidence. | User command | Stored. | Command includes evidence: REJECT(E_EVIDENCE_FORBIDDEN) | APP | U |
| AC-CONTENT-007 | A descriptive `user` + `extracted_fact` is accepted only with a validated EvidenceLink in the same command. **[Default OI-16]**: a user command is refused, not downgraded. | User highlights brief text | Stored as `extracted_fact` with its link. | Missing link: REJECT(E_EVIDENCE_REQUIRED); invalid link: REJECT(E_EVIDENCE_INVALID) | APP | I |
| AC-CONTENT-008 | `user` + `hypothesis` and `user` + `suggestion` are never allowed. | User command | none | REJECT(E_ASSERTION_NOT_ALLOWED) | DB+APP | U |
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
| AC-CONTENT-028 | Editing an `extracted_fact` produces `human_text` (user) unless validated evidence is attached in the same command. An `ai_rewrite` of a fact is a fact only with newly validated evidence. EvidenceLinks are never copied automatically. | A fact revision r1 | The new revision's assertion and links follow the rule; r1's links are unchanged. | AI without evidence: DOWNGRADE | APP | I |
| AC-CONTENT-029 | `user_edit`, `relink` and `ai_rewrite` on a discarded item are refused. **[Default OI-4]** | Item discarded | none | REJECT(E_ITEM_DISCARDED) | APP | I |
| AC-CONTENT-030 | Every AI-produced revision has `authorship = ai`, `produced_by_run_id` set, and `change_type` of `initial` (new item) or `ai_rewrite`. | Run commit | Fields as stated. | n/a | DB+APP | I |

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
| AC-REL-043 | **based_on**: no re-pin. A new path revision keeps the same target, and `relink` is not valid for creative_path. | Path r1 based_on C r1; C r2 exists | Edit gives path r2 with based_on C r1. | Changing the target: REJECT(E_REPIN_NOT_ALLOWED) | APP | U |
| AC-REL-044 | **based_on**: the target combination has an active `chosen` selection when the edge is first created. **[Default C-1]** | Combination not chosen | none | REJECT(E_COMBINATION_NOT_CHOSEN) | APP | I |
| AC-REL-050 | **evaluates**: every memory_test and pr_headline revision has exactly one edge, to a creative_path revision. | none | Accepted. | 0 or 2: REJECT(E_CARDINALITY) | APP | U |
| AC-REL-051 | **evaluates**: for AI tests from `path_evaluation`, the command writes the edge to the request's single `subject` revision. | Subject path P r2 | Every test from the run evaluates P r2. | n/a | APP | I |
| AC-REL-052 | **evaluates**: no re-pin. Testing a newer path revision requires a new test item. | Test on P r1; P r2 exists | Edit gives test r2 still evaluating P r1. | Changing the target: REJECT(E_REPIN_NOT_ALLOWED) | APP | U |
| AC-REL-053 | **evaluates**: a new test may not target a rejected path revision or a discarded path. | none | none | REJECT(E_TARGET_INACTIVE) | APP | U |

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
| AC-COMB-023 | Only the user may select a combination, with role `chosen`. **[Default C-1]** | User command | DecisionEvent with `actor_user_id` = owner. | Any other actor: REJECT(E_FORBIDDEN) | APP | I |
| AC-COMB-024 | A combination used as a `path_generation` input must have an active `chosen` selection when the request is created. **[Default C-1]** | Combination not chosen | none | REJECT(E_COMBINATION_NOT_CHOSEN) | APP | I |
| AC-COMB-025 | Combination revisions carry no EvidenceLinks. | none | none | REJECT(E_EVIDENCE_FORBIDDEN) / AI: link dropped | APP | U |
| AC-COMB-026 | A payload with no fields is valid; `label` and `rationale` are optional strings. | none | `{}` accepted. | n/a | APP | U |

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
| AC-DEC-012 | **chosen, uncapped:** human_truth, restriction, open_question and combination (**[Default C-1]**) allow any number of `chosen`. | none | 3 chosen accepted. | n/a | APP | U |
| AC-DEC-013 | **primary:** audience and human_tension allow at most one active `primary` per job per type. [D4] | Primary A active | [unselected(A, primary), selected(B, primary)] is accepted. | selected(B, primary) alone: REJECT(E_SLOT_OCCUPIED) | DB (projection index) + APP | I |
| AC-DEC-014 | **No automatic demotion:** after a new primary is selected, the previous primary holds no selection unless the same command explicitly wrote `selected(A, secondary)`. [D8] | As 013 | A holds no selection. | n/a | APP+PROJ | I |
| AC-DEC-015 | **secondary requires primary:** `selected(X, secondary)` requires an active `primary` of the same type at the end of the command, on a non-discarded item. [D6] **[Default OI-3]** for the discarded part. | No primary audience | none | REJECT(E_PRIMARY_REQUIRED) | APP | I |
| AC-DEC-016 | **Removing the primary:** a command whose end state has active secondaries but no active primary of that type is refused. **[Default OI-3]** | Primary A with secondary B | [unselected(A)] alone fails; [unselected(B, secondary), unselected(A, primary)] succeeds. | REJECT(E_PRIMARY_REQUIRED) | APP | I |
| AC-DEC-017 | **Role change on one item** is written explicitly as unselected(old role) + selected(new role) in the same command. [D8] | B is secondary | Promoting B writes both events. | selected(B, primary) without unselected(B, secondary): REJECT(E_ITEM_ALREADY_SELECTED) | APP | U |
| AC-DEC-018 | **finalist:** only creative_path; any number per job, with no cap. [D7] | 3 finalists | A 4th finalist is accepted. | Non-path: REJECT(E_ROLE_NOT_ALLOWED) | APP | U |
| AC-DEC-019 | The "recommend up to three finalists" guidance is UI only and never causes a rejection. [D7] | 10 finalists | Accepted. | n/a | POL | E |
| AC-DEC-020 | **Test chosen:** at most one active `chosen` memory_test, and one pr_headline, per evaluated path revision. The scope key is the `evaluates` target. | Chosen test T1 on P r1 | Chosen T2 on P r2 is accepted; chosen T3 on P r1 needs unselected(T1) first. | REJECT(E_SLOT_OCCUPIED) | DB (projection index) + APP | I |
| AC-DEC-021 | A rejected revision cannot be selected. | r1 rejected | none | REJECT(E_REVISION_REJECTED) | APP | U |
| AC-DEC-022 | A revision of a discarded item cannot be selected. | Item discarded | none | REJECT(E_ITEM_DISCARDED) | APP | U |
| AC-DEC-023 | No-op events are refused: selecting an already active (revision, role), or unselecting a (revision, role) that is not active. | none | none | REJECT(E_NO_OP) | APP | U |
| AC-DEC-024 | **Selection moves on edit** [D10 of v1.3]: a `user_edit` whose source is the actively selected revision writes, in one command, rN+1, unselected(rN, role) and selected(rN+1, same role), with consecutive `job_sequence`. The earlier events stay in history. | rN selected as primary | Three records; rN+1 is primary. | n/a | APP | I |
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
| AC-DEC-042 | A selected but discarded item still counts toward role caps until it is explicitly unselected. It is excluded from effective selection and flagged. | Primary A discarded | A new primary needs unselected(A) first. | WARN(selected_but_discarded) | APP+PROJ | I |

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
| AC-EVID-007 | A user fact with an invalid or missing link is refused, not downgraded. **[Default OI-16]** | none | none | REJECT(E_EVIDENCE_INVALID / E_EVIDENCE_REQUIRED) | APP | U |
| AC-EVID-008 | A hypothesis may carry 0..N links; each must satisfy AC-EVID-001. An invalid AI link is dropped and the hypothesis is kept. | none | Valid links stored. | Invalid link: not stored; reported | APP | U |
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
| AC-GEN-008 | A retry is refused if any RunInput would now be refused as a new input (e.g. its item was discarded). **[Default OI-11]** | Input item discarded after attempt 1 | none | REJECT(E_TARGET_INACTIVE) | APP | I |
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
| AC-GEN-020 | Run outputs are committed even if their inputs were rejected, discarded or superseded while the run was executing. The outputs are flagged. | Input discarded during the run | Outputs stored. | WARN(target_inactive) | APP+PROJ | I |
| AC-GEN-021 | The user can cancel a pending or running run. A response arriving later is stored raw and creates no content. | none | Status `canceled`. | Cancel on a terminal run: REJECT(E_NO_OP) | APP | I |
| AC-GEN-022 | A run left in `running` beyond its lease is set to `failed` with `error_code = interrupted`. **[Default OI-17]** | Lease expired | Status failed. | n/a | APP | I |
| AC-GEN-023 | `rewrite` has exactly one anchor; its output is the next revision of the anchor's item, with `change_type = ai_rewrite` and source = anchor. | none | As stated. | Output for another item: DROP | APP | I |
| AC-GEN-024 | `alternatives` produces new items of the anchor's type, with `change_type = initial`, and no relation to the anchor. Lineage is the RunInput `anchor`. | none | New items. | Different type: DROP | APP | I |
| AC-GEN-025 | Outputs are validated against the policy active at commit time, and record that `policy_version`. **[Default OI-7]** | Policy changed during the run | Invalid elements under the new policy are dropped. | DROP | APP | I |
| AC-GEN-026 | `instruction_version_id` references an immutable InstructionVersion. | none | none | Missing: REJECT(E_REFERENCE_NOT_FOUND) | DB | U |

---

## 10. Presentation criteria

| ID | Rule | Preconditions | Expected result | Failure result | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-PRES-001 | A job can have any number of presentations; each belongs to exactly one job. [D8 of v1.3] | none | Two presentations in one job are accepted. | n/a | DB | U |
| AC-PRES-002 | `version_number` is unique and contiguous from 1 per presentation; versions are immutable. [D22] | none | 1..n | Update fails | DB | P |
| AC-PRES-003 | A version has ≥1 block **[Default OI-14]**; block `position` is unique and contiguous from 1; reads return blocks in ascending position. | none | Stable order on every read. | REJECT(E_POSITION / E_EMPTY_VERSION) | DB+APP | U |
| AC-PRES-004 | Block structure is free: no required block kinds and no required count beyond 1. `text` is non-empty after trimming. **[Default OI-14]** | none | Any sequence of text blocks is accepted. | Empty text: REJECT(E_SCHEMA) | APP | U |
| AC-PRES-005 | Each block records `authorship` and `produced_by_run_id` at **block** level (AC-GLOBAL-019). **[Default C-2]** | none | Fields per block. | n/a | DB | U |
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

---

## 11. Error and concurrency criteria

Columns: **Whole command rejected?** / **Raw diagnostics retained?** / **Domain records committed?**

| ID | Failure | Preconditions | Expected result | Rejected / Diagnostics / Records | Enf. | Level |
|---|---|---|---|---|---|---|
| AC-ERR-001 | Stale `expected_job_version` | job_version 40; command expects 39 | E_STALE_JOB_VERSION; the response includes 40. | Yes / error log only / **none** | APP | I |
| AC-ERR-002 | Two commands from two tabs with the same `expected_job_version` | Both expect 40 | Exactly one is accepted; the other gets E_STALE_JOB_VERSION. | Loser: Yes / log / none | APP | I |
| AC-ERR-003 | Duplicate `command_id`, identical payload (e.g. a retry after a network drop) | Command accepted earlier | The original response is returned. | No / n/a / **none new** | APP | I |
| AC-ERR-004 | Duplicate `command_id`, different payload | none | E_COMMAND_ID_CONFLICT. | Yes / log / none | APP | I |
| AC-ERR-005 | Partial transaction failure (any write in the command fails, including the projection update) | Fault injected after the first event insert | Full rollback; job_version and projection unchanged; the next accepted record takes the next sequence with no gap. | Yes / error log / **none** | DB | I |
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
When the user edits the description without attaching evidence
Then A r2 is `user` + `human_text` + `user_edit` with no EvidenceLink
And unselected(r1, primary) and selected(r2, primary) are written in the same command
And A r1 and its EvidenceLink are unchanged

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
When the user writes selected(K r1, chosen)
Then the event has `actor_user_id` = owner

**AC-COMB-106: Relink versus replacing a member** (U)
Given K r1 = {T r1, B r1} and T r2 exists
When the user relinks K to {T r2, B r1}
Then K r2 is accepted with `change_type = relink`
When the user tries {T2 r1, B r1}, where T2 is another truth item
Then the command is refused with E_IDENTITY_CHANGE

**AC-COMB-107: Unchosen combination as input** [Default C-1] (I)
Given combination K with no active `chosen` selection
When the user creates a path_generation request with K
Then the command is refused with E_COMBINATION_NOT_CHOSEN

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

**AC-DEC-104: Removing the primary under secondaries** [Default OI-3] (U)
Given A is primary and B is secondary
When the user unselects A only
Then the command is refused with E_PRIMARY_REQUIRED

**AC-DEC-105: A discarded primary cannot anchor a new secondary** [Default OI-3] (I)
Given primary tension H1 is discarded (still selected, D21)
When the user selects H2 as secondary
Then the command is refused with E_PRIMARY_REQUIRED
And the projection shows WARN(selected_but_discarded) on H1

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

---

## 13. Open issues

Each item states the gap, its impact on testing, and the **recommended default** used above. None of these defaults is approved policy.

### Contradictions

**C-1: Combination selection.**
1. **Gap.** D5 says "only the user may select" combinations, but the approved matrix (§2.1, §3) gives combination **no** selection role. Taken literally, D5 has nothing to act on.
2. **Default.** Combination supports `chosen` (uncapped, user only). A combination must be chosen before it is used as a `path_generation` input (AC-COMB-024) or as the target of a new `based_on` (AC-REL-044).
3. **Testing impact.** AC-COMB-023, AC-COMB-024, AC-REL-044, AC-DEC-012 and AC-COMB-107 depend on it.
4. **Alternative.** D5 only means "the AI never auto-selects", and combinations stay without selection. The tests above are then deleted and AC-COMB-022 stands alone.

**C-2: Where AI provenance lives in presentations.**
1. **Gap.** The matrix put `produced_by_run_id` on PresentationVersion. D11 (single-block rewrite) produces versions that mix blocks from different runs and authors, so version-level provenance cannot say which block came from which run.
2. **Default.** `authorship` and `produced_by_run_id` live on PresentationBlock (AC-PRES-005). A version-level run field is optional and informational only.
3. **Testing impact.** AC-PRES-005, AC-PRES-012, AC-PRES-013 and AC-GLOBAL-019.

### Gaps

| ID | Gap | Testing impact | Recommended default |
|---|---|---|---|
| OI-1 | DecisionEvent targets only ContentItem, but D10 needs presentation events. | AC-DEC-003, AC-DEC-050 to 053 | A `target_kind` (content_item, presentation) with exactly one target set. |
| OI-2 | No approved compensating action for `archived`. | AC-DEC-051 | Archive is final in the MVP. If reversal is wanted, approve an `unarchived` action. |
| OI-3 | D6 covers *selecting* a secondary, not *losing* the primary, nor a discarded primary. | AC-DEC-015, 016, 104, 105 | End-of-command check: secondaries require an active, non-discarded primary of the same type. Removing the last primary under secondaries is refused. |
| OI-4 | Editing a discarded item is not specified. | AC-CONTENT-029 | Refused; restore first. |
| OI-5 | grounded_in to two revisions of one truth item. | AC-REL-031 | Refused (same rule as `combines`). |
| OI-6 | Scope of `expected_job_version`. Every run commit advances `job_version`, so user commands go stale often during generation. | AC-GLOBAL-015, AC-ERR-015 | Required on user commands. The client refreshes and resubmits. Revisit if stale conflicts become frequent (a narrower per-item version is the alternative). |
| OI-7 | Whether commands declare a policy version, and which policy validates late run outputs. | AC-ERR-008, 009, AC-GEN-025 | Commands may declare it; a mismatch is refused. Run outputs are validated under the policy active at commit. |
| OI-8 | The matrix says `claimed_fact_unverified` blocks selection until reviewed, but no review action exists. | AC-DEC-028, AC-EVID-104 | The select command carries an explicit acknowledgment of the warning, recorded on the event. No new action. |
| OI-9 | Normalization steps for `changed` drift are undefined. | AC-EVID-015 to 018, 102 | algorithm v1 = Unicode NFC, case-fold, whitespace collapsed to one space, and the typographic quotes “ ” ‘ ’ mapped to straight quotes. No fuzzy distance in the MVP. |
| OI-10 | Per-kind input and output tables are not in the matrix, and D11 needs a block-rewrite kind and a `presentation_block` input kind. | AC-GEN-003, 016 | Table below. |
| OI-11 | Retry when an input became inactive after the first attempt. | AC-GEN-008 | Refused; the user creates a new request. |
| OI-12 | A block rewrite completing after the presentation advanced; reference handling on rewrite. | AC-PRES-014, 016, 102 | Not applied, with a warning; references carried unchanged. |
| OI-13 | Block reference role/type compatibility; new references to inactive targets. | AC-PRES-008, 009 | presents → creative_path; evaluation → tests; supports → other types. New references to inactive targets are refused. |
| OI-14 | Minimum version and block content. | AC-PRES-003, 004 | ≥1 block per version; block text non-empty. |
| OI-15 | The matrix allowed "drop *or* reclassify" for a tension missing fields. | AC-CONTENT-024 | Drop, never reclassify (a type the AI did not claim would be invented). |
| OI-16 | D25 says a fact without evidence "must be stored as a weaker claim type"; it is unclear whether that also applies to user commands. | AC-CONTENT-007, AC-EVID-007 | AI output: downgrade. User command: reject, so the system never relabels the user's explicit claim. Both satisfy D25, since no unverified fact is ever stored. |
| OI-17 | Run status names (`completed` here, `succeeded` in the v1.2 review) and the lease or `interrupted` rule are not confirmed. | AC-GEN-011, 022 | `completed`; leases expire into `failed / interrupted`. |
| OI-18 | A new SourceVersion with text identical to the latest. | none yet | Refused with E_NO_CHANGE. |
| OI-19 | D19 allows drift as a projection or a separate entity. | AC-EVID-014, 018 | Projection; the tests assert only observable reads, so either implementation passes. |
| OI-20 | `job_sequence` on GenerationRun and PresentationVersion is not stated in the matrix. | AC-GLOBAL-012 | Assign it to both. |

### Default request-kind table (OI-10)

| Kind | Required inputs (role: types, count) | Optional inputs | Allowed outputs | Relations written by the command |
|---|---|---|---|---|
| brief_analysis | brief: SourceVersion, 1 | human_note (role `human_note`) | business_problem, communication_problem, audience, human_truth, human_tension, central_message, restriction, open_question, brand_element, category_element | grounded_in only as AI-proposed, subject to AC-REL-013 |
| alternatives | anchor: 1 revision of any type except human_note and combination; brief: 1 | chosen strategy revisions | new items of the anchor's type | none |
| rewrite | anchor: 1 revision of any type except human_note | brief, strategy | next revision of the anchor's item | carry-forward of the anchor's edges |
| material_expansion | brief: 1 | strategy, existing materials | human_truth, brand_element, category_element, creative_mechanism | none |
| combination_suggestion | materials: ≥2 human-side or brand-side revisions | mechanisms, strategy | combination | combines (members ⊆ inputs) |
| path_generation | at least one chosen strategy revision | combination: 0..1 (chosen, C-1); restrictions; human_note | creative_path | based_on when a combination input exists |
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
| D5 | AI proposes combinations; only the user selects | AC-COMB-021 to 024, 105; C-1 |
| D6 | Secondary requires primary | AC-DEC-015, 016, 101, 104 |
| D7 | No finalist cap; UI recommends 3 | AC-DEC-018, 019, 109 |
| D8 | Explicit role changes; no auto-demotion | AC-DEC-013, 014, 017, 102, 103 |
| D9 | Note answers exactly one question; no loose notes | AC-REL-020 to 023, AC-CONTENT-013 |
| D10 | Presentations archive and discard; no favorite | AC-DEC-050 to 053, AC-PRES-017, 103 |
| D11 | Block rewrite gives a new version with run and source block | AC-PRES-012 to 016, 101; C-2 |
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
| D25 | Fact validated in the same transaction, else weaker | AC-CONTENT-002, 007, AC-EVID-004 to 007 |
