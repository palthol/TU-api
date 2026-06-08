import React from 'react'
import { useController, useFormContext } from 'react-hook-form'
import type { WaiverFormInput } from '../../hooks/useWaiverForm'
import { useI18n } from '../../../../shared/i18n/I18nProvider'
import { SectionCard } from '../common/SectionCard'
import { Field, inputBaseClasses } from '../common/Field'
import { Button } from '../../../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/popover'
import { Calendar } from '../../../../components/ui/calendar'
import { cn } from '../../../../lib/utils'
import { enUS, es } from 'react-day-picker/locale'

const parseIsoDate = (value: string | undefined) => {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

const toIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const DOB_DEFAULT_MONTH = new Date(2000, 0, 1)

export const PersonalInfoStep: React.FC = () => {
  const { t, locale } = useI18n()
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<WaiverFormInput>()
  const [dobOpen, setDobOpen] = React.useState(false)

  const field = (path: keyof WaiverFormInput['personalInfo']) => `personalInfo.${path}` as const
  const errorMessage = (path: keyof WaiverFormInput['personalInfo']) => errors.personalInfo?.[path]?.message
  const { field: dobField } = useController({
    name: field('dateOfBirth'),
    control,
  })
  const selectedDob = React.useMemo(() => parseIsoDate(dobField.value), [dobField.value])
  const dobLocale = locale === 'es' ? es : enUS
  const dobLocaleCode = locale === 'es' ? 'es-ES' : 'en-US'
  const dobLabel = selectedDob
    ? new Intl.DateTimeFormat(dobLocaleCode, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(selectedDob)
    : t('personalInfo.fields.dateOfBirth')

  return (
    <div className="space-y-6">
      <SectionCard
        title={t('personalInfo.title')}
        subtitle={t('personalInfo.description')}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Field label={t('personalInfo.fields.firstName')} required error={errorMessage('firstName') || undefined}>
            <input type="text" className={inputBaseClasses} autoComplete="given-name" {...register(field('firstName'))} />
          </Field>
          <Field label={t('personalInfo.fields.lastName')} required error={errorMessage('lastName') || undefined}>
            <input type="text" className={inputBaseClasses} autoComplete="family-name" {...register(field('lastName'))} />
          </Field>
          <Field
            label={t('personalInfo.fields.dateOfBirth')}
            required
            error={errorMessage('dateOfBirth') || undefined}
          >
            <Popover open={dobOpen} onOpenChange={setDobOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'mt-2 w-full justify-start rounded-lg px-3 py-2 text-left normal-case tracking-normal whitespace-normal font-normal leading-5',
                    selectedDob ? 'text-brand-on-surface' : 'text-brand-secondary/70',
                  )}
                >
                  {dobLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={selectedDob}
                  defaultMonth={selectedDob ?? DOB_DEFAULT_MONTH}
                  onSelect={(date) => {
                    if (!date) return
                    dobField.onChange(toIsoDate(date))
                    setDobOpen(false)
                  }}
                  locale={dobLocale}
                  captionLayout="dropdown"
                  startMonth={new Date(1900, 0)}
                  endMonth={new Date()}
                  disabled={{ after: new Date() }}
                />
              </PopoverContent>
            </Popover>
          </Field>
          <Field
            label={t('personalInfo.fields.addressLine1')}
            required
            error={errorMessage('addressLine1') || undefined}
          >
            <input type="text" className={inputBaseClasses} {...register(field('addressLine1'))} />
          </Field>
          <Field label={t('personalInfo.fields.addressLine2')} error={errorMessage('addressLine2') || undefined}>
            <input type="text" className={inputBaseClasses} {...register(field('addressLine2'))} />
          </Field>
          <Field label={t('personalInfo.fields.city')} required error={errorMessage('city') || undefined}>
            <input type="text" className={inputBaseClasses} {...register(field('city'))} />
          </Field>
          <Field label={t('personalInfo.fields.state')} required error={errorMessage('state') || undefined}>
            <input type="text" className={inputBaseClasses} {...register(field('state'))} />
          </Field>
          <Field label={t('personalInfo.fields.postalCode')} required error={errorMessage('postalCode') || undefined}>
            <input type="text" className={inputBaseClasses} {...register(field('postalCode'))} />
          </Field>
          <Field label={t('personalInfo.fields.email')} required error={errorMessage('email') || undefined}>
            <input type="email" className={inputBaseClasses} {...register(field('email'))} />
          </Field>
          <Field label={t('personalInfo.fields.phone')} required error={errorMessage('phone') || undefined}>
            <input type="tel" className={inputBaseClasses} {...register(field('phone'))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title={t('personalInfo.fields.emergency.section')}
        subtitle={t('personalInfo.fields.emergency.instructions')}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Field label={t('personalInfo.fields.emergency.name')}>
            <input type="text" className={inputBaseClasses} {...register('emergencyContact.name')} />
          </Field>
          <Field label={t('personalInfo.fields.emergency.relationship')}>
            <input type="text" className={inputBaseClasses} {...register('emergencyContact.relationship')} />
          </Field>
          <Field label={t('personalInfo.fields.emergency.phone')}>
            <input type="tel" className={inputBaseClasses} {...register('emergencyContact.phone')} />
          </Field>
          <Field label={t('personalInfo.fields.emergency.email')}>
            <input type="email" className={inputBaseClasses} {...register('emergencyContact.email')} />
          </Field>
        </div>
      </SectionCard>
    </div>
  )
}
