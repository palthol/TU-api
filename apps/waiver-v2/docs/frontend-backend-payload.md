# Waiver Submission Payload Contract

This document captures the structure exchanged between the waiver frontend
(`apps/waiver-v2`) and the API (`services/api`). It is the source of truth for
request fields, types, and optionality. Updates to either side must keep this
contract in sync.

## Backend Expectation Overview

The `/api/waivers/submit` handler expects a single JSON object with the
following top-level keys:

- `participant`: required object containing identity and contact fields.
- `emergency_contact`: optional object; entirely omitted or provided with
  nullable text fields.
- `medical_information`: required object with boolean flags, conditional text
  fields, and nested `injuries`/`other` objects.
- `legal_confirmation`: required object with initials and acceptance flag.
- `signature`: required object containing a PNG data URL and signature vector
  data (`PointGroup[]`).
- `review`: required object capturing the final confirmation checkbox.
- `locale` and `content_version`: required strings identifying translation and
  content revision (defaults applied if frontend omits them).

Optional string properties should be sent as non-empty strings or `null`; empty
strings are normalized to `null` on the server before persistence.

## POST `/api/waivers/submit`

### Request Body

```jsonc
{
  "participant": {
    "full_name": "string",            // required; composed from first + last name (each ≥ 2 chars)
    "date_of_birth": "YYYY-MM-DD",    // required
    "email": "string",                // required, RFC 5322 compliant
    "phone": "string",                // required, any format accepted
    "address_line": "string",         // optional
    "address_line_2": "string|null",  // optional
    "city": "string",                 // optional (validated client-side)
    "state": "string",                // optional
    "zip": "string"                   // optional
  },
  "emergency_contact": {
    "name": "string|null",
    "relationship": "string|null",
    "phone": "string|null",
    "email": "string|null"            // must be empty string or RFC email if provided
  },
  "medical_information": {
    "heart_disease": "boolean",
    "shortness_of_breath": "boolean",
    "high_blood_pressure": "boolean",
    "smoking": "boolean",
    "diabetes": "boolean",
    "family_history": "boolean",
    "workouts": "boolean",
    "medication": "boolean",
    "alcohol": "boolean",
    "last_physical": "string|null",
    "exercise_restriction": "string|null",
    "injuries": {
      "knees": "boolean",
      "lower_back": "boolean",
      "neck_shoulders": "boolean",
      "hip_pelvis": "boolean",
      "other": {
        "has": "boolean",
        "details": "string|null"      // required when has = true (frontend enforcement)
      }
    },
    "had_recent_injury": "yes|no",
    "injury_details": "string|null",   // required when had_recent_injury = "yes"
    "physician_cleared": "yes|no|null",
    "clearance_notes": "string|null"
  },
  "legal_confirmation": {
    "risk_initials": "string",        // length 2 enforced client-side
    "release_initials": "string",
    "indemnification_initials": "string",
    "media_initials": "string",
    "accepted_terms": "boolean"       // true required
  },
  "signature": {
    "pngDataUrl": "data:image/png;base64,...",
    "vectorJson": "PointGroup[]"      // signature_pad stroke groups
  },
  "review": {
    "confirm_accuracy": "boolean"     // true required to submit
  },
  "locale": "en|es",                  // default "en" in frontend if omitted
  "content_version": "string"         // current frontend constant "waiver.v1"
}
```

### Backend Handling Summary

- Participant record is upserted by email + DOB + phone; optional address
  fields persist when provided.
- Emergency contact rows are inserted only when any field is present; nulls are
  stored otherwise.
- Medical history booleans and text map to `waiver_medical_histories` columns.
  `physician_cleared` accepts `true`, `false`, or `null` (from yes/no/undefined).
  - If `medical_information.injuries.other.has` is `true`, backend expects
    `injuries_other_details` to be non-null/non-empty; otherwise it stores null.
  - If `medical_information.had_recent_injury` is `'yes'`, backend stores
    `had_recent_injury = true` and `injury_details` from the payload. When the
    value is `'no'`, the column is false and `injury_details` is set to null.
  - `physician_cleared` values `'yes'/'no'` are converted to booleans; any other
    value results in `null` in the database.
- Backend receives optional string fields as either non-empty strings or `null`.
  Empty strings will be normalized to `null` before persistence.
- Legal initials map directly to `waivers` columns; `accepted_terms` drives
  `consent_acknowledged`.
- Signature PNG uploads to the `SIGNATURES_BUCKET`; PDF is generated and stored
  in `WAIVERS_BUCKET`. Object paths are saved in the database.
- Review confirmation maps to `waivers.review_confirm_accuracy`.
- `locale` and `content_version` persist in `audit_trails`.

### Validation Alignment

Frontend validation (zod schemas) should ensure:

- Participant first and last name (each at least 2 characters); the submit mapper
  composes `participant.full_name` as `"<firstName> <lastName>"` before POST.
- Required participant fields and signature presence.
- Optional contact/email fields either empty or valid format.
- Medical conditional requirements (injury details, other injury notes, etc.).
- Legal initials length and checkbox acceptance.

Backend performs minimum validation (presence of key participant fields,
`full_name` split into first/last parts with at least 2 characters each,
signature, legal initials acceptance). Any tightening should be coordinated with
schema updates to avoid conflicting error handling.

## GET `/api/admin/waivers/:id`

Not detailed here; payload remains unchanged and returns signed URLs for stored
assets.

---

### Change Process

1. Update this document when introducing new fields or changing semantics.
2. Adjust frontend schema (`apps/waiver-v2/src/features/waiver/schema`) and
   payload mapper(s).
3. Update backend handler (`services/api/src/index.js`) and migrations if
   storage/table changes are required.
4. Add or update tests covering new fields or validation.
