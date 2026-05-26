import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type SortMode = 'recent' | 'name';
type StatusKind = 'info' | 'error' | 'success';

type WaiverDocument = {
  waiver_id: string;
  participant_id: string | null;
  initials_risk_assumption: string | null;
  initials_release: string | null;
  initials_indemnification: string | null;
  initials_media_release: string | null;
  signature_image_url: string | null;
  signature_vector_json: unknown;
  signed_at_utc: string | null;
  review_confirm_accuracy: boolean | null;
  consent_acknowledged: boolean | null;
  participant_full_name: string | null;
  participant_date_of_birth: string | null;
  participant_address_line: string | null;
  participant_city: string | null;
  participant_state: string | null;
  participant_zip: string | null;
  participant_home_phone: string | null;
  participant_cell_phone: string | null;
  participant_email: string | null;
  medical_history_id: string | null;
  heart_disease: boolean | null;
  shortness_of_breath: boolean | null;
  high_blood_pressure: boolean | null;
  smoking: boolean | null;
  diabetes: boolean | null;
  family_history: boolean | null;
  workouts: boolean | null;
  medication: boolean | null;
  alcohol: boolean | null;
  last_physical: string | null;
  exercise_restriction: string | null;
  injuries_knees: boolean | null;
  injuries_lower_back: boolean | null;
  injuries_neck_shoulders: boolean | null;
  injuries_hip_pelvis: boolean | null;
  injuries_other_has: boolean | null;
  injuries_other_details: string | null;
  had_recent_injury: boolean | null;
  injury_details: string | null;
  physician_cleared: boolean | null;
  clearance_notes: string | null;
  medical_history_created_at: string | null;
  medical_history_updated_at: string | null;
  emergency_contact_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_email: string | null;
  emergency_contact_created_at: string | null;
  audit_id: string | null;
  document_pdf_url: string | null;
  document_sha256: string | null;
  identity_snapshot: unknown;
  locale: string | null;
  content_version: string | null;
  audit_created_at: string | null;
};

const VIEWER_WAIVERS_PATH = '/api/viewer/waiver-documents';

function viewerApiUrl(path: string) {
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
  if (base) return `${base}${path}`;
  return path;
}

const sortConfig: Record<SortMode, { label: string; sort: string; order: 'asc' | 'desc' }> = {
  recent: { label: 'Most recent', sort: 'signed_at_utc', order: 'desc' },
  name: { label: 'Alphabetical', sort: 'participant_full_name', order: 'asc' },
};

function yesNo(value: boolean | null | undefined) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not recorded';
}

