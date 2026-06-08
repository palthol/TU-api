import React from 'react'
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createWaiverSchema, stepFieldPaths } from '../schema/waiver'
import { z } from 'zod'
import type { MedicalInformationInput } from '../schema/MedicalInformation'

type Translate = (key: string) => string

type WaiverSchema = ReturnType<typeof createWaiverSchema>
type WaiverFormInputBase = z.input<WaiverSchema>

// Override medicalInformation with the explicit type to fix TypeScript inference issues
export type WaiverFormInput = Omit<WaiverFormInputBase, 'medicalInformation'> & {
  medicalInformation: MedicalInformationInput
}
export type WaiverFormData = z.output<WaiverSchema>

declare global {
  interface Window {
    __waiverFormDebug?: () => UseFormReturn<WaiverFormInput>
  }
}

export type UseWaiverFormReturn = {
  methods: UseFormReturn<WaiverFormInput>
  stepFields: typeof stepFieldPaths
}

export const createDefaultValues = (): WaiverFormInput => ({
  personalInfo: {
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    email: '',
    phone: '',
  },
  emergencyContact: {
    name: '',
    relationship: '',
    phone: '',
    email: '',
  },
  medicalInformation: {
    heartDisease: false,
    shortnessOfBreath: false,
    highBloodPressure: false,
    smoking: false,
    diabetes: false,
    familyHistory: false,
    workouts: false,
    medication: false,
    alcohol: false,
    lastPhysical: '',
    exerciseRestriction: '',
    injuries: {
      knees: false,
      lowerBack: false,
      neckShoulders: false,
      hipPelvis: false,
      other: { has: false, details: '' },
    },
    hadRecentInjury: 'no',
    injuryDetails: '',
    physicianCleared: undefined,
    clearanceNotes: '',
  },
  legalConfirmation: {
    riskInitials: '',
    releaseInitials: '',
    indemnificationInitials: '',
    mediaInitials: '',
    acceptedTerms: false,
    signature: { pngDataUrl: '', vectorJson: [] },
  },
  review: { confirmAccuracy: false },
})

export const useWaiverForm = (t: Translate) => {
  const schema = React.useMemo(() => createWaiverSchema(t), [t])
  const defaultValues = React.useMemo(() => createDefaultValues(), [])
  const resolver = React.useMemo(
    () => zodResolver(schema) as unknown as Resolver<WaiverFormInput>,
    [schema],
  )

  const methods = useForm<WaiverFormInput>({
    resolver,
    mode: 'onBlur',
    defaultValues,
  })

  if (typeof window !== 'undefined') {
    window.__waiverFormDebug = () => methods
  }

  return React.useMemo(
    () => ({ methods, stepFields: stepFieldPaths }),
    [methods],
  )
}
