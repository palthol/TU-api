import { z } from 'zod'
import type { FieldPath } from 'react-hook-form'
import type { Translate } from './common'
import { createPersonalInfoSchema } from './PersonalInfo'
import { createEmergencyContactSchema } from './EmergencyContact'
import { createMedicalInformationSchema } from './MedicalInformation'
import { createLegalConfirmationSchema } from './LegalConfirmation'
import { createReviewSchema } from './Review'

export const createWaiverSchema = (t: Translate) =>
  z
    .object({
      personalInfo: createPersonalInfoSchema(t),
      emergencyContact: createEmergencyContactSchema(t),
      medicalInformation: createMedicalInformationSchema(t),
      legalConfirmation: createLegalConfirmationSchema(t),
      review: createReviewSchema(t),
    })
    .strict()

export type WaiverFormData = z.infer<ReturnType<typeof createWaiverSchema>>

export type WaiverStepId =
  | 'personalInfo'
  | 'medicalInformation'
  | 'legalConfirmation'
  | 'review'

export const getStepSchema = (t: Translate, stepId: WaiverStepId) => {
  switch (stepId) {
    case 'personalInfo':
      return createPersonalInfoSchema(t)
    case 'medicalInformation':
      return createMedicalInformationSchema(t)
    case 'legalConfirmation':
      return createLegalConfirmationSchema(t)
    case 'review':
      return createReviewSchema(t)
    default:
      // Exhaustive check
      return createPersonalInfoSchema(t)
  }
}

export const stepFieldPaths: Record<WaiverStepId, FieldPath<WaiverFormData>[]> = {
  personalInfo: [
    'personalInfo.firstName',
    'personalInfo.lastName',
    'personalInfo.dateOfBirth',
    'personalInfo.addressLine1',
    'personalInfo.addressLine2',
    'personalInfo.city',
    'personalInfo.state',
    'personalInfo.postalCode',
    'personalInfo.email',
    'personalInfo.phone',
    'emergencyContact.name',
    'emergencyContact.relationship',
    'emergencyContact.phone',
    'emergencyContact.email',
  ],
  medicalInformation: [
    'medicalInformation.heartDisease',
    'medicalInformation.shortnessOfBreath',
    'medicalInformation.highBloodPressure',
    'medicalInformation.smoking',
    'medicalInformation.diabetes',
    'medicalInformation.familyHistory',
    'medicalInformation.workouts',
    'medicalInformation.medication',
    'medicalInformation.alcohol',
    'medicalInformation.lastPhysical',
    'medicalInformation.exerciseRestriction',
    'medicalInformation.injuries.knees',
    'medicalInformation.injuries.lowerBack',
    'medicalInformation.injuries.neckShoulders',
    'medicalInformation.injuries.hipPelvis',
    'medicalInformation.injuries.other.has',
    'medicalInformation.injuries.other.details',
    'medicalInformation.hadRecentInjury',
    'medicalInformation.injuryDetails',
    'medicalInformation.physicianCleared',
    'medicalInformation.clearanceNotes',
  ],
  legalConfirmation: [
    'legalConfirmation.riskInitials',
    'legalConfirmation.releaseInitials',
    'legalConfirmation.indemnificationInitials',
    'legalConfirmation.mediaInitials',
    'legalConfirmation.acceptedTerms',
    'legalConfirmation.signature.pngDataUrl',
    'legalConfirmation.signature.vectorJson',
  ],
  review: ['review.confirmAccuracy'],
}