function displayText(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return yesNo(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function viewerFetch<T>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(viewerApiUrl(path), {
    credentials: 'same-origin',
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{displayText(value)}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function WaiverCard({
  row,
  expanded,
  onToggle,
}: {
  row: WaiverDocument;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailId = `waiver-${row.waiver_id}`;
  const name = row.participant_full_name || 'Unnamed participant';
  const phone = row.participant_cell_phone || row.participant_home_phone;
  const cityState = [row.participant_city, row.participant_state].filter(Boolean).join(', ');

  return (
    <article className="waiver-card">
      <button
        type="button"
        className="waiver-summary"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="summary-topline">
          <span>
            <span className="summary-name">{name}</span>
            <span className="summary-date">Signed {formatDateTime(row.signed_at_utc)}</span>
          </span>
          <span className="summary-action">{expanded ? 'Hide' : 'View'}</span>
        </span>
        <span className="summary-contact">{row.participant_email || 'No email recorded'}</span>
        <span className="summary-contact">{phone || 'No phone recorded'}</span>
        {cityState && <span className="summary-contact">{cityState}</span>}
        <span className="summary-tags">
          <span>Review: {row.review_confirm_accuracy ? 'confirmed' : 'not confirmed'}</span>
          <span>Medical: {row.medical_history_id ? 'on file' : 'missing'}</span>
          <span>Emergency: {row.emergency_contact_id ? 'on file' : 'missing'}</span>
        </span>
      </button>

      {expanded && (
        <div id={detailId} className="waiver-details">
          <DetailSection title="Participant">
            <DetailRow label="Full name" value={row.participant_full_name} />
            <DetailRow label="Date of birth" value={formatDate(row.participant_date_of_birth)} />
            <DetailRow label="Email" value={row.participant_email} />
            <DetailRow label="Cell phone" value={row.participant_cell_phone} />
            <DetailRow label="Home phone" value={row.participant_home_phone} />
            <DetailRow label="Address" value={row.participant_address_line} />
            <DetailRow label="City" value={row.participant_city} />
            <DetailRow label="State" value={row.participant_state} />
            <DetailRow label="ZIP" value={row.participant_zip} />
          </DetailSection>

          <DetailSection title="Waiver">
            <DetailRow label="Waiver ID" value={row.waiver_id} />
            <DetailRow label="Participant ID" value={row.participant_id} />
            <DetailRow label="Signed at" value={formatDateTime(row.signed_at_utc)} />
            <DetailRow label="Consent acknowledged" value={yesNo(row.consent_acknowledged)} />
            <DetailRow label="Review confirmed" value={yesNo(row.review_confirm_accuracy)} />
            <DetailRow label="Risk initials" value={row.initials_risk_assumption} />
            <DetailRow label="Release initials" value={row.initials_release} />
            <DetailRow label="Indemnification initials" value={row.initials_indemnification} />
            <DetailRow label="Media initials" value={row.initials_media_release} />
          </DetailSection>

          <DetailSection title="Emergency contact">
            <DetailRow label="Name" value={row.emergency_contact_name} />
            <DetailRow label="Relationship" value={row.emergency_contact_relationship} />
            <DetailRow label="Phone" value={row.emergency_contact_phone} />
            <DetailRow label="Email" value={row.emergency_contact_email} />
          </DetailSection>

          <DetailSection title="Medical">
            <DetailRow label="Heart disease" value={yesNo(row.heart_disease)} />
            <DetailRow label="Shortness of breath" value={yesNo(row.shortness_of_breath)} />
            <DetailRow label="High blood pressure" value={yesNo(row.high_blood_pressure)} />
            <DetailRow label="Smoking" value={yesNo(row.smoking)} />
            <DetailRow label="Diabetes" value={yesNo(row.diabetes)} />
            <DetailRow label="Family history" value={yesNo(row.family_history)} />
            <DetailRow label="Workouts" value={yesNo(row.workouts)} />
            <DetailRow label="Medication" value={yesNo(row.medication)} />
            <DetailRow label="Alcohol" value={yesNo(row.alcohol)} />
            <DetailRow label="Last physical" value={row.last_physical} />
            <DetailRow label="Exercise restriction" value={row.exercise_restriction} />
            <DetailRow label="Knees" value={yesNo(row.injuries_knees)} />
            <DetailRow label="Lower back" value={yesNo(row.injuries_lower_back)} />
            <DetailRow label="Neck / shoulders" value={yesNo(row.injuries_neck_shoulders)} />
            <DetailRow label="Hip / pelvis" value={yesNo(row.injuries_hip_pelvis)} />
            <DetailRow label="Other injury" value={yesNo(row.injuries_other_has)} />
            <DetailRow label="Other details" value={row.injuries_other_details} />
            <DetailRow label="Recent injury" value={yesNo(row.had_recent_injury)} />
            <DetailRow label="Injury details" value={row.injury_details} />
            <DetailRow label="Physician cleared" value={yesNo(row.physician_cleared)} />
            <DetailRow label="Clearance notes" value={row.clearance_notes} />
          </DetailSection>

          <DetailSection title="Audit and documents">
            <DetailRow label="Audit ID" value={row.audit_id} />
            <DetailRow label="PDF path" value={row.document_pdf_url} />
            <DetailRow label="Signature path" value={row.signature_image_url} />
            <DetailRow label="SHA-256" value={row.document_sha256} />
            <DetailRow label="Locale" value={row.locale} />
            <DetailRow label="Content version" value={row.content_version} />
            <DetailRow label="Audit created" value={formatDateTime(row.audit_created_at)} />
          </DetailSection>
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [rows, setRows] = useState<WaiverDocument[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: StatusKind; message: string } | null>({
    kind: 'info',
    message: 'Tap Load waivers to fetch the latest submissions.',
  });
  const [loading, setLoading] = useState(false);
  const autoLoadedRef = useRef(false);
  const selectedSort = sortConfig[sortMode];

  const loadWaivers = useCallback(async (mode: SortMode = sortMode) => {
    setLoading(true);
    setStatus(null);

    const nextSort = sortConfig[mode];
    const params = new URLSearchParams({
      limit: '200',
      offset: '0',
      sort: nextSort.sort,
      order: nextSort.order,
    });
    try {
      const { ok, status: httpStatus, data } = await viewerFetch<{
        ok?: boolean;
        error?: string;
        rows?: WaiverDocument[];
        rowCount?: number;
      }>(`${VIEWER_WAIVERS_PATH}?${params}`);

      if (!ok) {
        setRows([]);
        const hint =
          httpStatus === 401
            ? 'Sign in through Cloudflare Access, then reload.'
            : httpStatus === 403
              ? 'Your account is not authorized for the waiver viewer.'
              : '';
        const detail = data.error ?? JSON.stringify(data);
        setStatus({
          kind: 'error',
          message: `Error ${httpStatus}: ${detail}${hint ? ` ${hint}` : ''}`,
        });
        return;
      }

      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(nextRows);
      setExpandedId((current) => (current && nextRows.some((row) => row.waiver_id === current) ? current : null));
      setStatus({
        kind: 'success',
        message: `Loaded ${data.rowCount ?? nextRows.length} waiver(s), sorted by ${nextSort.label.toLowerCase()}.`,
      });
    } catch (error) {
      console.error('waiver-viewer.loadWaivers failed', error);
      setRows([]);
      setStatus({
        kind: 'error',
        message: 'Unable to load waivers right now. Check API connectivity and try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [sortMode]);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    void loadWaivers();
  }, [loadWaivers]);

  const recentCount = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return rows.filter((row) => {
      if (!row.signed_at_utc) return false;
      const signedAt = new Date(row.signed_at_utc).getTime();
      return Number.isFinite(signedAt) && signedAt >= dayAgo;
    }).length;
  }, [rows]);

  return (
    <main className="app-shell">
      <header className="hero-card">
        <p className="eyebrow">Waiver operations</p>
        <h1>Waiver Viewer</h1>
        <p>
          Review submitted waivers from your phone without loading the full dashboard. Data comes from the admin API
          backed by the existing Supabase <code>view_waiver_documents</code> view.
        </p>
      </header>

      <section className="controls-card" aria-labelledby="controls-heading">
        <div>
          <h2 id="controls-heading">Sorting</h2>
          <p className="api-base-line">{viewerApiUrl(VIEWER_WAIVERS_PATH)}</p>
          <p className="access-note">Access is enforced by Cloudflare Access and the viewer API proxy (no browser admin key).</p>
        </div>

        <label className="form-field" htmlFor="sort-mode">
          <span>Sort waivers</span>
          <select
            id="sort-mode"
            value={sortMode}
            onChange={(event) => {
              const nextMode = event.target.value as SortMode;
              setSortMode(nextMode);
              if (rows.length > 0) void loadWaivers(nextMode);
            }}
          >
            <option value="recent">Most recent first</option>
            <option value="name">Alphabetical by name</option>
          </select>
        </label>

        <button type="button" className="primary-button" disabled={loading} onClick={() => void loadWaivers()}>
          {loading ? 'Loading...' : 'Load waivers'}
        </button>

        <div className="stats-grid">
          <div>
            <span>Loaded</span>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <span>Last 24h</span>
            <strong>{recentCount}</strong>
          </div>
          <div>
            <span>Sort</span>
            <strong>{selectedSort.label}</strong>
          </div>
        </div>

        {status && (
          <p role="status" className={`status ${status.kind}`}>
            {status.message}
          </p>
        )}
      </section>

      <section className="waiver-list" aria-label="Waiver list">
        {rows.map((row) => (
          <WaiverCard
            key={row.waiver_id}
            row={row}
            expanded={expandedId === row.waiver_id}
            onToggle={() => setExpandedId((current) => (current === row.waiver_id ? null : row.waiver_id))}
          />
        ))}
      </section>

      {!loading && rows.length === 0 && (
        <p className="empty-state">No waivers found. Try refreshing or confirm the admin API can access Supabase.</p>
      )}
    </main>
  );
}
