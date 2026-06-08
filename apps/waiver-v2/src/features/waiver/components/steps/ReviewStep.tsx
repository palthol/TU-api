import React from 'react'
import { useFormContext } from 'react-hook-form'
import type { WaiverFormInput, WaiverFormData } from '../../hooks/useWaiverForm'
import { SectionCard } from '../common/SectionCard'
import { checkboxClasses } from '../common/Field'
import { useI18n } from '../../../../shared/i18n/I18nProvider'

const ReviewRow: React.FC<{ label: string; emptyText: string; value?: React.ReactNode }> = ({ label, emptyText, value }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-outline/15 pb-3 last:border-b-0 last:pb-0">
    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary/80">{label}</span>
    <span className="text-sm text-brand-on-surface">
      {value !== undefined && value !== '' ? value : <span className="italic text-brand-secondary/70">{emptyText}</span>}
    </span>
  </div>
)

export const ReviewStep: React.FC = () => {
  const { t } = useI18n()
  const {
    getValues,
    register,
    formState: { errors },
  } = useFormContext<WaiverFormInput>()

  const { personalInfo, emergencyContact, medicalInformation, legalConfirmation } =
    getValues() as WaiverFormData
  const yesNo = (value: boolean | undefined) => (value ? t('common.yes') : t('common.no'))
  const notProvided = t('review.notProvided')
  const detailsMissing = t('common.missingDetails')
  const notAnswered = t('common.notAnswered')

  return (
    <div className="space-y-6">
      <SectionCard title={t('review.sections.personalInformation')}>
        <div className="grid gap-4 md:grid-cols-2">
          <ReviewRow label={t('review.fields.firstName')} emptyText={notProvided} value={personalInfo.firstName} />
          <ReviewRow label={t('review.fields.lastName')} emptyText={notProvided} value={personalInfo.lastName} />
          <ReviewRow label={t('review.fields.dateOfBirth')} emptyText={notProvided} value={personalInfo.dateOfBirth} />
          <ReviewRow label={t('review.fields.addressLine1')} emptyText={notProvided} value={personalInfo.addressLine1} />
          <ReviewRow label={t('review.fields.addressLine2')} emptyText={notProvided} value={personalInfo.addressLine2} />
          <ReviewRow label={t('review.fields.city')} emptyText={notProvided} value={personalInfo.city} />
          <ReviewRow label={t('review.fields.state')} emptyText={notProvided} value={personalInfo.state} />
          <ReviewRow label={t('review.fields.postalCode')} emptyText={notProvided} value={personalInfo.postalCode} />
          <ReviewRow label={t('review.fields.email')} emptyText={notProvided} value={personalInfo.email} />
          <ReviewRow label={t('review.fields.phone')} emptyText={notProvided} value={personalInfo.phone} />
        </div>
      </SectionCard>

      <SectionCard title={t('review.sections.emergencyContact')}>
        <div className="grid gap-4 md:grid-cols-2">
          <ReviewRow label={t('review.fields.name')} emptyText={notProvided} value={emergencyContact.name} />
          <ReviewRow label={t('review.fields.relationship')} emptyText={notProvided} value={emergencyContact.relationship} />
          <ReviewRow label={t('review.fields.phone')} emptyText={notProvided} value={emergencyContact.phone} />
          <ReviewRow label={t('review.fields.email')} emptyText={notProvided} value={emergencyContact.email} />
        </div>
      </SectionCard>

      <SectionCard title={t('review.sections.medicalOverview')}>
        <div className="grid gap-4 md:grid-cols-2">
          <ReviewRow label={t('review.fields.heartDisease')} emptyText={notProvided} value={yesNo(medicalInformation.heartDisease)} />
          <ReviewRow label={t('review.fields.shortnessOfBreath')} emptyText={notProvided} value={yesNo(medicalInformation.shortnessOfBreath)} />
          <ReviewRow label={t('review.fields.highBloodPressure')} emptyText={notProvided} value={yesNo(medicalInformation.highBloodPressure)} />
          <ReviewRow label={t('review.fields.smoking')} emptyText={notProvided} value={yesNo(medicalInformation.smoking)} />
          <ReviewRow label={t('review.fields.diabetes')} emptyText={notProvided} value={yesNo(medicalInformation.diabetes)} />
          <ReviewRow label={t('review.fields.familyHistory')} emptyText={notProvided} value={yesNo(medicalInformation.familyHistory)} />
          <ReviewRow label={t('review.fields.workouts')} emptyText={notProvided} value={yesNo(medicalInformation.workouts)} />
          <ReviewRow label={t('review.fields.medication')} emptyText={notProvided} value={yesNo(medicalInformation.medication)} />
          <ReviewRow label={t('review.fields.alcohol')} emptyText={notProvided} value={yesNo(medicalInformation.alcohol)} />
          <ReviewRow label={t('review.fields.lastPhysical')} emptyText={notProvided} value={medicalInformation.lastPhysical} />
          <ReviewRow label={t('review.fields.exerciseRestriction')} emptyText={notProvided} value={medicalInformation.exerciseRestriction} />
        </div>

        <div className="mt-6 space-y-2 rounded-xl border border-brand-outline/30 bg-brand-surface-variant/60 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary">{t('review.sections.injuries')}</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <ReviewRow label={t('review.fields.knees')} emptyText={notProvided} value={yesNo(medicalInformation.injuries.knees)} />
            <ReviewRow label={t('review.fields.lowerBack')} emptyText={notProvided} value={yesNo(medicalInformation.injuries.lowerBack)} />
            <ReviewRow label={t('review.fields.neckShoulders')} emptyText={notProvided} value={yesNo(medicalInformation.injuries.neckShoulders)} />
            <ReviewRow label={t('review.fields.hipPelvis')} emptyText={notProvided} value={yesNo(medicalInformation.injuries.hipPelvis)} />
            <ReviewRow
              label={t('review.fields.otherInjury')}
              emptyText={notProvided}
              value={
                medicalInformation.injuries.other.has
                  ? medicalInformation.injuries.other.details || detailsMissing
                  : t('common.no')
              }
            />
          </div>
        </div>

        <div className="mt-6 space-y-2 rounded-xl border border-brand-outline/30 bg-brand-surface-variant/40 p-4">
          <ReviewRow
            label={t('review.fields.recentInjury')}
            emptyText={notProvided}
            value={medicalInformation.hadRecentInjury === 'yes' ? t('common.yes') : t('common.no')}
          />
          {medicalInformation.hadRecentInjury === 'yes' && (
            <div className="grid gap-2 md:grid-cols-2">
              <ReviewRow label={t('review.fields.injuryDetails')} emptyText={notProvided} value={medicalInformation.injuryDetails} />
              <ReviewRow
                label={t('review.fields.physicianCleared')}
                emptyText={notProvided}
                value={medicalInformation.physicianCleared ?? notAnswered}
              />
              <ReviewRow label={t('review.fields.clearanceNotes')} emptyText={notProvided} value={medicalInformation.clearanceNotes} />
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t('review.sections.legalConfirmation')}>
        <div className="grid gap-4 md:grid-cols-2">
          <ReviewRow label={t('review.fields.riskInitials')} emptyText={notProvided} value={legalConfirmation.riskInitials} />
          <ReviewRow label={t('review.fields.releaseInitials')} emptyText={notProvided} value={legalConfirmation.releaseInitials} />
          <ReviewRow label={t('review.fields.indemnificationInitials')} emptyText={notProvided} value={legalConfirmation.indemnificationInitials} />
          <ReviewRow label={t('review.fields.mediaInitials')} emptyText={notProvided} value={legalConfirmation.mediaInitials} />
        </div>
        <div className="mt-4 space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-secondary">{t('review.fields.signature')}</span>
          {legalConfirmation.signature.pngDataUrl ? (
            <div className="rounded-xl border border-brand-outline/30 bg-brand-surface p-3 shadow-sm">
              <img
                src={legalConfirmation.signature.pngDataUrl}
                alt={t('review.signaturePreviewAlt')}
                className="h-32 w-full object-contain"
              />
            </div>
          ) : (
            <p className="text-sm text-brand-secondary/70 italic">{t('review.signatureMissing')}</p>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <label className="flex items-start gap-3 text-sm font-medium text-brand-on-surface">
          <input
            type="checkbox"
            className={checkboxClasses}
            {...register('review.confirmAccuracy', { required: true })}
          />
          <span>
            {t('review.confirmAccuracy')}
          </span>
        </label>
        {errors.review?.confirmAccuracy && (
          <p className="mt-2 text-xs font-medium text-brand-error">
            {errors.review.confirmAccuracy.message as string}
          </p>
        )}
      </SectionCard>
    </div>
  )
}

