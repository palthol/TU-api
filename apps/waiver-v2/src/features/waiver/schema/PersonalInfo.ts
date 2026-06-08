import { z } from 'zod'
import type { Translate } from './common'

export const createPersonalInfoSchema = (t: Translate) =>
  z.object({
    firstName: z.string().trim().min(2, t('validation.firstNameMin')),
    lastName: z.string().trim().min(2, t('validation.lastNameMin')),
    dateOfBirth: z.string().trim().min(1, t('validation.required')),
    addressLine1: z.string().trim().optional().default(''),
    addressLine2: z.string().trim().optional().default(''),
    city: z.string().trim().optional().default(''),
    state: z.string().trim().optional().default(''),
    postalCode: z.string().trim().optional().default(''),
    email: z.string().email(t('validation.email')),
    phone: z.string().trim().min(1, t('validation.required')),
  })


