// Accept only the existing participant/emergency-contact shapes. No guardian
// phone fallback: the waiver contract does not establish shared-phone ownership.
export const contactText = (value) => typeof value === 'string' ? value.trim() : '';

export function contactRole(relationship) {
  return /^(parent|mother|father|mom|dad|guardian|legal guardian|madre|padre|tutor|tutora)$/i.test(contactText(relationship))
    ? 'Guardian' : 'Emergency Contact';
}

export function waiverContacts(participant, emergencyContacts = []) {
  const student = {
    name: contactText(participant?.full_name),
    phone: contactText(participant?.phone),
    email: contactText(participant?.email),
    role: 'Student',
  };
  const contacts = student.name ? [student] : [];
  for (const row of emergencyContacts) {
    const contact = {
      name: contactText(row?.name), phone: contactText(row?.phone),
      email: contactText(row?.email), relationship: contactText(row?.relationship),
      role: contactRole(row?.relationship),
    };
    if (!contact.name) continue;
    // A shared household phone/email alone does not establish same identity.
    const duplicate = contacts.some((existing) =>
      existing.name.toLocaleLowerCase() === contact.name.toLocaleLowerCase() &&
      existing.phone === contact.phone && existing.email.toLowerCase() === contact.email.toLowerCase());
    if (!duplicate) contacts.push(contact);
  }
  return contacts;
}

export const escapeVCard = (value) => contactText(value)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
  .replace(/;/g, '\\;').replace(/,/g, '\\,');

// Fold at 75 UTF-8 octets, including the continuation space. Iterate code
// points so a multibyte Unicode character is never split.
export function foldVCardLine(line) {
  const lines = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 75) {
      lines.push(current);
      current = ' ';
    }
    current += char;
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function buildVCard(contact, studentName) {
  const e = escapeVCard;
  const lines = [
    'BEGIN:VCARD', 'VERSION:3.0', `FN:${e(contact.name)}`,
    // Do not guess cultural first/family name boundaries.
    `N:${e(contact.name)};;;;`, 'ORG:Temple Underground',
    `ROLE:${e(contact.role === 'Guardian' ? 'Parent / Guardian' : contact.role)}`,
  ];
  if (contact.phone) lines.push(`TEL;TYPE=CELL:${e(contact.phone)}`);
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${e(contact.email)}`);
  const note = contact.role === 'Student' ? 'Temple Underground — Student'
    : `Temple Underground — ${contact.role === 'Guardian' ? 'Guardian of' : 'Emergency contact for'} ${studentName}${contact.relationship ? ` (${contact.relationship})` : ''}`;
  lines.push(`NOTE:${e(note)}`, 'END:VCARD');
  return lines.map(foldVCardLine).join('\r\n') + '\r\n';
}

export function buildContactFiles(participant, emergencyContacts = []) {
  const used = new Set();
  return waiverContacts(participant, emergencyContacts).map((contact) => {
    const stem = contact.name.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
    // Bound bytes in multipart filenames, retain Unicode without path characters.
    let safe = '';
    for (const char of stem) {
      if (Buffer.byteLength(safe + char) > 100) break;
      safe += char;
    }
    const base = `${safe || 'Contact'}_${contact.role.replaceAll(' ', '_')}`;
    let filename = `${base}.vcf`;
    for (let n = 2; used.has(filename.toLowerCase()); n++) filename = `${base}_${n}.vcf`;
    used.add(filename.toLowerCase());
    return { filename, role: contact.role, data: buildVCard(contact, contactText(participant?.full_name)) };
  });
}
