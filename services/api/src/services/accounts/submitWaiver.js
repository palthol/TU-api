import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createOrBindParticipantAccount } from './createOrBindParticipantAccount.js';
import { recordWaiverSubmittedEvent } from '../events/recordWaiverSubmittedEvent.js';
import { notifyWaiverSubmitted } from '../notifications/notifyWaiverSubmitted.js';
import { exposeSupabaseError } from '../../lib/exposeSupabaseError.js';

export const WAIVER_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const DERIVED_IDEMPOTENCY_PREFIX = 'derived:v1:';

const normalizeString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const yesNoToBoolean = (value) => {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'yes') return true;
  if (lower === 'no') return false;
  return null;
};

const hasEmergencyContactDetails = (contact) => {
  if (!contact || typeof contact !== 'object') return false;
  return Boolean(
    normalizeString(contact.name) ||
      normalizeString(contact.relationship) ||
      normalizeString(contact.phone) ||
      normalizeString(contact.email),
  );
};

const buildMedicalHistoryPayload = (waiverId, medical) => {
  if (!medical || typeof medical !== 'object') return null;
  const injuries = medical.injuries && typeof medical.injuries === 'object' ? medical.injuries : {};
  const otherInjury = injuries.other && typeof injuries.other === 'object' ? injuries.other : {};
  const hadRecentInjury = yesNoToBoolean(medical.had_recent_injury);
  const physicianCleared = yesNoToBoolean(medical.physician_cleared);

  return {
    waiver_id: waiverId,
    heart_disease: Boolean(medical.heart_disease),
    shortness_of_breath: Boolean(medical.shortness_of_breath),
    high_blood_pressure: Boolean(medical.high_blood_pressure),
    smoking: Boolean(medical.smoking),
    diabetes: Boolean(medical.diabetes),
    family_history: Boolean(medical.family_history),
    workouts: Boolean(medical.workouts),
    medication: Boolean(medical.medication),
    alcohol: Boolean(medical.alcohol),
    last_physical: normalizeString(medical.last_physical),
    exercise_restriction: normalizeString(medical.exercise_restriction),
    injuries_knees: Boolean(injuries.knees),
    injuries_lower_back: Boolean(injuries.lower_back),
    injuries_neck_shoulders: Boolean(injuries.neck_shoulders),
    injuries_hip_pelvis: Boolean(injuries.hip_pelvis),
    injuries_other_has: Boolean(otherInjury.has),
    injuries_other_details: normalizeString(otherInjury.details),
    had_recent_injury: hadRecentInjury ?? false,
    injury_details: normalizeString(medical.injury_details),
    physician_cleared: physicianCleared,
    clearance_notes: normalizeString(medical.clearance_notes),
  };
};

export const summarizePayload = (body) => {
  if (!body || typeof body !== 'object') return { hasBody: false };
  const participant = body.participant && typeof body.participant === 'object' ? body.participant : null;
  const emergency = body.emergency_contact && typeof body.emergency_contact === 'object' ? body.emergency_contact : null;
  const medical = body.medical_information && typeof body.medical_information === 'object' ? body.medical_information : null;
  const legal = body.legal_confirmation && typeof body.legal_confirmation === 'object' ? body.legal_confirmation : null;
  const signature = body.signature && typeof body.signature === 'object' ? body.signature : null;
  const review = body.review && typeof body.review === 'object' ? body.review : null;

  return {
    participant: participant
      ? {
          full_name: Boolean(participant.full_name),
          date_of_birth: Boolean(participant.date_of_birth),
          email: Boolean(participant.email),
          phone: Boolean(participant.phone),
          address_line: Boolean(participant.address_line),
        }
      : null,
    emergency_contact: emergency
      ? {
          name: Boolean(emergency.name),
          relationship: Boolean(emergency.relationship),
          phone: Boolean(emergency.phone),
          email: Boolean(emergency.email),
        }
      : null,
    medical_information: medical
      ? {
          keys: Object.keys(medical).length,
          injuries: typeof medical.injuries === 'object' ? Object.keys(medical.injuries) : null,
        }
      : null,
    legal_confirmation: legal
      ? {
          accepted_terms: Boolean(legal.accepted_terms),
          risk_initials: Boolean(legal.risk_initials),
          release_initials: Boolean(legal.release_initials),
          indemnification_initials: Boolean(legal.indemnification_initials),
          media_initials: Boolean(legal.media_initials),
        }
      : null,
    signature: signature
      ? {
          pngDataUrl: Boolean(signature.pngDataUrl),
          vectorJsonLength: Array.isArray(signature.vectorJson) ? signature.vectorJson.length : undefined,
        }
      : null,
    review: review ? { confirm_accuracy: Boolean(review.confirm_accuracy) } : null,
    locale: typeof body.locale === 'string',
    content_version: typeof body.content_version === 'string',
    idempotency_key: typeof body.idempotency_key === 'string',
  };
};

