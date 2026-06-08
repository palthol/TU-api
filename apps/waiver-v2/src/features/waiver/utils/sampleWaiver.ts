import type { UseFormReturn } from 'react-hook-form'
import type { WaiverFormInput } from '../hooks/useWaiverForm'

export const SAMPLE_WAIVER: WaiverFormInput = {
  personalInfo: {
    firstName: 'Sample',
    lastName: 'Participant',
    dateOfBirth: '1995-07-04',
    addressLine1: '123 Sample Street',
    addressLine2: 'Unit 5',
    city: 'Morristown',
    state: 'TN',
    postalCode: '37814',
    email: 'sample.participant@example.com',
    phone: '865-555-1234',
  },
  emergencyContact: {
    name: 'Alex Sample',
    relationship: 'Friend',
    phone: '865-555-9876',
    email: 'alex.sample@example.com',
  },
  medicalInformation: {
    heartDisease: false,
    shortnessOfBreath: false,
    highBloodPressure: false,
    smoking: false,
    diabetes: false,
    familyHistory: false,
    workouts: true,
    medication: false,
    alcohol: false,
    lastPhysical: '2024-05-01',
    exerciseRestriction: '',
    injuries: {
      knees: false,
      lowerBack: false,
      neckShoulders: true,
      hipPelvis: false,
      other: { has: true, details: 'Minor ankle sprain in 2023' },
    },
    hadRecentInjury: 'no',
    injuryDetails: '',
    physicianCleared: 'yes',
    clearanceNotes: 'Cleared for moderate activity.',
  },
  legalConfirmation: {
    riskInitials: 'SP',
    releaseInitials: 'SP',
    indemnificationInitials: 'SP',
    mediaInitials: 'SP',
    acceptedTerms: true,
    signature: {
      pngDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+fP/AwAI/QL+4eYyiQAAAABJRU5ErkJggg==',
      vectorJson: [],
    },
  },
  review: { confirmAccuracy: true },
}

export const fillSampleWaiver = (methods: UseFormReturn<WaiverFormInput>) => {
  methods.reset(SAMPLE_WAIVER, { keepDefaultValues: false })
}


