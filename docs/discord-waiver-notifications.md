# Discord waiver summaries and contact cards

Implemented on the feature branch; not deployed or enabled through production changes.
The API remains plain JavaScript. No schema, public payload, admin endpoint, RLS,
storage bucket, scheduler, or unrelated webhook transport changes are required.

## Operator experience

After successful waiver and audit persistence, `submitWaiver.js` schedules:

1. **New Waiver Submitted**: mobile-friendly Student, Parent / Guardian (when
   explicitly identified), Emergency Contact (otherwise), and Medical & Injury
   Information sections. Only supplied phone/email/relationship values appear.
2. **Contacts Ready — <student name>**: individually labeled `.vcf` attachments.

Discord does not display submission time, waiver ID, admin reference, or an embed
timestamp. Those values remain in the existing database, operational logs,
authenticated admin contracts, and the unchanged Slack waiver summary. The full
signed waiver remains authoritative.

The footer directs authorized staff to open the existing waiver viewer or admin
waiver list, find the named student, and review the signed waiver. It is deliberately
not a public medical-record URL. The authenticated review paths remain
`GET /api/viewer/waiver-documents` (Cloudflare Access + email allowlist),
`GET /api/admin/waivers` and `GET /api/admin/waivers/:id` (staff/admin key), and
`GET /api/waivers/:id/pdf` (admin key). Existing admin detail returns signed asset
URLs; it is not being replaced with a new medical endpoint.

## Actual data mappings and limits

Read-only schema inspection on 2026-10-08 confirmed the relevant participant,
waiver, emergency-contact, and medical-history column names match the migrations.
No production rows were read or changed for this feature.

| Source in existing submit contract | Notification / vCard behavior |
| --- | --- |
| `participant.full_name` | Student identity, FN and N; name-only card is useful for later contact editing and is generated |
| `participant.phone` | Student phone only; existing persistence maps it to `participants.cell_phone` |
| `participant.email` | Student email only |
| `emergency_contact.name` | Separate named contact; no card when no name is supplied |
| `emergency_contact.relationship` | Preserved relationship; explicitly recognized guardian relationships receive Guardian role, other relationships remain Emergency Contact |
| `emergency_contact.phone`, `.email` | This contact's phone/email only; never substituted into student fields |

Recognized guardian labels (case-insensitive, trimmed): parent, mother, father,
mom, dad, guardian, legal guardian, madre, padre, tutor, tutora. A friend, sibling,
grandparent, or unspecified relationship is not automatically declared a legal
guardian. This identifies the submitted relationship; it does not verify legal
responsibility. Date of birth is not sent to Discord or contact files.

The current public endpoint requires student email and phone and supports **one**
`emergency_contact`. The database has a unique index on `emergency_contacts.waiver_id`.
There is no guardian identity column, guardian array, or phone-ownership flag.
A participant contact value submitted by a household is used as labeled by the
existing contract; the API cannot establish whether it belongs to the child.
Neither minor age nor emergency-contact presence triggers a contact fallback.

The internal formatter/generator accepts a list of existing emergency-contact-shaped
records and has multiple-contact tests; the submit path passes zero or one
successfully persisted contact. Multiple-guardian *submission* remains blocked by
the existing schema/contract and needs a coordinated future frontend/API migration.
It is not enabled by this feature. Account-member `guardian` roles are billing
relationships, not additional waiver contacts, and are not queried or inferred.

Identical name + phone + email contacts are deduplicated case-insensitively for
name/email. Shared phone/email with different names does not merge people.
Same-name records with different details remain separate, with numeric filename
suffixes. Without reliable person IDs, more aggressive merging would risk losing
contacts. All named student contacts are kept even without phone/email.

## Medical privacy decision and field mapping

