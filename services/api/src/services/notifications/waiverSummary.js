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
    return 'Disclosure present — review the signed waiver before training.';
  }
  if (flags.every(negative)) return 'Explicit negative answers to condition and injury questions; no condition or injury disclosed.';
  if (flags.some(negative)) return 'No condition or injury disclosed in supplied answers; some information not provided.';
  return 'Information not provided.';
}

const identity = (contact, nameKey) => [
  contactText(contact?.[nameKey]) ? discordText(contact[nameKey]) : 'Name not provided',
  ...(contactText(contact?.phone) ? [discordText(contact.phone)] : []),
  ...(contactText(contact?.email) ? [discordText(contact.email)] : []),
].join('\n');

const contactHeading = (contact) => {
  const role = contactRole(contact.relationship) === 'Guardian' ? 'Parent / Guardian' : 'Emergency Contact';
  return contactText(contact.relationship) ? `${role} · ${discordText(contact.relationship)}` : role;
};

// Discord trims trailing blank lines in embed fields; a zero-width line survives
// and separates each section from the next heading.
const SECTION_GAP = '\n\u200b';

export function buildWaiverSubmittedNotification({ participant, emergencyContacts = [], medicalInformation }) {
  const studentName = contactText(participant?.full_name);
  return {
    title: studentName ? `New Waiver — ${discordText(studentName)}` : 'New Waiver Submitted',
    fields: [
      { name: 'Student', value: identity(participant, 'full_name') + SECTION_GAP },
      ...emergencyContacts.filter((c) => [c?.name, c?.relationship, c?.phone, c?.email].some(contactText)).map((c) => ({
        name: contactHeading(c),
        value: identity(c, 'name') + SECTION_GAP,
      })),
      { name: 'Medical & Injury', value: medicalDisclosureStatus(medicalInformation) + SECTION_GAP },
    ],
    footerText: 'Staff only · Full waiver in the waiver viewer',
  };
}
