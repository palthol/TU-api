import { contactRole, contactText } from './waiverContacts.js';

export const discordText = (value) => contactText(value)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/@/g, '@\u200b').replace(/([\\`*_{}\[\]()<>~|#+.!-])/g, '\\$1');

const negative = (v) => v === false || v === 'no';
const positive = (v) => v === true || v === 'yes';

// This intentionally reports disclosure presence only. Repository consent does
// not establish permission to publish medical details to Discord.
export function medicalDisclosureStatus(medical) {
  if (!medical || typeof medical !== 'object') return 'Information not provided.';
  const injuries = medical.injuries ?? {};
  const flags = [medical.heart_disease, medical.shortness_of_breath, medical.high_blood_pressure,
    medical.smoking, medical.diabetes, medical.family_history, medical.medication, medical.alcohol,
    injuries.knees, injuries.lower_back, injuries.neck_shoulders, injuries.hip_pelvis,
    injuries.other?.has, medical.had_recent_injury];
  const text = [medical.exercise_restriction, medical.injury_details, injuries.other?.details, medical.clearance_notes];
  if (flags.some(positive) || medical.physician_cleared === 'no' || text.some(contactText)) {
    return 'Medical or injury disclosure present. Review the signed waiver before training.';
  }
  if (flags.every(negative)) return 'Explicit negative answers to condition and injury questions; no condition or injury disclosed.';
  if (flags.some(negative)) return 'No condition or injury disclosed in supplied answers; some information not provided.';
  return 'Information not provided.';
}

const identity = (contact, nameKey) => [
  contactText(contact?.[nameKey]) ? `Name: ${discordText(contact[nameKey])}` : 'Name not provided',
  ...(contactText(contact?.relationship) ? [`Relationship: ${discordText(contact.relationship)}`] : []),
  ...(contactText(contact?.phone) ? [`Phone: ${discordText(contact.phone)}`] : []),
  ...(contactText(contact?.email) ? [`Email: ${discordText(contact.email)}`] : []),
].join('\n');

export function buildWaiverSubmittedNotification({ participant, emergencyContacts = [], medicalInformation }) {
  return {
    title: 'New Waiver Submitted',
    fields: [
      { name: 'Student', value: identity(participant, 'full_name') },
      ...emergencyContacts.filter((c) => [c?.name, c?.relationship, c?.phone, c?.email].some(contactText)).map((c) => ({
        name: contactRole(c.relationship) === 'Guardian' ? 'Parent / Guardian' : 'Emergency Contact',
        value: identity(c, 'name'),
      })),
      { name: 'Medical & Injury Information', value: medicalDisclosureStatus(medicalInformation) },
    ],
    footerText: 'Authorized staff: open the existing waiver viewer or admin waiver list, find the student, and review the signed waiver. Discord is an operational summary.',
  };
}
