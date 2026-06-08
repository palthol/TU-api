import type { Locale } from '../../../shared/i18n/I18nProvider'
import type { WaiverFormData, WaiverFormInput } from '../hooks/useWaiverForm'
import { buildApiUrl } from './client'

export type SubmitWaiverSuccess = {
  waiverId: string
  participantId: string
  accountId?: string
  accountMemberId?: string
  sha256: string
}

export type SubmitWaiverFieldError = {
  field: string
  messageKey?: string
}

export type SubmitWaiverResult =
  | { ok: true; data: SubmitWaiverSuccess }
  | { ok: false; status: number; errors?: SubmitWaiverFieldError[]; error?: string; message?: string }

const CONTENT_VERSION = 'waiver.v1'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseFieldErrors = (value: unknown): SubmitWaiverFieldError[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const parsed = value.reduce<SubmitWaiverFieldError[]>((acc, entry) => {
    if (!isRecord(entry)) return acc
    const field = typeof entry.field === 'string' ? entry.field : undefined
    if (!field) return acc
    const messageKey = typeof entry.messageKey === 'string' ? entry.messageKey : undefined
    acc.push({ field, messageKey })
    return acc
  }, [])

  return parsed.length ? parsed : undefined
}

const normalizeOptional = (value: string | undefined | null) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export const composeParticipantFullName = (firstName: string, lastName: string) =>
  `${firstName.trim()} ${lastName.trim()}`

const mapParticipant = (input: WaiverFormInput['personalInfo']) => ({
  full_name: composeParticipantFullName(input.firstName, input.lastName),
  date_of_birth: input.dateOfBirth,
  email: input.email,
  phone: input.phone,
  address_line: normalizeOptional(input.addressLine1),
  address_line_2: normalizeOptional(input.addressLine2),
  city: normalizeOptional(input.city),
  state: normalizeOptional(input.state),
  zip: normalizeOptional(input.postalCode),
})

const mapEmergencyContact = (input: WaiverFormInput['emergencyContact']) => ({
  name: normalizeOptional(input.name),
  relationship: normalizeOptional(input.relationship),
  phone: normalizeOptional(input.phone),
  email: normalizeOptional(input.email),
})

const mapMedicalInformation = (input: WaiverFormData['medicalInformation']) => ({
  heart_disease: input.heartDisease,
  shortness_of_breath: input.shortnessOfBreath,
  high_blood_pressure: input.highBloodPressure,
  smoking: input.smoking,
  diabetes: input.diabetes,
  family_history: input.familyHistory,
  workouts: input.workouts,
  medication: input.medication,
  alcohol: input.alcohol,
  last_physical: normalizeOptional(input.lastPhysical),
  exercise_restriction: normalizeOptional(input.exerciseRestriction),
  injuries: {
    knees: input.injuries.knees, 
    lower_back: input.injuries.lowerBack,
    neck_shoulders: input.injuries.neckShoulders,
    hip_pelvis: input.injuries.hipPelvis,
    other: {
      has: input.injuries.other.has,
      details: normalizeOptional(input.injuries.other.details),
    },
  },
  had_recent_injury: input.hadRecentInjury,
  injury_details: normalizeOptional(input.injuryDetails),
  physician_cleared: input.physicianCleared ?? null,
  clearance_notes: normalizeOptional(input.clearanceNotes),
})

const mapLegalConfirmation = (input: WaiverFormInput['legalConfirmation']) => ({
  risk_initials: input.riskInitials,
  release_initials: input.releaseInitials,
  indemnification_initials: input.indemnificationInitials,
  media_initials: input.mediaInitials,
  accepted_terms: input.acceptedTerms,
})

const buildPayload = (formData: WaiverFormInput, locale: Locale) => ({
  participant: mapParticipant(formData.personalInfo),
  emergency_contact: mapEmergencyContact(formData.emergencyContact),
  medical_information: mapMedicalInformation(formData.medicalInformation as WaiverFormData['medicalInformation']),
  legal_confirmation: mapLegalConfirmation(formData.legalConfirmation),
  signature: formData.legalConfirmation.signature,
  review: { confirm_accuracy: formData.review.confirmAccuracy },
  locale,
  content_version: CONTENT_VERSION,
})

