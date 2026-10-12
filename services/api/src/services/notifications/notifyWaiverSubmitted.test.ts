import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWaiverNotifier, buildWaiverSubmittedNotification } from './notifyWaiverSubmitted.js';
import { medicalDisclosureStatus } from './waiverSummary.js';
import { discordPayload, sendDiscordNotification } from './sendDiscordNotification.js';

const student = { full_name: 'John Smith', phone: '5551234567', email: 'john@tu-test.invalid' };
const guardian = { name: 'Jane Smith', relationship: 'Mother', phone: '5559876543', email: 'jane@tu-test.invalid' };
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const negativeMedical = () => ({
  heart_disease: false, shortness_of_breath: false, high_blood_pressure: false,
  smoking: false, diabetes: false, family_history: false, medication: false, alcohol: false,
  injuries: { knees: false, lower_back: false, neck_shoulders: false, hip_pelvis: false, other: { has: false } },
  had_recent_injury: 'no',
});

describe('operator summary', () => {
  it('shows adult identity and optional contacts without metadata or timestamp', () => {
    const message = buildWaiverSubmittedNotification({ participant: student });
    const payload = discordPayload(message);
    expect(message.fields[0]).toEqual({ name: 'Student', value: expect.stringContaining('John Smith') });
    expect(JSON.stringify(payload)).not.toMatch(/Submission Time|Waiver ID|Admin Reference|timestamp/);
    expect(message.fields).toHaveLength(2);
    expect(buildWaiverSubmittedNotification({ participant: { full_name: 'John Smith' } }).fields[0].value).not.toMatch(/Phone|Email/);
  });
  it('separates minor guardians and never infers guardianship from an emergency contact', () => {
    const message = buildWaiverSubmittedNotification({ participant: { ...student, date_of_birth: '2015-01-01' }, emergencyContacts: [guardian, { ...guardian, name: 'Jim Smith', relationship: 'Father' }, { ...guardian, relationship: 'Friend' }] });
    expect(message.fields.map(f => f.name)).toEqual(['Student', 'Parent / Guardian', 'Parent / Guardian', 'Emergency Contact', 'Medical & Injury Information']);
    expect(message.fields[1].value).toContain('Mother');
    expect(JSON.stringify(message)).not.toContain('2015-01-01');
  });
  it.each([
    { injuries: { knees: true } },
    { had_recent_injury: 'yes', injury_details: 'PRIVATE recent injury' },
    { heart_disease: true },
    { exercise_restriction: 'PRIVATE restriction' },
    { injuries: { other: { details: 'PRIVATE '.repeat(2000) } } },
    { clearance_notes: 'PRIVATE precaution' },
  ])('reports disclosure presence without leaking medical wording %j', medicalInformation => {
    const message = buildWaiverSubmittedNotification({ participant: student, medicalInformation });
    expect(message.fields.at(-1)?.value).toContain('disclosure present');
    expect(JSON.stringify(message)).not.toContain('PRIVATE');
  });
  it('distinguishes explicit negative answers, partial answers, and missing information', () => {
    expect(medicalDisclosureStatus(negativeMedical())).toContain('Explicit negative');
    expect(medicalDisclosureStatus({ heart_disease: false })).toContain('some information not provided');
    expect(medicalDisclosureStatus(undefined)).toBe('Information not provided.');
    expect(medicalDisclosureStatus({})).toBe('Information not provided.');
  });
  it('escapes mentions and formatting and limits the whole embed', () => {
    const message = buildWaiverSubmittedNotification({ participant: { full_name: '@everyone <@123> **Name** [x](https://bad.invalid)' } });
    expect(message.fields[0].value).not.toContain('@everyone');
    expect(message.fields[0].value).toContain('\\*');
    const payload = discordPayload({ title: 't'.repeat(1000), footerText: 'f'.repeat(5000), fields: Array.from({ length: 30 }, () => ({ name: 'n'.repeat(300), value: 'v'.repeat(5000) })) });
    const embed = payload.embeds[0];
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    expect(embed.fields.every(f => f.value.length <= 1024 && f.name.length <= 256)).toBe(true);
    expect(embed.title.length + (embed.footer?.text.length ?? 0) + embed.fields.reduce((n,f) => n + f.name.length + f.value.length, 0)).toBeLessThanOrEqual(6000);
    expect(payload.allowed_mentions.parse).toEqual([]);
  });
});