The repository's liability/media consent text does not establish permission to
publish medical disclosures to Discord. Channel membership, staff-only permissions,
retention, and privacy disclosure acceptance could not be confirmed from this
repository. Therefore **no diagnoses, injury details, restrictions, clearance notes,
or full medical histories are posted**, and there is no environment switch that
bypasses this decision. Existing contact notification delivery is retained and the
requested contact attachments use that same operational destination.

| Submitted medical field | Safe summary mapping |
| --- | --- |
| `heart_disease`, `shortness_of_breath`, `high_blood_pressure`, `smoking`, `diabetes`, `family_history`, `medication`, `alcohol` | Positive supplied answers indicate a disclosure; no named condition is emitted |
| `injuries.knees`, `.lower_back`, `.neck_shoulders`, `.hip_pelvis`, `.other.has` | Positive answer indicates an injury disclosure; location/severity omitted |
| `injuries.other.details`, `injury_details` | Nonempty text indicates a disclosure; wording never leaves the API in Discord/vCards |
| `had_recent_injury` | `yes` indicates disclosure; `no` is an explicit negative answer; recent is not relabeled as current |
| `exercise_restriction`, `clearance_notes` | Nonempty text indicates review is needed; no advice is inferred |
| `physician_cleared` | `no` indicates review is needed; `yes` is not interpreted as universal training clearance |
| `workouts`, `last_physical` | Not classified as conditions/injuries and not posted |

Summary distinguishes all-explicit-negative condition/injury answers, partial
negative answers with missing information, information not provided, and disclosure
present. Raw successfully persisted submission answers are used to determine
presence because existing DB normalization defaults missing booleans to false;
changing that persistence behavior is outside this incremental feature. Failed
medical inserts produce “Information not provided,” not a reassuring negative.
There are no distinct historical/current-injury fields; this feature does not
invent that distinction.

Before any future medical-text delivery, operators must establish staff-only
channel access, privacy/consent coverage, and an appropriate retention policy.
Attachments contain contact information including potentially minors' information:
verify staff-only Discord permissions and avoid forwarding cards outside authorized
operations. No new access control, browser secret exposure, or public Supabase
Storage/download route is introduced.

## vCard implementation

`waiverContacts.js` generates vCard 3.0 in memory: `FN`, mandatory `N`, organization,
role, optional phone/email, and a Temple Underground association note. The supplied
full name occupies the first N component; cultural given/family-name boundaries
are not guessed. Guardian notes include the student name and supplied relationship.
Emergency contacts are labeled explicitly instead of being misrepresented as
parents. Phone values come from existing phone fields, with CELL type consistent
with participant phone persistence; guardian phone subtype is not independently
verified by the contract.

Backslashes, commas, semicolons, and embedded newlines are escaped. Output uses
CRLF with a trailing CRLF and folds lines to 75 UTF-8 octets, counting continuation
spaces without splitting Unicode characters. Filenames allow letters/numbers and
underscores, bound name bytes, remove paths/control characters, and disambiguate
collisions. Only approved contact properties are serialized; IDs, waiver metadata,
DOB, medical fields, and free-form unapproved notes are excluded.

## Transport, failures, and retries

`sendDiscordNotification.js` extends the existing incoming webhook transport:
JSON embeds for the summary, native `FormData` with `payload_json` and `files[n]`
for attachments. Native fetch supplies multipart boundaries. `wait=true` requests
server confirmation; existing query parameters such as `thread_id` are preserved.
Cards are not uploaded to Supabase Storage. No bot or Cloudflare Worker is added.
Discord itself hosts the delivered attachments; they remain personal data at the
existing webhook destination.

Discord mentions are disabled with `allowed_mentions`. User-supplied message text
is escaped; controls/bidirectional formatting characters are removed. Embeds have
no timestamp and respect field/title/footer/count and 6000-character aggregate
limits. Long values truncate; raw medical text is never sent. The transport permits
up to ten attachments; the current endpoint creates at most two.