const summarizePayloadForLog = (payload: ReturnType<typeof buildPayload>) => ({
  participant: payload.participant
    ? {
        full_name: Boolean(payload.participant.full_name),
        date_of_birth: Boolean(payload.participant.date_of_birth),
        email: Boolean(payload.participant.email),
        phone: Boolean(payload.participant.phone),
        address_line: Boolean(payload.participant.address_line),
        address_line_2: Boolean(payload.participant.address_line_2),
      }
    : null,
  emergency_contact: payload.emergency_contact
    ? {
        hasAny:
          Boolean(payload.emergency_contact.name) ||
          Boolean(payload.emergency_contact.relationship) ||
          Boolean(payload.emergency_contact.phone) ||
          Boolean(payload.emergency_contact.email),
        name: Boolean(payload.emergency_contact.name),
        relationship: Boolean(payload.emergency_contact.relationship),
        phone: Boolean(payload.emergency_contact.phone),
        email: Boolean(payload.emergency_contact.email),
      }
    : null,
  medical_information: payload.medical_information
    ? {
        hasAny: Object.values(payload.medical_information).some((value) => value !== false && value !== null),
        had_recent_injury: payload.medical_information.had_recent_injury,
        injuries_other_has: payload.medical_information.injuries.other.has,
      }
    : null,
  legal_confirmation: payload.legal_confirmation
    ? {
        accepted_terms: Boolean(payload.legal_confirmation.accepted_terms),
        risk_initials: Boolean(payload.legal_confirmation.risk_initials),
        release_initials: Boolean(payload.legal_confirmation.release_initials),
        indemnification_initials: Boolean(payload.legal_confirmation.indemnification_initials),
        media_initials: Boolean(payload.legal_confirmation.media_initials),
      }
    : null,
  signature: payload.signature
    ? {
        hasPng: Boolean(payload.signature.pngDataUrl),
        vectorLength: Array.isArray(payload.signature.vectorJson) ? payload.signature.vectorJson.length : undefined,
      }
    : null,
  review: payload.review ? { confirm_accuracy: Boolean(payload.review.confirm_accuracy) } : null,
  locale: payload.locale,
  content_version: payload.content_version,
})

const tryParseJson = async (response: Response) => {
  try {
    return (await response.json()) as unknown
  } catch (error) {
    console.warn('Failed to parse response JSON', error)
    return null
  }
}

export const submitWaiver = async (
  formData: WaiverFormInput,
  locale: Locale,
): Promise<SubmitWaiverResult> => {
  const url = buildApiUrl('/api/waivers/submit')
  const payload = buildPayload(formData, locale)

  console.log('[waiver] submitting payload summary', summarizePayloadForLog(payload))

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const json = await tryParseJson(response)

    if (!response.ok) {
      const errors = isRecord(json) ? parseFieldErrors(json.errors) : undefined
      const error = isRecord(json) && typeof json.error === 'string' ? json.error : undefined
      return { ok: false, status: response.status, errors, error }
    }

    if (!isRecord(json)) {
      return { ok: false, status: response.status, error: 'invalid_response' }
    }

    const waiverId = typeof json.waiverId === 'string' ? json.waiverId : undefined
    const participantId = typeof json.participantId === 'string' ? json.participantId : undefined
    const accountId = typeof json.accountId === 'string' ? json.accountId : undefined
    const accountMemberId = typeof json.accountMemberId === 'string' ? json.accountMemberId : undefined
    const sha256 = typeof json.sha256 === 'string' ? json.sha256 : ''

    if (!waiverId || !participantId) {
      return { ok: false, status: response.status, error: 'invalid_response' }
    }

    return {
      ok: true,
      data: {
        waiverId,
        participantId,
        accountId,
        accountMemberId,
        sha256,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, status: 0, error: 'network_error', message }
  }
}


