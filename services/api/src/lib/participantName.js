/**
 * participants.full_name is the stored canonical name.
 * Admin placeholder/enrollment APIs speak first_name + last_name.
 */

export function splitParticipantName(fullName) {
  const trimmed = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) return { first_name: '', last_name: '' };
  const space = trimmed.indexOf(' ');
  if (space === -1) return { first_name: trimmed, last_name: '' };
  return {
    first_name: trimmed.slice(0, space),
    last_name: trimmed.slice(space + 1),
  };
}

export function joinParticipantName(firstName, lastName) {
  return `${String(firstName || '').trim()} ${String(lastName || '').trim()}`
    .trim()
    .replace(/\s+/g, ' ');
}