Each message has a separate result/receipt (`discord:summary`, `discord:contacts`).
One failing does not stop the other. Slack retains its original layout and one
message. Provider failures do not roll back persistence or turn successful submits
into errors. Metadata logging includes provider, part, waiver ID and participant
ID, with safe error codes; response bodies, webhook URLs, cards and medical text
are excluded from new notification logging. Existing submit/database diagnostics
are not redesigned by this feature.

The notifier coalesces concurrent events and retains successful parts for 24 hours
in the same process, up to 1000 waiver IDs. Receipts store identifiers and phase
flags only. Capacity rejects new delivery rather than evicting active receipts
and risking double posts. A subsequent internal call for the same waiver retries
only unsuccessful parts. HTTP idempotent resubmission continues to replay its
original envelope **without invoking notifications**, as before; it is not a retry
endpoint. No notification retry endpoint or supported CLI is added.

Explicit 429 responses retry at most three attempts within each message's timeout
(default 3000 ms), waiting at least the requested `retry_after`. Delays exceeding
the timeout fail rather than being shortened. Timeout, network, and 5xx failures
are not automatically repeated: Discord may have accepted an ambiguous request,
and incoming webhooks have no idempotency key. An explicit retry after such a
failure may still duplicate an accepted message.

There is no durable job/outbox in this pipeline; `event_ledger` is an audit ledger,
not notification delivery state. Receipts do not survive process restarts, coordinate
multiple instances, or recover a crash between delivery and receipt recording.
A durable outbox would be warranted if guaranteed delivery, routine operational
replay, or multiple dispatch workers are required; it would need a migration,
authenticated replay/dispatch flow, claims/leases and a Discord ambiguity policy.
For this incremental feature, introducing a new database-backed queue would expand
schema/persistence scope substantially. This implementation preserves the current
pipeline and explicitly does **not** claim exactly-once or durable delivery.

No new environment variables. Existing `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`
continue to configure transports. Daily digests, payment reminders, marketing and
plain-text `services/discord.js` are unchanged.

## Verification and release checks

- `npm ci --ignore-scripts`: succeeded without lockfile modification.
- `npm --workspace services/api run test`: 170 tests across 19 files passed.
- `npm run guard:waiver-schema`: passed.
- `npm run lint` / `npm run typecheck`: repository placeholders; no real lint or
  TypeScript check exists. Syntax checks and the runtime test suite cover changed JS.
- Independent Python `vobject` validation: three synthetic cards passed parser
  validation; Unicode/escaped names, organization, emails, and missing optional
  fields round-tripped. Parser installed in a temporary directory only; no runtime
  dependency added. To repeat, generate synthetic cards with `buildContactFiles`,
  parse each with `vobject.readOne`, call `validate(raiseException=True)`, and assert
  name/phone/email round trips. Never use production contact data for this check.

Automated coverage includes adult/minor-style identities, zero/one/multiple helper
contacts, missing fields, medical presence/negative/missing answers, long sensitive
text, Discord injection/limits, vCard escapes/Unicode/folding/filenames/deduplication,
medical leakage prevention, both success/partial failure directions, concurrent
duplicates, retry skipping, 429, timeout, network/attachment failures, persistence
failure and notification isolation.

Manual checks still required before release:

1. Use synthetic data in an authorized test Discord channel to verify multipart
   download UI and two-message association on mobile; no real students in dev.
2. Import each synthetic `.vcf` into Apple Contacts on iPhone and a common Android
   contact app; verify displayed name, phone, email, role/note, Unicode and separate
   contacts. Parser validity is not evidence of a completed device import.
3. Confirm actual production webhook channel access/retention is appropriate for
   staff contact data. Keep medical text disabled until privacy requirements are
   established through a separate reviewed change.
4. If database/storage integration is exercised, use only the isolated validation
   targets in `validation-environment.md`. No live DB write or Discord post was
   made during implementation; Docker/local Supabase was unavailable here.
