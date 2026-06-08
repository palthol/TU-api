import React from 'react'
import { FormProvider, type FieldPath } from 'react-hook-form'
import { useI18n } from '../../shared/i18n/I18nProvider'
import { WaiverWizardLayout } from '../../features/waiver/components/Wizard/WaiverWizardLayout'
import { StepNavigation } from '../../features/waiver/components/Wizard/StepNavigation'
import { createDefaultValues, useWaiverForm, type WaiverFormInput } from '../../features/waiver/hooks/useWaiverForm'
import { useWaiverSteps } from '../../features/waiver/hooks/useWaiverSteps'
import { HouseholdReuseStep, PersonalInfoStep, MedicalInfoStep, LegalConfirmationStep, ReviewStep } from '../../features/waiver/components/steps'
import { getStepSchema } from '../../features/waiver/schema/waiver'
import { z } from 'zod'
import { submitWaiver, type SubmitWaiverFieldError, type SubmitWaiverSuccess } from '../../features/waiver/api/submitWaiver'
import { getWaiverPdf } from '../../features/waiver/api/getWaiverPdf'
import { warmApi } from '../../features/waiver/api/client'
import { fillSampleWaiver } from '../../features/waiver/utils/sampleWaiver'
import { SectionCard } from '../../features/waiver/components/common/SectionCard'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

const stepTitleKeys = [
  'personalInfo.title',
  'medicalInfo.title',
  'legalConfirmation.title',
  'review.title',
]

const stepIds = ([
  'personalInfo',
  'medicalInformation',
  'legalConfirmation',
  'review',
] as const)

type SignupMode = 'self' | 'other' | 'self_and_others'

type SessionConfig = {
  mode: SignupMode
  totalPeople: number
}

type HouseholdContext = {
  householdAddress: Pick<WaiverFormInput['personalInfo'], 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode'>
  guardianContact: Pick<WaiverFormInput['personalInfo'], 'phone' | 'email'>
  householdLastName: string
  emergencyContact: WaiverFormInput['emergencyContact']
}

type ReuseOptions = {
  address: boolean
  guardianContact: boolean
  lastName: boolean
  emergencyContact: boolean
}

const createDefaultReuseOptions = (hasEmergencyContact: boolean): ReuseOptions => ({
  address: true,
  guardianContact: true,
  lastName: true,
  emergencyContact: hasEmergencyContact,
})

