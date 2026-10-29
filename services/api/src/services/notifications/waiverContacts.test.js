import { describe, expect, it } from 'vitest';
import { buildContactFiles, buildVCard, escapeVCard, foldVCardLine } from './waiverContacts.js';

const student = { full_name: 'John Smith', phone: '5551234567', email: 'john@tu-test.invalid' };
const guardian = { name: 'Jane Smith', phone: '5559876543', email: 'jane@tu-test.invalid', relationship: 'Mother' };
const unfold = (text) => text.replace(/\r\n /g, '');
describe('vCard 3.0 contacts', () => {
  it('generates separate, labeled student and guardian contacts with their own details', () => {
    const files = buildContactFiles(student, [guardian]);
    expect(files.map(f => f.filename)).toEqual(['John_Smith_Student.vcf', 'Jane_Smith_Guardian.vcf']);
    expect(unfold(files[0].data)).toContain('FN:John Smith\r\nN:John Smith;;;;\r\nORG:Temple Underground');
    expect(files[0].data).toContain('ROLE:Student\r\nTEL;TYPE=CELL:5551234567');
    expect(files[0].data).not.toContain('5559876543');
    expect(files[1].data).toContain('ROLE:Parent / Guardian');
    expect(unfold(files[1].data)).toContain('NOTE:Temple Underground — Guardian of John Smith (Mother)');
    expect(files[1].data).not.toContain('john@');
  });
  it('keeps a useful name-only student contact without copying guardian details', () => {
    const files = buildContactFiles({ full_name: 'John Smith' }, [guardian]);
    expect(files[0].data).not.toMatch(/TEL|EMAIL/);
    expect(files[1].data).toContain('5559876543');
    expect(buildContactFiles({}, [{ phone: '5559876543' }])).toEqual([]);
  });
  it('supports separate contacts in the generator without merging shared household phones', () => {
    const files = buildContactFiles(student, [guardian, { ...guardian, name: 'Jim Smith', relationship: 'Father' }]);
    expect(files).toHaveLength(3);
    expect(files[2].filename).toBe('Jim_Smith_Guardian.vcf');
  });
  it('deduplicates identical people, retains distinct details, and disambiguates filenames', () => {
    expect(buildContactFiles(student, [guardian, guardian])).toHaveLength(2);
    expect(buildContactFiles(student, [{ name: student.full_name, phone: student.phone, email: student.email, relationship: 'Guardian' }])).toHaveLength(1);
    const files = buildContactFiles(student, [guardian, { ...guardian, phone: '5550000000' }]);
    expect(files.map(f => f.filename)).toEqual(['John_Smith_Student.vcf', 'Jane_Smith_Guardian.vcf', 'Jane_Smith_Guardian_2.vcf']);
  });
  it('escapes text and blocks injected vCard properties', () => {
    expect(escapeVCard('A,B;C\\D\r\nE')).toBe('A\\,B\\;C\\\\D\\nE');
    expect(escapeVCard('Name\u0000')).toBe('Name');
    const card = buildVCard({ name: 'Name\r\nNOTE:injected', role: 'Student', phone: '123\nURL:bad' }, 'Name');
    expect(card).not.toContain('\r\nNOTE:injected');
    expect(card).not.toContain('\r\nURL:bad');
  });
  it('folds Unicode at 75 octets without splitting characters, uses CRLF, and preserves text', () => {
    const name = 'José 李😀'.repeat(40);
    const line = `FN:${name}`;
    expect(unfold(foldVCardLine(line))).toBe(line);
    expect(foldVCardLine(line).split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
    const files = buildContactFiles({ full_name: name });
    expect(unfold(files[0].data)).toContain(`FN:${name}`);
    expect(files[0].data.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(files[0].data.endsWith('END:VCARD\r\n')).toBe(true);
    expect(Buffer.byteLength(files[0].filename)).toBeLessThan(140);
    expect(files[0].data).not.toContain('\uFFFD');
  });
  it('sanitizes path characters in names and filenames', () => {
    const files = buildContactFiles({ full_name: '../../John <Smith>\r\n/\\' });
    expect(files[0].filename).toBe('John_Smith_Student.vcf');
    expect(files[0].filename).not.toMatch(/[<>/:\\\r\n]/);
  });
  it('does not serialize identifiers, medical information, or unapproved contact properties', () => {
    const files = buildContactFiles({ ...student, id: 'PRIVATE_ID', medical: 'PRIVATE_MEDICAL', waiverId: 'PRIVATE_WAIVER' }, [{ ...guardian, injury_details: 'PRIVATE_INJURY', notes: 'PRIVATE_NOTES' }]);
    expect(files.map(f => f.data).join('')).not.toContain('PRIVATE');
  });
  it('labels unconfirmed guardians as emergency contacts', () => {
    expect(buildContactFiles(student, [{ ...guardian, relationship: 'Sister' }])[1].filename).toBe('Jane_Smith_Emergency_Contact.vcf');
  });
});