describe('two-message delivery', () => {
  const configure = () => { vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.invalid/webhook?thread_id=123'); vi.stubEnv('SLACK_WEBHOOK_URL', ''); };
  const args = () => ({ waiverId: 'persisted-test-waiver', participantId: 'test-person', participant: student, emergencyContacts: [guardian], logger: logger() });
  it('sends summary then multipart contact files, requests server confirmation, and skips duplicates', async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const notify = createWaiverNotifier();
    const results = await notify(args());
    expect(results).toEqual([{ provider: 'discord', part: 'summary', ok: true }, { provider: 'discord', part: 'contacts', ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('thread_id=123&wait=true');
    const form = fetchMock.mock.calls[1][1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('files[0]')).toBeInstanceOf(Blob);
    expect(await (form.get('files[1]') as Blob).text()).toContain('Guardian of John Smith');
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
    expect((await notify(args())).every(r => r.skipped)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([0, 1])('retries only the failed message when part %i fails', async failedPart => {
    configure(); let n = 0;
    const fetchMock = vi.fn(async () => new Response('PRIVATE_RESPONSE', { status: n++ === failedPart ? 500 : 200 }));
    vi.stubGlobal('fetch', fetchMock); const notify = createWaiverNotifier(); const input = args();
    const first = await notify(input); expect(first[failedPart].ok).toBe(false);
    expect(first[1 - failedPart].ok).toBe(true);
    const retry = await notify(input); expect(retry.every(r => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(input.logger.error.mock.calls)).not.toContain('PRIVATE_RESPONSE');
  });
  it('coalesces concurrent duplicate events', async () => {
    configure(); const fetchMock = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const notify = createWaiverNotifier(); await Promise.all([notify(args()), notify(args()), notify(args())]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('preserves Slack layout and isolates its failures', async () => {
    configure(); vi.stubEnv('SLACK_WEBHOOK_URL', 'https://slack.invalid/webhook');
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    await createWaiverNotifier()(args());
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string).text).toContain('Waiver ID: persisted-test-waiver');
  });
  it('requires a persisted identity and bounds receipt capacity', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const notify = createWaiverNotifier({ maxEntries: 1 });
    await expect(notify({ ...args(), waiverId: '' })).rejects.toThrow('persisted_waiver_id_required');
    await notify(args()); expect((await notify({ ...args(), waiverId: 'another' }))[0].error).toBe('delivery_capacity_exceeded');
  });
});

describe('Discord transport failure handling', () => {
  it('honors explicit rate limits then retries multipart delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0.001 }), { status: 429 })).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await sendDiscordNotification('https://discord.invalid/webhook', { title: 'Contacts', fields: [] }, { files: [{ filename: 'John.vcf', data: 'BEGIN:VCARD\r\nEND:VCARD' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(FormData);
  });
  it('does not shorten long rate limits or retry ambiguous errors', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ retry_after: 60 }), { status: 429 })); vi.stubGlobal('fetch', fetchMock);
    await expect(sendDiscordNotification('https://discord.invalid/webhook', { title: 'Test' })).rejects.toThrow('discord_rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error('https://secret.invalid/private-token'));
    await expect(sendDiscordNotification('https://discord.invalid/webhook', { title: 'Test' })).rejects.toThrow('discord_network_error');
  });
  it('times out without logging raw errors', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('PRIVATE'))))));
    await expect(sendDiscordNotification('https://discord.invalid/webhook', { title: 'Test' }, { timeoutMs: 5 })).rejects.toThrow('discord_timeout');
  });
});