export const WaiverPage: React.FC = () => {
  const { t, locale } = useI18n()
  const { methods } = useWaiverForm(t)
  const total = stepIds.length
  const { index, isFirst, isLast, goBack, goNext, reset: resetSteps } = useWaiverSteps(total)
  const [modeSelection, setModeSelection] = React.useState<SignupMode>('self')
  const [modeCount, setModeCount] = React.useState<number>(2)
  const [sessionConfig, setSessionConfig] = React.useState<SessionConfig | null>(null)
  const [currentPersonIndex, setCurrentPersonIndex] = React.useState(1)
  const [sessionResults, setSessionResults] = React.useState<SubmitWaiverSuccess[]>([])
  const [householdContext, setHouseholdContext] = React.useState<HouseholdContext | null>(null)
  const [showReuseStep, setShowReuseStep] = React.useState(false)
  const [reuseOptions, setReuseOptions] = React.useState<ReuseOptions>(createDefaultReuseOptions(false))
  const [prefillAppliedHint, setPrefillAppliedHint] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = React.useState<SubmitWaiverSuccess | null>(null)
  const [isDownloading, setIsDownloading] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)
  const currentStepId = stepIds[index]
  const currentSchema = React.useMemo(() => getStepSchema(t, currentStepId), [t, currentStepId])
  const currentStepData = methods.watch(currentStepId as any)
  const validationResult = (currentSchema as z.ZodTypeAny).safeParse(currentStepData)
  const canAdvance = validationResult.success && !isSubmitting && !submitSuccess
  const hasMorePeople = Boolean(sessionConfig && currentPersonIndex < sessionConfig.totalPeople)

  const serverFieldMap = React.useMemo(() => {
    const map = {
      'participant.full_name': 'personalInfo.firstName',
      'participant.date_of_birth': 'personalInfo.dateOfBirth',
      'participant.address_line': 'personalInfo.addressLine1',
      'participant.address_line_2': 'personalInfo.addressLine2',
      'participant.city': 'personalInfo.city',
      'participant.state': 'personalInfo.state',
      'participant.zip': 'personalInfo.postalCode',
      'participant.email': 'personalInfo.email',
      'participant.phone': 'personalInfo.phone',
      'emergency_contact.name': 'emergencyContact.name',
      'emergency_contact.relationship': 'emergencyContact.relationship',
      'emergency_contact.phone': 'emergencyContact.phone',
      'emergency_contact.email': 'emergencyContact.email',
      'medical_information.had_recent_injury': 'medicalInformation.hadRecentInjury',
      'medical_information.injury_details': 'medicalInformation.injuryDetails',
      'medical_information.physician_cleared': 'medicalInformation.physicianCleared',
      'medical_information.clearance_notes': 'medicalInformation.clearanceNotes',
      'medical_information.last_physical': 'medicalInformation.lastPhysical',
      'medical_information.exercise_restriction': 'medicalInformation.exerciseRestriction',
      'legal_confirmation.risk_initials': 'legalConfirmation.riskInitials',
      'legal_confirmation.release_initials': 'legalConfirmation.releaseInitials',
      'legal_confirmation.indemnification_initials': 'legalConfirmation.indemnificationInitials',
      'legal_confirmation.media_initials': 'legalConfirmation.mediaInitials',
      'legal_confirmation.accepted_terms': 'legalConfirmation.acceptedTerms',
      signature: 'legalConfirmation.signature.pngDataUrl',
      'review.confirm_accuracy': 'review.confirmAccuracy',
    } as unknown as Record<string, FieldPath<WaiverFormInput>>

    return map
  }, [])

  const translateMessageKey = React.useCallback(
    (key?: string | null) => {
      if (!key) return undefined
      const translated = t(key)
      return translated === key ? undefined : translated
    },
    [t],
  )

  const applyServerErrors = React.useCallback(
    (errors: SubmitWaiverFieldError[]) => {
      errors.forEach(({ field, messageKey }) => {
        if (field === 'participant.full_name') {
          const message = translateMessageKey(messageKey) ?? t('submission.error.validation')
          methods.setError('personalInfo.firstName', { type: 'server', message })
          methods.setError('personalInfo.lastName', { type: 'server', message })
          return
        }
        const formPath = serverFieldMap[field]
        if (formPath) {
          methods.setError(formPath, {
            type: 'server',
            message: translateMessageKey(messageKey) ?? t('submission.error.validation'),
          })
        }
      })
    },
    [methods, serverFieldMap, t, translateMessageKey],
  )

  const hasEmergencyContactValues = React.useCallback((emergencyContact: WaiverFormInput['emergencyContact']) => {
    return Boolean(
      emergencyContact.name?.trim() ||
        emergencyContact.relationship?.trim() ||
        emergencyContact.phone?.trim() ||
        emergencyContact.email?.trim(),
    )
  }, [])

  const buildHouseholdContext = React.useCallback(
    (formValues: WaiverFormInput): HouseholdContext => ({
      householdAddress: {
        addressLine1: formValues.personalInfo.addressLine1 ?? '',
        addressLine2: formValues.personalInfo.addressLine2 ?? '',
        city: formValues.personalInfo.city ?? '',
        state: formValues.personalInfo.state ?? '',
        postalCode: formValues.personalInfo.postalCode ?? '',
      },
      guardianContact: {
        phone: formValues.personalInfo.phone ?? '',
        email: formValues.personalInfo.email ?? '',
      },
      householdLastName: formValues.personalInfo.lastName?.trim() ?? '',
      emergencyContact: {
        name: formValues.emergencyContact.name ?? '',
        relationship: formValues.emergencyContact.relationship ?? '',
        phone: formValues.emergencyContact.phone ?? '',
        email: formValues.emergencyContact.email ?? '',
      },
    }),
    [],
  )

  const applyReusePrefills = React.useCallback(
    (context: HouseholdContext, options: ReuseOptions) => {
      methods.reset(createDefaultValues())
      resetSteps()

      if (options.address) {
        methods.setValue('personalInfo.addressLine1', context.householdAddress.addressLine1 ?? '', { shouldDirty: true })
        methods.setValue('personalInfo.addressLine2', context.householdAddress.addressLine2 ?? '', { shouldDirty: true })
        methods.setValue('personalInfo.city', context.householdAddress.city ?? '', { shouldDirty: true })
        methods.setValue('personalInfo.state', context.householdAddress.state ?? '', { shouldDirty: true })
        methods.setValue('personalInfo.postalCode', context.householdAddress.postalCode ?? '', { shouldDirty: true })
      }

      if (options.guardianContact) {
        methods.setValue('personalInfo.phone', context.guardianContact.phone ?? '', { shouldDirty: true })
        methods.setValue('personalInfo.email', context.guardianContact.email ?? '', { shouldDirty: true })
      }

      if (options.lastName && context.householdLastName) {
        methods.setValue('personalInfo.lastName', context.householdLastName, { shouldDirty: true })
      }

      if (options.emergencyContact) {
        methods.setValue('emergencyContact.name', context.emergencyContact.name ?? '', { shouldDirty: true })
        methods.setValue('emergencyContact.relationship', context.emergencyContact.relationship ?? '', { shouldDirty: true })
        methods.setValue('emergencyContact.phone', context.emergencyContact.phone ?? '', { shouldDirty: true })
        methods.setValue('emergencyContact.email', context.emergencyContact.email ?? '', { shouldDirty: true })
      }

      const appliedLabels: string[] = []
      if (options.address) appliedLabels.push(t('householdReuse.options.address'))
      if (options.guardianContact) appliedLabels.push(t('householdReuse.options.guardianContact'))
      if (options.lastName && context.householdLastName) appliedLabels.push(t('householdReuse.options.lastName'))
      if (options.emergencyContact) appliedLabels.push(t('householdReuse.options.emergencyContact'))
      setPrefillAppliedHint(appliedLabels.length ? `${t('householdReuse.appliedPrefix')}: ${appliedLabels.join(', ')}` : null)
    },
    [methods, resetSteps, t],
  )

  const handleStartOver = React.useCallback(() => {
    methods.reset(createDefaultValues())
    resetSteps()
    setSubmitSuccess(null)
    setSubmitError(null)
    setDownloadError(null)
    setSessionResults([])
    setSessionConfig(null)
    setCurrentPersonIndex(1)
    setHouseholdContext(null)
    setShowReuseStep(false)
    setReuseOptions(createDefaultReuseOptions(false))
    setPrefillAppliedHint(null)
    setModeSelection('self')
    setModeCount(2)
  }, [methods, resetSteps])

  const handleStartSession = React.useCallback(() => {
    const normalizedCount = Number.isFinite(modeCount) ? Math.floor(modeCount) : 1
    const totalPeople =
      modeSelection === 'self'
        ? 1
        : modeSelection === 'self_and_others'
          ? Math.max(2, normalizedCount)
          : Math.max(1, normalizedCount)

    setSessionConfig({ mode: modeSelection, totalPeople })
    setCurrentPersonIndex(1)
    setSessionResults([])
    setSubmitSuccess(null)
    setSubmitError(null)
    setDownloadError(null)
    setHouseholdContext(null)
    setShowReuseStep(false)
    setReuseOptions(createDefaultReuseOptions(false))
    setPrefillAppliedHint(null)
    methods.reset(createDefaultValues())
    resetSteps()
  }, [methods, modeCount, modeSelection, resetSteps])

  const handleFillSample = React.useCallback(() => {
    fillSampleWaiver(methods as unknown as Parameters<typeof fillSampleWaiver>[0])
    resetSteps()
    setSubmitError(null)
    setDownloadError(null)
    setPrefillAppliedHint(null)
  }, [methods, resetSteps])

  const handleDownloadPdf = React.useCallback(async () => {
    if (!submitSuccess) return
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const result = await getWaiverPdf(submitSuccess.waiverId)
      if (!result.ok) {
        const translated = result.error ? translateMessageKey(`submission.error.${result.error}`) : undefined
        setDownloadError(translated ?? result.error ?? t('submission.error.generic'))
        return
      }

      const blobUrl = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = result.fileName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (error) {
      if (error instanceof Error) {
        const translated = translateMessageKey(error.message)
        setDownloadError(translated ?? error.message)
      } else {
        setDownloadError(t('submission.error.generic'))
      }
    } finally {
      setIsDownloading(false)
    }
  }, [submitSuccess, t, translateMessageKey])

  const handleReuseContinue = React.useCallback(() => {
    if (!householdContext) {
      setShowReuseStep(false)
      methods.reset(createDefaultValues())
      resetSteps()
      return
    }

    applyReusePrefills(householdContext, reuseOptions)
    setShowReuseStep(false)
    setSubmitError(null)
    setDownloadError(null)
  }, [applyReusePrefills, householdContext, methods, resetSteps, reuseOptions])

  const handleReuseBack = React.useCallback(() => {
    setShowReuseStep(false)
    methods.reset(createDefaultValues())
    resetSteps()
    setPrefillAppliedHint(null)
  }, [methods, resetSteps])

  const onBack = () => {
    if (submitSuccess) return
    if (showReuseStep) {
      handleReuseBack()
      return
    }
    setSubmitError(null)
    goBack()
  }

  const onNext = async () => {
    if (submitSuccess) return
    if (showReuseStep) {
      handleReuseContinue()
      return
    }
    if (!canAdvance) {
      validationResult.error?.issues.forEach((issue) => {
        const field = [currentStepId, ...(issue.path as (string | number)[])].join('.')
        methods.setError(field as any, { type: 'zod', message: issue.message }, { shouldFocus: true })
      })
      return
    }

    if (!isLast) {
      void warmApi()
    }

    if (isLast) {
      setIsSubmitting(true)
      try {
        await methods.handleSubmit(async (formValues) => {
          setSubmitError(null)
          const result = await submitWaiver(formValues as unknown as WaiverFormInput, locale)
          if (result.ok) {
            const nextResults = [...sessionResults, result.data]
            setSessionResults(nextResults)

            if (hasMorePeople) {
              const nextHouseholdContext = householdContext ?? buildHouseholdContext(formValues)
              const allowEmergencyReuse = hasEmergencyContactValues(nextHouseholdContext.emergencyContact)
              setHouseholdContext(nextHouseholdContext)
              setReuseOptions(createDefaultReuseOptions(allowEmergencyReuse))
              methods.reset(createDefaultValues())
              resetSteps()
              setShowReuseStep(true)
              setCurrentPersonIndex((prev) => prev + 1)
              setDownloadError(null)
              setPrefillAppliedHint(null)
              return
            }

            setSubmitSuccess(result.data)
            methods.reset(formValues)
            return
          }

          if (result.errors?.length) {
            applyServerErrors(result.errors)
            setSubmitError(t('submission.error.validation'))
            return
          }

          if (result.error === 'network_error') {
            setSubmitError(t('submission.error.network'))
            return
          }

          if (result.error) {
            const translated = translateMessageKey(`submission.error.${result.error}`)
            setSubmitError(translated ?? t('submission.error.generic'))
            return
          }

          setSubmitError(t('submission.error.generic'))
        })()
      } finally {
        setIsSubmitting(false)
      }
    } else {
      setSubmitError(null)
      goNext()
    }
  }

  const renderStep = () => {
    switch (currentStepId) {
      case 'personalInfo':
        return <PersonalInfoStep />
      case 'medicalInformation':
        return <MedicalInfoStep />
      case 'legalConfirmation':
        return <LegalConfirmationStep />
      case 'review':
      default:
        return <ReviewStep />
    }
  }

  const stepTitle = submitSuccess
    ? t('submission.success.title')
    : showReuseStep
      ? t('householdReuse.title')
      : t(stepTitleKeys[index])
  const progressLabel = t('wizard.progress')
    .replace('{current}', String(index + 1))
    .replace('{total}', String(total))
  const personIndicator =
    sessionConfig && !submitSuccess
      ? `${t('multiSignup.personIndicatorPrefix')} ${currentPersonIndex} ${t('multiSignup.personIndicatorSeparator')} ${sessionConfig.totalPeople}`
      : null
  const stepIndicator = submitSuccess
    ? undefined
    : showReuseStep
      ? personIndicator ?? undefined
    : personIndicator
      ? `${personIndicator} • ${progressLabel}`
      : progressLabel

  if (!sessionConfig) {
    return (
      <WaiverWizardLayout title={t('app.title')} stepTitle={t('multiSignup.setupTitle')}>
        <SectionCard title={t('multiSignup.setupTitle')} subtitle={t('multiSignup.setupDescription')}>
          <div className="space-y-5">
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm text-brand-on-surface">
                <input
                  type="radio"
                  name="signupMode"
                  checked={modeSelection === 'self'}
                  onChange={() => setModeSelection('self')}
                />
                <span>{t('multiSignup.mode.self')}</span>
              </label>
              <label className="flex items-center gap-3 text-sm text-brand-on-surface">
                <input
                  type="radio"
                  name="signupMode"
                  checked={modeSelection === 'other'}
                  onChange={() => setModeSelection('other')}
                />
                <span>{t('multiSignup.mode.other')}</span>
              </label>
              <label className="flex items-center gap-3 text-sm text-brand-on-surface">
                <input
                  type="radio"
                  name="signupMode"
                  checked={modeSelection === 'self_and_others'}
                  onChange={() => setModeSelection('self_and_others')}
                />
                <span>{t('multiSignup.mode.selfAndOthers')}</span>
              </label>
            </div>

            {modeSelection !== 'self' && (
              <div className="max-w-[240px]">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-secondary/90">
                  {t('multiSignup.countLabel')}
                </label>
                <Input
                  className="mt-2"
                  type="number"
                  min={modeSelection === 'self_and_others' ? 2 : 1}
                  value={modeCount}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10)
                    setModeCount(Number.isFinite(parsed) ? parsed : 1)
                  }}
                />
                <p className="mt-1 text-xs text-brand-secondary/75">{t('multiSignup.countHint')}</p>
              </div>
            )}

            <Button type="button" onClick={handleStartSession}>
              {modeSelection === 'self' ? t('multiSignup.startSingle') : t('multiSignup.start')}
            </Button>
          </div>
        </SectionCard>
      </WaiverWizardLayout>
    )
  }

  return (
    <FormProvider {...methods}>
      <WaiverWizardLayout
        title={t('app.title')}
        stepTitle={stepTitle}
        stepIndicator={stepIndicator}
      >
        {submitSuccess ? (
          <div className="space-y-6">
            <SectionCard
              title={t('submission.success.title')}
              subtitle={t('submission.success.body')}
              alignHeader="center"
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-brand-outline/30 bg-brand-surface-variant/60 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary">
                    {t('submission.details.waiverId')}
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-brand-primary">{submitSuccess.waiverId}</p>
                </div>
                <div className="rounded-xl border border-brand-outline/30 bg-brand-surface-variant/60 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary">
                    {t('submission.details.participantId')}
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-brand-primary">{submitSuccess.participantId}</p>
                </div>
                {submitSuccess.sha256 && (
                  <div className="rounded-xl border border-brand-outline/30 bg-brand-surface-variant/60 p-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary">
                      {t('submission.details.sha256')}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-brand-primary">{submitSuccess.sha256}</p>
                  </div>
                )}
              </div>

              {sessionResults.length > 1 && (
                <div className="mt-6 rounded-xl border border-brand-outline/30 bg-brand-surface-variant/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-secondary">
                    {t('multiSignup.summaryTitle')}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-brand-on-surface">
                    {sessionResults.map((item, itemIndex) => (
                      <li key={item.waiverId} className="rounded-md border border-brand-outline/25 bg-brand-surface/70 px-3 py-2">
                        <span className="font-semibold">{t('multiSignup.personLabel')} {itemIndex + 1}:</span>{' '}
                        <span className="font-mono">{item.participantId}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {downloadError && (
                <div
                  role="alert"
                  className="mt-6 rounded-xl border border-brand-error/40 bg-brand-error/10 px-4 py-3 text-sm font-medium text-brand-error"
                >
                  {downloadError}
                </div>
              )}

              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isDownloading}
                >
                  {isDownloading ? t('submission.actions.downloading') : t('submission.actions.downloadPdf')}
                </Button>
                <Button
                  type="button"
                  onClick={handleStartOver}
                  variant="outline"
                >
                  {t('submission.actions.new')}
                </Button>
              </div>
            </SectionCard>
          </div>
        ) : (
          <div className="space-y-4">
            {submitError && (
              <div
                role="alert"
                className="rounded-xl border border-brand-error/40 bg-brand-error/10 p-4 text-sm font-medium text-brand-error shadow-sm"
              >
                {submitError}
              </div>
            )}
            {showReuseStep ? (
              <HouseholdReuseStep
                options={reuseOptions}
                emergencyContactAvailable={Boolean(householdContext && hasEmergencyContactValues(householdContext.emergencyContact))}
                onChange={setReuseOptions}
              />
            ) : (
              <>
                {prefillAppliedHint && (
                  <div className="rounded-xl border border-brand-primary/25 bg-brand-primary/10 px-4 py-3 text-sm font-medium text-brand-primary">
                    {prefillAppliedHint}
                  </div>
                )}
                {renderStep()}
              </>
            )}
            {import.meta.env.DEV && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleFillSample}
                  variant="outline"
                  size="sm"
                >
                  Fill with sample data
                </Button>
              </div>
            )}
            <StepNavigation
              isFirstStep={isFirst}
              isLastStep={isLast}
              onBack={onBack}
              onNext={onNext}
              disabledNext={showReuseStep ? false : !canAdvance}
              labels={{
                back: t('nav.back'),
                next: t('nav.next'),
                submit: isSubmitting
                  ? t('nav.submitting')
                  : showReuseStep
                    ? t('householdReuse.continue')
                    : isLast && hasMorePeople
                    ? t('nav.submitNextPerson')
                    : t('nav.submit'),
              }}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </WaiverWizardLayout>
    </FormProvider>
  )
}