export function validateParticipantFullName(fullName) {
  if (typeof fullName !== 'string' || !fullName.trim()) {
    return { error: { field: 'participant.full_name', messageKey: 'validation.required' } };
  }
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx <= 0) {
    return { error: { field: 'participant.full_name', messageKey: 'validation.invalid_name' } };
  }
  const firstName = trimmed.slice(0, spaceIdx).trim();
  const lastName = trimmed.slice(spaceIdx + 1).trim();
  if (firstName.length < 2 || lastName.length < 2) {
    return { error: { field: 'participant.full_name', messageKey: 'validation.invalid_name' } };
  }
  return { fullName: `${firstName} ${lastName}` };
}

export function parseClientIdempotencyKey(raw) {
  if (raw == null) return { key: null };
  if (typeof raw !== 'string') {
    return { error: { field: 'idempotency_key', messageKey: 'validation.invalid' } };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { key: null };
  if (trimmed.length > WAIVER_IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { error: { field: 'idempotency_key', messageKey: 'validation.invalid' } };
  }
  return { key: trimmed };
}

export function deriveWaiverIdempotencyKey({
  email,
  dateOfBirth,
  phone,
  contentVersion,
  signatureBytes,
}) {
  const signatureHash = crypto.createHash('sha256').update(signatureBytes).digest('hex');
  const material = [
    'waiver.submit.v1',
    String(email || '').trim().toLowerCase(),
    String(dateOfBirth || '').trim(),
    String(phone || '').trim(),
    String(contentVersion || '').trim(),
    signatureHash,
  ].join('|');
  return `${DERIVED_IDEMPOTENCY_PREFIX}${crypto.createHash('sha256').update(material).digest('hex')}`;
}

export function isUniqueViolation(error) {
  return Boolean(error && (error.code === '23505' || error.code === '409'));
}

export function isMissingIdempotencyColumn(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const blob = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return blob.includes('idempotency_key') && (blob.includes('column') || blob.includes('schema cache'));
}

const normalizeDob = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).trim().slice(0, 10);
};

const phonesMatch = (stored, submitted) => {
  const phone = String(submitted ?? '');
  return stored?.cell_phone === phone || stored?.home_phone === phone;
};

async function generateWaiverPdfBytes({ participant, locale, contentVersion, signatureBase64 }) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { height } = page.getSize();
  const fontSize = 12;
  page.drawText('Temple Underground — Health Assessment & Waiver', { x: 50, y: height - 50, size: 16, font });
  page.drawText(`Name: ${participant.full_name}`, { x: 50, y: height - 90, size: fontSize, font });
  page.drawText(`DOB: ${participant.date_of_birth}`, { x: 50, y: height - 110, size: fontSize, font });
  page.drawText(`Email: ${participant.email}`, { x: 50, y: height - 130, size: fontSize, font });
  page.drawText(`Locale: ${locale}  Content: ${contentVersion}`, { x: 50, y: height - 150, size: fontSize, font });

  try {
    const pngBytes = Buffer.from(signatureBase64, 'base64');
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pngDims = pngImage.scale(0.5);
    page.drawText('Signature:', { x: 50, y: height - 200, size: fontSize, font });
    page.drawImage(pngImage, { x: 120, y: height - 250, width: pngDims.width, height: pngDims.height });
  } catch (e) {
    console.error('Signature embed failed', e);
  }

  return pdfDoc.save();
}

