import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminFetch } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

type SortMode = 'recent' | 'name';

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

type WaiverViewerProps = {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
};

const sortConfig: Record<SortMode, { label: string; sort: string; order: 'asc' | 'desc' }> = {
  recent: { label: 'Most recent', sort: 'signed_at_utc', order: 'desc' },
  name: { label: 'Alphabetical', sort: 'participant_full_name', order: 'asc' },
};

const yesNo = (value: boolean | null | undefined) => {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not recorded';
};

const text = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return yesNo(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
};

const formatDateTime = (value: string | null | undefined) => {
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
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not recorded';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm text-foreground">{text(value)}</dd>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <dl className="grid gap-2 sm:grid-cols-2">{children}</dl>
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
  const detailId = `waiver-details-${row.waiver_id}`;
  const displayName = row.participant_full_name || 'Unnamed participant';
  const phone = row.participant_cell_phone || row.participant_home_phone;
  const cityState = [row.participant_city, row.participant_state].filter(Boolean).join(', ');

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <CardHeader className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg leading-tight">{displayName}</CardTitle>
              <CardDescription className="mt-1">
                Signed {formatDateTime(row.signed_at_utc)}
              </CardDescription>
            </div>
            <span className="shrink-0 rounded-full border border-border px-2 py-1 text-xs font-medium text-muted-foreground">
              {expanded ? 'Hide' : 'View'}
            </span>
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p className="truncate">{row.participant_email || 'No email recorded'}</p>
            <p>{phone || 'No phone recorded'}</p>
            {cityState && <p>{cityState}</p>}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
              Review: {row.review_confirm_accuracy ? 'confirmed' : 'not confirmed'}
            </span>
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
              Medical: {row.medical_history_id ? 'on file' : 'missing'}
            </span>
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
              Emergency: {row.emergency_contact_id ? 'on file' : 'missing'}
            </span>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent id={detailId} className="space-y-5 border-t border-border p-4">
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
        </CardContent>
      )}
    </Card>
  );
}

export function WaiverViewer({ apiBase, adminKey, requireKey }: WaiverViewerProps) {
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [rows, setRows] = useState<WaiverDocument[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedSort = sortConfig[sortMode];

  const loadWaivers = useCallback(
    async (opts?: { silent?: boolean }) => {
      const keyError = requireKey();
      if (keyError) {
        setRows([]);
        if (!opts?.silent) setMessage(keyError);
        return;
      }

      setLoading(true);
      if (!opts?.silent) setMessage(null);

      const params = new URLSearchParams({
        limit: '200',
        offset: '0',
        sort: selectedSort.sort,
        order: selectedSort.order,
      });
      const { ok, status, data } = await adminFetch<{
        ok?: boolean;
        error?: string;
        rows?: WaiverDocument[];
        rowCount?: number;
      }>(apiBase, adminKey, `/api/admin/reporting/views/waiver-documents?${params}`);

      setLoading(false);
      if (!ok) {
        setRows([]);
        setMessage(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
        return;
      }

      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(nextRows);
      setExpandedId((current) => (current && nextRows.some((row) => row.waiver_id === current) ? current : null));
      if (!opts?.silent) {
        setMessage(`Loaded ${data.rowCount ?? nextRows.length} waiver(s), sorted by ${selectedSort.label.toLowerCase()}.`);
      }
    },
    [adminKey, apiBase, requireKey, selectedSort.label, selectedSort.order, selectedSort.sort],
  );

  useEffect(() => {
    void loadWaivers({ silent: !adminKey.trim() });
  }, [adminKey, apiBase, loadWaivers, sortMode]);

  const recentCount = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return rows.filter((row) => {
      if (!row.signed_at_utc) return false;
      const signedAt = new Date(row.signed_at_utc).getTime();
      return Number.isFinite(signedAt) && signedAt >= dayAgo;
    }).length;
  }, [rows]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-2 border-b border-border pb-4">
        <h2 className="text-xl font-semibold tracking-tight">Waiver viewer</h2>
        <p className="text-sm text-muted-foreground">
          Mobile-first waiver cards from <code className="rounded bg-muted px-1">view_waiver_documents</code>. Tap a
          card to expand the full waiver details.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="waiver-sort">Sort waivers</Label>
              <select
                id="waiver-sort"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="recent">Most recent first</option>
                <option value="name">Alphabetical by name</option>
              </select>
            </div>
            <Button type="button" variant="secondary" onClick={() => void loadWaivers()} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-md bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Loaded</p>
              <p className="text-lg font-semibold">{rows.length}</p>
            </div>
            <div className="rounded-md bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Last 24h</p>
              <p className="text-lg font-semibold">{recentCount}</p>
            </div>
            <div className="rounded-md bg-muted/60 p-3 col-span-2 sm:col-span-1">
              <p className="text-xs text-muted-foreground">Sort</p>
              <p className="text-sm font-medium">{selectedSort.label}</p>
            </div>
          </div>

          {message && (
            <p
              role="status"
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            >
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rows.map((row) => (
          <WaiverCard
            key={row.waiver_id}
            row={row}
            expanded={expandedId === row.waiver_id}
            onToggle={() => setExpandedId((current) => (current === row.waiver_id ? null : row.waiver_id))}
          />
        ))}
      </div>

      {!loading && adminKey.trim() && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No waivers found.
        </p>
      )}
    </div>
  );
}