async function findWaiverByIdempotencyKey(supabase, idempotencyKey) {
  const { data, error } = await supabase
    .from('waivers')
    .select('id, participant_id, signed_at_utc')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) return { error };
  return { waiver: data ?? null };
}

async function loadParticipantIdentity(supabase, participantId) {
  const { data, error } = await supabase
    .from('participants')
    .select('id, email, date_of_birth, cell_phone, home_phone')
    .eq('id', participantId)
    .maybeSingle();
  if (error) return { error };
  return { participant: data ?? null };
}

async function loadDocumentSha256(supabase, waiverId) {
  const { data, error } = await supabase
    .from('audit_trails')
    .select('document_sha256')
    .eq('waiver_id', waiverId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { error };
  return { sha256: data?.document_sha256 ?? null };
}

function participantIdentityMatches(stored, participant) {
  if (!stored) return false;
  const storedEmail = String(stored.email || '').trim().toLowerCase();
  const requestEmail = String(participant.email || '').trim().toLowerCase();
  if (storedEmail !== requestEmail) return false;
  if (normalizeDob(stored.date_of_birth) !== normalizeDob(participant.date_of_birth)) return false;
  return phonesMatch(stored, participant.phone);
}

async function replaySuccessfulSubmit({
  supabase,
  existingWaiver,
  participant,
  signatureBase64,
  locale,
  contentVersion,
}) {
  const identity = await loadParticipantIdentity(supabase, existingWaiver.participant_id);
  if (identity.error) {
    console.error('participants.replay_lookup error', JSON.stringify(identity.error, null, 2));
    return {
      status: 500,
      body: {
        ok: false,
        errors: [{ field: 'participant', messageKey: 'server.db_find_participant_failed' }],
        dbError: exposeSupabaseError(identity.error),
      },
    };
  }
  if (!participantIdentityMatches(identity.participant, participant)) {
    return {
      status: 409,
      body: { ok: false, error: 'idempotency_key_conflict' },
    };
  }

  let accountBinding;
  try {
    accountBinding = await createOrBindParticipantAccount({
      supabase,
      participantId: existingWaiver.participant_id,
      participant,
    });
  } catch (bindingError) {
    console.error('account.binding error', bindingError);
    return {
      status: 500,
      body: { ok: false, errors: [{ field: 'account', messageKey: 'server.db_bind_account_failed' }] },
    };
  }

  const audit = await loadDocumentSha256(supabase, existingWaiver.id);
  if (audit.error) {
    console.error('audit_trails.replay_lookup error', audit.error);
    return {
      status: 500,
      body: { ok: false, errors: [{ field: 'audit', messageKey: 'server.db_insert_audit_failed' }] },
    };
  }

  let sha256 = audit.sha256;
  if (!sha256 && signatureBase64) {
    const pdfBytes = await generateWaiverPdfBytes({
      participant,
      locale,
      contentVersion,
      signatureBase64,
    });
    sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  }

  console.info('waiver.submit.idempotent_replay', {
    waiverId: existingWaiver.id,
    participantId: existingWaiver.participant_id,
    accountId: accountBinding.accountId,
    notified: false,
  });

  return {
    status: 200,
    body: {
      ok: true,
      waiverId: existingWaiver.id,
      participantId: existingWaiver.participant_id,
      accountId: accountBinding.accountId,
      accountMemberId: accountBinding.accountMemberId,
      sha256,
    },
  };
}

async function persistRelatedRows({
  supabase,
  waiverId,
  participantId,
  emergencyContact,
  medicalInformation,
  documentPdfUrl,
  hash,
  identity_snapshot,
  locale,
  contentVersion,
}) {
  if (hasEmergencyContactDetails(emergencyContact)) {
    const emergencyPayload = {
      waiver_id: waiverId,
      participant_id: participantId,
      name: normalizeString(emergencyContact.name),
      relationship: normalizeString(emergencyContact.relationship),
      phone: normalizeString(emergencyContact.phone),
      email: normalizeString(emergencyContact.email),
    };
    const { error: ecErr } = await supabase.from('emergency_contacts').insert(emergencyPayload);
    if (ecErr && !isUniqueViolation(ecErr)) console.error('emergency_contacts.insert error', ecErr);
  }

  const medicalPayload = buildMedicalHistoryPayload(waiverId, medicalInformation);
  if (medicalPayload) {
    const { error: mhErr } = await supabase.from('waiver_medical_histories').insert(medicalPayload);
    if (mhErr && !isUniqueViolation(mhErr)) console.error('waiver_medical_histories.insert error', mhErr);
  }

  const { error: aErr } = await supabase.from('audit_trails').insert({
    participant_id: participantId,
    waiver_id: waiverId,
    document_pdf_url: documentPdfUrl,
    document_sha256: hash,
    identity_snapshot,
    locale,
    content_version: contentVersion,
  });
  if (aErr && !isUniqueViolation(aErr)) {
    console.error('audit_trails.insert error', aErr);
    return { error: aErr };
  }
  return { error: null };
}

function scheduleWaiverNotification({
  notify,
  waiverId,
  participantId,
  participant,
  submittedAt,
}) {
  try {
    void Promise.resolve(
      notify({
        waiverId,
        participantId,
        participant,
        submittedAt,
      }),
    ).catch((notificationError) => {
      const message = notificationError instanceof Error ? notificationError.message : String(notificationError);
      console.error('waiver.notification.unhandled_error', {
        eventName: 'waiver.submitted',
        waiverId,
        participantId,
        error: message,
      });
    });
  } catch (notificationError) {
    const message = notificationError instanceof Error ? notificationError.message : String(notificationError);
    console.error('waiver.notification.unhandled_error', {
      eventName: 'waiver.submitted',
      waiverId,
      participantId,
      error: message,
    });
  }
}

export async function handleWaiverSubmit(req, res, deps) {
  const {
    supabase,
    signaturesBucket,
    waiversBucket,
    notify = notifyWaiverSubmitted,
    recordEvent = recordWaiverSubmittedEvent,
  } = deps;

  try {
    console.log('waiver.submit payload summary', summarizePayload(req.body));
    const {
      participant,
      signature,
      emergency_contact: emergencyContact,
      medical_information: medicalInformation,
      legal_confirmation: legalConfirmation,
      review,
      locale = 'en',
      content_version = 'waiver.v1',
      idempotency_key: rawIdempotencyKey,
    } = req.body || {};
    const errors = [];
    const nameCheck = validateParticipantFullName(participant?.full_name);
    if (nameCheck.error) errors.push(nameCheck.error);
    const participantFullName = nameCheck.fullName;
    if (!participant?.date_of_birth) errors.push({ field: 'participant.date_of_birth', messageKey: 'validation.required' });
    if (!participant?.email) errors.push({ field: 'participant.email', messageKey: 'validation.required' });
    if (!participant?.phone) errors.push({ field: 'participant.phone', messageKey: 'validation.required' });
    if (!legalConfirmation?.accepted_terms) errors.push({ field: 'legal_confirmation.accepted_terms', messageKey: 'validation.required' });
    if (!legalConfirmation?.risk_initials) errors.push({ field: 'legal_confirmation.risk_initials', messageKey: 'validation.required' });
    if (!legalConfirmation?.release_initials) errors.push({ field: 'legal_confirmation.release_initials', messageKey: 'validation.required' });
    if (!legalConfirmation?.indemnification_initials)
      errors.push({ field: 'legal_confirmation.indemnification_initials', messageKey: 'validation.required' });
    if (!legalConfirmation?.media_initials) errors.push({ field: 'legal_confirmation.media_initials', messageKey: 'validation.required' });
    if (!signature?.pngDataUrl) errors.push({ field: 'signature', messageKey: 'validation.required' });
    const signatureBase64 =
      typeof signature?.pngDataUrl === 'string' && signature.pngDataUrl.includes(',')
        ? signature.pngDataUrl.split(',')[1]
        : null;
    if (!signatureBase64) errors.push({ field: 'signature.pngDataUrl', messageKey: 'validation.invalid' });
    const clientKey = parseClientIdempotencyKey(rawIdempotencyKey);
    if (clientKey.error) errors.push(clientKey.error);
    if (errors.length) return res.status(400).json({ ok: false, errors });
    participant.full_name = participantFullName;

    if (!supabase) {
      return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
    }

    const signatureBytes = Buffer.from(signatureBase64, 'base64');
    const idempotencyKey =
      clientKey.key ||
      deriveWaiverIdempotencyKey({
        email: participant.email,
        dateOfBirth: participant.date_of_birth,
        phone: participant.phone,
        contentVersion: content_version,
        signatureBytes,
      });

    const existing = await findWaiverByIdempotencyKey(supabase, idempotencyKey);
    if (existing.error && !isMissingIdempotencyColumn(existing.error)) {
      console.error('waivers.idempotency_lookup error', JSON.stringify(existing.error, null, 2));
      return res.status(500).json({
        ok: false,
        errors: [{ field: 'waiver', messageKey: 'server.db_insert_waiver_failed' }],
        dbError: exposeSupabaseError(existing.error),
      });
    }
    if (existing.waiver?.id) {
      const replay = await replaySuccessfulSubmit({
        supabase,
        existingWaiver: existing.waiver,
        participant,
        signatureBase64,
        locale,
        contentVersion: content_version,
      });
      return res.status(replay.status).json(replay.body);
    }

    let participantId;
    {
      const { data: existingParticipant, error: findErr } = await supabase
        .from('participants')
        .select('id, cell_phone, home_phone')
        .eq('email', participant.email)
        .eq('date_of_birth', participant.date_of_birth)
        .limit(1)
        .maybeSingle();
      if (findErr) {
        console.error('participants.find error', JSON.stringify(findErr, null, 2));
        return res.status(500).json({
          ok: false,
          errors: [{ field: 'participant', messageKey: 'server.db_find_participant_failed' }],
          dbError: exposeSupabaseError(findErr),
        });
      }
      const phone = String(participant.phone);
      if (
        existingParticipant?.id &&
        (existingParticipant.cell_phone === phone || existingParticipant.home_phone === phone)
      ) {
        participantId = existingParticipant.id;
      } else {
        const insertPayload = {
          full_name: participant.full_name,
          date_of_birth: participant.date_of_birth,
          email: participant.email,
          address_line: participant.address_line ?? null,
          city: participant.city ?? null,
          state: participant.state ?? null,
          zip: participant.zip ?? null,
          home_phone: null,
          cell_phone: phone,
        };
        const { data: inserted, error: insErr } = await supabase
          .from('participants')
          .insert(insertPayload)
          .select('id')
          .single();
        if (insErr) {
          console.error('participants.insert error', JSON.stringify(insErr, null, 2));
          return res.status(500).json({
            ok: false,
            errors: [{ field: 'participant', messageKey: 'server.db_insert_participant_failed' }],
            dbError: exposeSupabaseError(insErr),
          });
        }
        participantId = inserted.id;
      }
    }

    let accountBinding;
    try {
      accountBinding = await createOrBindParticipantAccount({
        supabase,
        participantId,
        participant,
      });
      console.info('account.binding outcome', {
        participantId,
        accountId: accountBinding.accountId,
        accountMemberId: accountBinding.accountMemberId,
        accountMemberRole: accountBinding.accountMemberRole,
        createdAccount: accountBinding.createdAccount,
        createdMembership: accountBinding.createdMembership,
      });
    } catch (bindingError) {
      console.error('account.binding error', bindingError);
      return res.status(500).json({
        ok: false,
        errors: [{ field: 'account', messageKey: 'server.db_bind_account_failed' }],
      });
    }

    const waiverId = crypto.randomUUID();
    const png = signatureBytes;
    const signatureBucket = signaturesBucket;
    const signatureKey = `${waiverId}.png`;
    {
      const { error: upErr } = await supabase.storage
        .from(signatureBucket)
        .upload(signatureKey, png, { contentType: 'image/png', upsert: true });
      if (upErr) console.error('Signature upload error', upErr);
    }
    const signatureImageUrl = `${signatureBucket}/${signatureKey}`;

    const pdfBytes = await generateWaiverPdfBytes({
      participant,
      locale,
      contentVersion: content_version,
      signatureBase64,
    });
    const hash = crypto.createHash('sha256').update(pdfBytes).digest('hex');

    const pdfBucket = waiversBucket;
    const pdfKey = `${waiverId}.pdf`;
    {
      const { error: pdfErr } = await supabase.storage
        .from(pdfBucket)
        .upload(pdfKey, pdfBytes, { contentType: 'application/pdf', upsert: true });
      if (pdfErr) console.error('PDF upload error', pdfErr);
    }
    const documentPdfUrl = `${pdfBucket}/${pdfKey}`;

    const waiverRow = {
      id: waiverId,
      participant_id: participantId,
      consent_acknowledged: Boolean(legalConfirmation?.accepted_terms),
      initials_risk_assumption: legalConfirmation?.risk_initials ?? null,
      initials_release: legalConfirmation?.release_initials ?? null,
      initials_indemnification: legalConfirmation?.indemnification_initials ?? null,
      initials_media_release: legalConfirmation?.media_initials ?? null,
      signature_image_url: signatureImageUrl,
      signature_vector_json: signature.vectorJson ?? [],
      review_confirm_accuracy: Boolean(review?.confirm_accuracy),
      idempotency_key: idempotencyKey,
    };

    let { data: insertedWaiver, error: wErr } = await supabase
      .from('waivers')
      .insert(waiverRow)
      .select('id, signed_at_utc')
      .single();

    if (isMissingIdempotencyColumn(wErr)) {
      console.warn('waiver.submit.idempotency_column_missing_fallback');
      const legacyRow = { ...waiverRow };
      delete legacyRow.idempotency_key;
      const retry = await supabase.from('waivers').insert(legacyRow).select('id, signed_at_utc').single();
      insertedWaiver = retry.data;
      wErr = retry.error;
    }

    if (isUniqueViolation(wErr)) {
      const raced = await findWaiverByIdempotencyKey(supabase, idempotencyKey);
      if (raced.error || !raced.waiver?.id) {
        console.error('waivers.insert unique replay lookup failed', raced.error || wErr);
        return res.status(500).json({ ok: false, errors: [{ field: 'waiver', messageKey: 'server.db_insert_waiver_failed' }] });
      }
      const replay = await replaySuccessfulSubmit({
        supabase,
        existingWaiver: raced.waiver,
        participant,
        signatureBase64,
        locale,
        contentVersion: content_version,
      });
      return res.status(replay.status).json(replay.body);
    }

    if (wErr || !insertedWaiver?.id) {
      console.error('waivers.insert error', wErr);
      return res.status(500).json({ ok: false, errors: [{ field: 'waiver', messageKey: 'server.db_insert_waiver_failed' }] });
    }
    const submittedAt = insertedWaiver.signed_at_utc ?? new Date().toISOString();

    const related = await persistRelatedRows({
      supabase,
      waiverId,
      participantId,
      emergencyContact,
      medicalInformation,
      documentPdfUrl,
      hash,
      identity_snapshot: {
        full_name: participant.full_name,
        email: participant.email,
        date_of_birth: participant.date_of_birth,
      },
      locale,
      contentVersion: content_version,
    });
    if (related.error) {
      return res.status(500).json({ ok: false, errors: [{ field: 'audit', messageKey: 'server.db_insert_audit_failed' }] });
    }

    try {
      const event = await recordEvent({
        supabase,
        waiverId,
        participantId,
        accountId: accountBinding.accountId,
        participant,
        submittedAt,
      });
      console.info('waiver.event.recorded', {
        eventName: event.eventName,
        eventId: event.id,
        waiverId,
        participantId,
      });
    } catch (eventError) {
      const message = eventError instanceof Error ? eventError.message : String(eventError);
      console.error('waiver.event.record_failed', {
        eventName: 'waiver.submitted',
        waiverId,
        participantId,
        error: message,
      });
    }

    scheduleWaiverNotification({
      notify,
      waiverId,
      participantId,
      participant,
      submittedAt,
    });

    return res.json({
      ok: true,
      waiverId,
      participantId,
      accountId: accountBinding.accountId,
      accountMemberId: accountBinding.accountMemberId,
      sha256: hash,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}

export function registerWaiverSubmitRoute(app, deps) {
  app.post('/api/waivers/submit', (req, res) => handleWaiverSubmit(req, res, deps));
}
