import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { adminFetch, getDefaultApiBase } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Analysis views: most operationally useful first */
export const ANALYSIS_VIEWS = [
  {
    slug: 'primary-kpis' as const,
    label: 'Primary KPIs',
    hint: 'Expected revenue, actual revenue, visitors, and current monthly members.',
  },
  {
    slug: 'payment-board' as const,
    label: 'Payment board',
    hint: 'Charges, net due, allocations — main money & status picture.',
  },
  {
    slug: 'charge-net' as const,
    label: 'Charge net',
    hint: 'Gross, affiliate credits, write-offs, net due per charge.',
  },
  {
    slug: 'payment-reminders' as const,
    label: 'Payment reminders',
    hint: 'Who to nudge — driven by net due and due dates.',
  },
  {
    slug: 'participant-entitlements' as const,
    label: 'Entitlements',
    hint: 'Plan capacity / session availability by participant.',
  },
  {
    slug: 'waiver-documents' as const,
    label: 'Waiver documents',
    hint: 'Signed waivers linked to participants and audits.',
  },
  {
    slug: 'orphan-waiver-summary' as const,
    label: 'Orphan waivers (summary)',
    hint: 'Roll-up of waiver rows missing a clean participant link.',
  },
  {
    slug: 'orphan-waivers' as const,
    label: 'Orphan waivers (detail)',
    hint: 'Row-level orphan waiver rows for cleanup.',
  },
  {
    slug: 'today-sessions' as const,
    label: 'Today sessions',
    hint: 'Front desk day-of logistics and attendance snapshot.',
  },
  {
    slug: 'upcoming-access-issues' as const,
    label: 'Upcoming access issues',
    hint: 'Participants likely blocked by entitlement/override constraints.',
  },
  {
    slug: 'waiver-compliance-gaps' as const,
    label: 'Waiver compliance gaps',
    hint: 'Active participants missing waiver/emergency/medical records.',
  },
  {
    slug: 'ar-aging' as const,
    label: 'AR aging',
    hint: 'Collections buckets by account plus total rollup.',
  },
  {
    slug: 'payment-risk' as const,
    label: 'Payment risk',
    hint: 'Unallocated, partial, or overallocated billing risk queue.',
  },
  {
    slug: 'revenue-waterfall-monthly' as const,
    label: 'Revenue waterfall (monthly)',
    hint: 'Gross billed, concessions, refunds, and net cash monthly.',
  },
  {
    slug: 'subscription-movement' as const,
    label: 'Subscription movement',
    hint: 'Monthly new/cancelled/paused/expired by plan.',
  },
  {
    slug: 'attendance-utilization-weekly' as const,
    label: 'Attendance utilization (weekly)',
    hint: 'Weekly attendance/no-show and private-minute utilization.',
  },
  {
    slug: 'entitlement-burn' as const,
    label: 'Entitlement burn',
    hint: 'Usage vs limits with remaining and overburn-risk signals.',
  },
  {
    slug: 'affiliate-performance' as const,
    label: 'Affiliate performance',
    hint: 'Referral counts, credit earned/applied, liability by referrer.',
  },
  {
    slug: 'data-hygiene' as const,
    label: 'Data hygiene',
    hint: 'Potential duplicates, missing links, and contact quality gaps.',
  },
] as const;

export type AnalysisViewSlug = (typeof ANALYSIS_VIEWS)[number]['slug'];

type AdminPage = 'merge' | 'writeoff' | 'refund' | 'upgrade' | 'waiver';

type NavState = { kind: 'analysis'; slug: AnalysisViewSlug } | { kind: 'admin'; page: AdminPage };

const ADMIN_PAGES: { page: AdminPage; label: string; hint: string }[] = [
  { page: 'merge', label: 'Merge participants', hint: 'Combine duplicate participant records.' },
  { page: 'writeoff', label: 'Write-off', hint: 'Reduce net due via charge_adjustments.' },
  { page: 'refund', label: 'Refund', hint: 'Record payment refunds & reopen charges if needed.' },
  { page: 'upgrade', label: 'Plan upgrade', hint: 'Prorated subscription upgrade charge.' },
  { page: 'waiver', label: 'Waiver URLs', hint: 'Signed PDF + signature links.' },
];

function StatusMessage({ message, variant }: { message: string | null; variant: 'ok' | 'err' }) {
  if (!message) return null;
  const cls =
    variant === 'ok'
      ? 'text-green-800 bg-green-50 border-green-200'
      : 'text-destructive bg-destructive/10 border-destructive/30';
  return (
    <p role="status" className={`mt-4 rounded-md border px-3 py-2 text-sm whitespace-pre-wrap ${cls}`}>
      {message}
    </p>
  );
}

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active
          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
          : 'text-foreground/90 hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Sidebar({
  nav,
  setNav,
  mobileOpen,
  onCloseMobile,
}: {
  nav: NavState;
  setNav: (n: NavState) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pick = (next: NavState) => {
    setNav(next);
    onCloseMobile();
  };

  const asideClass =
    'flex w-72 max-w-[min(100vw,18rem)] shrink-0 flex-col border-r border-border bg-background transition-transform duration-200 ' +
    'fixed inset-y-0 left-0 z-[60] md:static md:z-0 md:translate-x-0 ' +
    (mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0');

  return (
    <aside className={asideClass}>
      <div className="flex items-center justify-between border-b border-border px-2 py-2 md:hidden">
        <span className="px-2 text-xs font-medium text-muted-foreground">Navigate</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCloseMobile}>
          Close
        </Button>
      </div>
      <div className="border-b border-border px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Analysis</p>
        <nav className="mt-2 flex flex-col gap-0.5" aria-label="Data views">
          {ANALYSIS_VIEWS.map((v) => (
            <NavButton
              key={v.slug}
              active={nav.kind === 'analysis' && nav.slug === v.slug}
              onClick={() => pick({ kind: 'analysis', slug: v.slug })}
            >
              {v.label}
            </NavButton>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Administration</p>
        <nav className="mt-2 flex flex-col gap-0.5" aria-label="Admin actions">
          {ADMIN_PAGES.map((a) => (
            <NavButton
              key={a.page}
              active={nav.kind === 'admin' && nav.page === a.page}
              onClick={() => pick({ kind: 'admin', page: a.page })}
            >
              {a.label}
            </NavButton>
          ))}
        </nav>
      </div>
    </aside>
  );
}

export default function App() {
  const [apiBase, setApiBase] = useState(getDefaultApiBase);
  const [adminKey, setAdminKey] = useState('');
  const [nav, setNav] = useState<NavState>({ kind: 'analysis', slug: 'primary-kpis' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const requireKey = useCallback(() => {
    if (!adminKey.trim()) {
      return 'Enter your admin API key (x-admin-key).';
    }
    return null;
  }, [adminKey]);

  const currentAnalysisMeta =
    nav.kind === 'analysis' ? ANALYSIS_VIEWS.find((v) => v.slug === nav.slug) : undefined;
  const currentAdminMeta = nav.kind === 'admin' ? ADMIN_PAGES.find((a) => a.page === nav.page) : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="md:hidden shrink-0"
              onClick={() => setMobileMenuOpen((o) => !o)}
            >
              {mobileMenuOpen ? 'Close' : 'Menu'}
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Temple Underground</h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Analysis & data</span> first — administration in the
                sidebar. Trusted sessions only; see <code className="rounded bg-muted px-1">docs/admin-api.md</code>.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end lg:max-w-2xl">
            <Field id="api-base" label="API base">
              <Input
                id="api-base"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                autoComplete="off"
                placeholder="http://localhost:3001"
                className="h-9 min-w-[12rem] font-mono text-xs sm:min-w-[14rem]"
              />
            </Field>
            <Field id="admin-key" label="Admin key">
              <Input
                id="admin-key"
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                autoComplete="off"
                placeholder="x-admin-key"
                className="h-9 min-w-[10rem] font-mono text-xs"
              />
            </Field>
          </div>
        </div>

        {/* Mobile: quick jump when sidebar is awkward */}
        <div className="border-t border-border px-4 py-2 md:hidden">
          <Label htmlFor="mobile-nav" className="sr-only">
            Jump to
          </Label>
          <select
            id="mobile-nav"
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={
              nav.kind === 'analysis'
                ? `a:${nav.slug}`
                : `m:${nav.page}`
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('a:')) setNav({ kind: 'analysis', slug: v.slice(2) as AnalysisViewSlug });
              else if (v.startsWith('m:')) setNav({ kind: 'admin', page: v.slice(2) as AdminPage });
            }}
          >
            <optgroup label="Analysis">
              {ANALYSIS_VIEWS.map((x) => (
                <option key={x.slug} value={`a:${x.slug}`}>
                  {x.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Administration">
              {ADMIN_PAGES.map((x) => (
                <option key={x.page} value={`m:${x.page}`}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          nav={nav}
          setNav={setNav}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {nav.kind === 'analysis' && currentAnalysisMeta && nav.slug === 'primary-kpis' && (
            <PrimaryKpiConsole apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />
          )}

          {nav.kind === 'analysis' && currentAnalysisMeta && nav.slug !== 'primary-kpis' && (
            <DataExplorer
              apiBase={apiBase}
              adminKey={adminKey}
              requireKey={requireKey}
              slug={nav.slug}
              title={currentAnalysisMeta.label}
              description={currentAnalysisMeta.hint}
            />
          )}

          {nav.kind === 'admin' && currentAdminMeta && (
            <div className="mx-auto max-w-2xl space-y-2">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">{currentAdminMeta.label}</h2>
                <p className="text-sm text-muted-foreground">{currentAdminMeta.hint}</p>
              </div>
              {nav.page === 'merge' && <MergeTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
              {nav.page === 'writeoff' && <WriteOffTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
              {nav.page === 'refund' && <RefundTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
              {nav.page === 'upgrade' && <UpgradeTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
              {nav.page === 'waiver' && <WaiverTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function MergeTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [canonicalId, setCanonicalId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    if (!canonicalId.trim() || !duplicateId.trim()) {
      setVariant('err');
      setMsg('Both participant UUIDs are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch(apiBase, adminKey, '/api/admin/participants/merge', {
      method: 'POST',
      json: {
        canonical_participant_id: canonicalId.trim(),
        duplicate_participant_id: duplicateId.trim(),
      },
    });
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${(data as { error?: string }).error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg('Merge completed. Duplicate is marked merged_into + merged_at.');
    setDuplicateId('');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Merge participants</CardTitle>
        <CardDescription>Canonical row keeps history; duplicate is linked via merged_into_participant_id.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="canon" label="Canonical participant UUID">
            <Input id="canon" value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)} placeholder="keep" />
          </Field>
          <Field id="dup" label="Duplicate participant UUID">
            <Input id="dup" value={duplicateId} onChange={(e) => setDuplicateId(e.target.value)} placeholder="merge away" />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Merging…' : 'Merge participants'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}

function WriteOffTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [chargeId, setChargeId] = useState('');
  const [amountCents, setAmountCents] = useState('');
  const [reason, setReason] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    const cents = Number.parseInt(amountCents, 10);
    if (!chargeId.trim() || !Number.isFinite(cents) || cents <= 0 || !reason.trim()) {
      setVariant('err');
      setMsg('charge_id, positive amount (cents), and reason are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/charge-adjustments',
      {
        method: 'POST',
        json: {
          charge_id: chargeId.trim(),
          amount_cents: cents,
          reason: reason.trim(),
          created_by: createdBy.trim() || undefined,
        },
      },
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg(`Write-off recorded. Adjustment id: ${data.id ?? '(see response)'}`);
    setAmountCents('');
    setReason('');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Charge write-off</CardTitle>
        <CardDescription>Creates a charge_adjustments row; net due updates in view_charge_net.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="ch" label="Charge ID (UUID)">
            <Input id="ch" value={chargeId} onChange={(e) => setChargeId(e.target.value)} />
          </Field>
          <Field id="cents" label="Amount (cents)">
            <Input id="cents" type="number" min={1} step={1} value={amountCents} onChange={(e) => setAmountCents(e.target.value)} />
          </Field>
          <Field id="why" label="Reason">
            <Textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <Field id="by" label="Created by (optional)">
            <Input id="by" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="operator name" />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Apply write-off'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}

function RefundTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [paymentId, setPaymentId] = useState('');
  const [amountCents, setAmountCents] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    const cents = Number.parseInt(amountCents, 10);
    if (!paymentId.trim() || !Number.isFinite(cents) || cents <= 0 || !reason.trim()) {
      setVariant('err');
      setMsg('payment_id, positive amount (cents), and reason are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ refund_id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/payment-refunds',
      {
        method: 'POST',
        json: {
          payment_id: paymentId.trim(),
          amount_cents: cents,
          reason: reason.trim(),
          idempotency_key: idempotencyKey.trim() || undefined,
        },
      },
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg(`Refund recorded. refund_id: ${data.refund_id ?? ''}`);
    setAmountCents('');
    setReason('');
    setIdempotencyKey('');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Payment refund</CardTitle>
        <CardDescription>Shrinks allocations FIFO; may reopen charges when below net due.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="pay" label="Payment ID (UUID)">
            <Input id="pay" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} />
          </Field>
          <Field id="rcents" label="Refund amount (cents)">
            <Input id="rcents" type="number" min={1} step={1} value={amountCents} onChange={(e) => setAmountCents(e.target.value)} />
          </Field>
          <Field id="rwhy" label="Reason">
            <Textarea id="rwhy" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <Field id="idem" label="Idempotency key (optional)">
            <Input id="idem" value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="unique per action" />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Processing…' : 'Record refund'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}

function UpgradeTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [subscriptionId, setSubscriptionId] = useState('');
  const [planId, setPlanId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    if (!subscriptionId.trim() || !planId.trim()) {
      setVariant('err');
      setMsg('subscription_id and new_plan_definition_id are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const body: Record<string, string> = {
      subscription_id: subscriptionId.trim(),
      new_plan_definition_id: planId.trim(),
    };
    if (effectiveDate.trim()) body.effective_date = effectiveDate.trim();
    const { ok, status, data } = await adminFetch<{ proration_charge_id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/subscription-upgrade',
      { method: 'POST', json: body },
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg(`Upgrade applied. Proration charge id: ${data.proration_charge_id ?? ''}`);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Subscription upgrade (prorated)</CardTitle>
        <CardDescription>Upgrade-only: creates a delta charge for the rest of the current period.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="sub" label="Subscription ID (UUID)">
            <Input id="sub" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} />
          </Field>
          <Field id="plan" label="New plan definition ID (UUID)">
            <Input id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)} />
          </Field>
          <Field id="eff" label="Effective date (optional, YYYY-MM-DD)">
            <Input id="eff" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Upgrading…' : 'Apply upgrade'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}

function formatReportingCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

type PrimaryKpis = {
  month_start: string;
  month_end: string;
  expected_revenue_open_due_cents: number;
  actual_revenue_net_cash_cents: number;
  total_visitors_present_checkins: number;
  current_monthly_members_active_count: number;
};

function formatUsd(cents: number): string {
  const amount = Number.isFinite(cents) ? cents / 100 : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function PrimaryKpiConsole({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const [kpis, setKpis] = useState<PrimaryKpis | null>(null);
  const [expanded, setExpanded] = useState<'expected' | 'actual' | 'visitors' | 'members' | null>(null);
  const [detailRows, setDetailRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');

  const loadKpis = useCallback(async () => {
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      setKpis(null);
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{
      ok?: boolean;
      error?: string;
      kpis?: PrimaryKpis;
    }>(apiBase, adminKey, `/api/admin/reporting/summary/primary-kpis?month=${encodeURIComponent(month)}`);
    setLoading(false);
    if (!ok || !data.kpis) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setKpis(null);
      return;
    }
    setVariant('ok');
    setKpis(data.kpis);
    setMsg(`Loaded primary KPIs for ${data.kpis.month_start}.`);
  }, [apiBase, adminKey, month, requireKey]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  const loadDetail = useCallback(
    async (kind: 'expected' | 'actual' | 'visitors' | 'members') => {
      if (!kpis) return;
      let path = '';
      if (kind === 'expected') {
        path = `/api/admin/reporting/views/payment-risk?limit=8&start=${kpis.month_start}&end=${kpis.month_end}&sort=days_past_due&order=desc`;
      } else if (kind === 'actual') {
        path = `/api/admin/reporting/views/revenue-waterfall-monthly?limit=6&start=${kpis.month_start}&end=${kpis.month_end}&sort=month_start&order=desc`;
      } else if (kind === 'visitors') {
        path = `/api/admin/reporting/views/attendance-utilization-weekly?limit=8&start=${kpis.month_start}&end=${kpis.month_end}&sort=week_start&order=desc`;
      } else {
        path = `/api/admin/reporting/views/subscription-movement?limit=12&start=${kpis.month_start}&end=${kpis.month_end}&sort=new_count&order=desc`;
      }
      const { ok, data } = await adminFetch<{ rows?: Record<string, unknown>[] }>(apiBase, adminKey, path);
      if (!ok) {
        setDetailRows([]);
        return;
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (kind === 'members') {
        setDetailRows(rows.filter((r) => (typeof r.billing_cadence === 'string' ? r.billing_cadence : '') === 'monthly'));
      } else {
        setDetailRows(rows);
      }
    },
    [apiBase, adminKey, kpis],
  );

  useEffect(() => {
    if (!expanded) return;
    void loadDetail(expanded);
  }, [expanded, loadDetail]);

  const cardClass =
    'w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/30';
  const detailColumns = detailRows.length > 0 ? Object.keys(detailRows[0]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Primary KPIs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Most important operational signals first. Click a card to expand details.
          </p>
        </div>
        <Field id="kpi-month" label="Month">
          <Input
            id="kpi-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-40 font-mono text-xs"
          />
        </Field>
        <Button type="button" variant="secondary" className="h-9" onClick={() => void loadKpis()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh KPIs'}
        </Button>
      </div>

      <StatusMessage message={msg} variant={variant} />

      {kpis && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <button type="button" className={cardClass} onClick={() => setExpanded((v) => (v === 'expected' ? null : 'expected'))}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expected revenue</p>
              <p className="mt-2 text-2xl font-semibold">{formatUsd(kpis.expected_revenue_open_due_cents)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Open due in selected month</p>
            </button>
            <button type="button" className={cardClass} onClick={() => setExpanded((v) => (v === 'actual' ? null : 'actual'))}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual revenue</p>
              <p className="mt-2 text-2xl font-semibold">{formatUsd(kpis.actual_revenue_net_cash_cents)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Net cash collected in selected month</p>
            </button>
            <button type="button" className={cardClass} onClick={() => setExpanded((v) => (v === 'visitors' ? null : 'visitors'))}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total visitors</p>
              <p className="mt-2 text-2xl font-semibold">{kpis.total_visitors_present_checkins.toLocaleString('en-US')}</p>
              <p className="mt-1 text-xs text-muted-foreground">Present check-ins in selected month</p>
            </button>
            <button type="button" className={cardClass} onClick={() => setExpanded((v) => (v === 'members' ? null : 'members'))}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current monthly members</p>
              <p className="mt-2 text-2xl font-semibold">{kpis.current_monthly_members_active_count.toLocaleString('en-US')}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active monthly subscriptions as of today</p>
            </button>
          </div>

          {expanded && (
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">
                  {expanded === 'expected' && 'Expected revenue details'}
                  {expanded === 'actual' && 'Actual revenue details'}
                  {expanded === 'visitors' && 'Visitors details'}
                  {expanded === 'members' && 'Monthly members details'}
                </h3>
              </div>
              <div className="max-h-[420px] overflow-auto">
                {detailColumns.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No detail rows for the selected month.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 border-b border-border bg-muted/95">
                      <tr>
                        {detailColumns.map((c) => (
                          <th key={c} className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, i) => (
                        <tr key={`${expanded}-${i}`} className="border-b border-border/50">
                          {detailColumns.map((c) => (
                            <td key={c} className="px-3 py-2 text-xs">
                              {formatReportingCell(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DataExplorer({
  apiBase,
  adminKey,
  requireKey,
  slug,
  title,
  description,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
  slug: AnalysisViewSlug;
  title: string;
  description: string;
}) {
  const [limit, setLimit] = useState('200');
  const [offset, setOffset] = useState('0');
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [revenueMinNetCashCents, setRevenueMinNetCashCents] = useState('');
  const [revenueMinCollectedCents, setRevenueMinCollectedCents] = useState('');
  const [revenueMaxRefundedCents, setRevenueMaxRefundedCents] = useState('');
  const limitRef = useRef(limit);
  const offsetRef = useRef(offset);
  const sortRef = useRef(sort);
  const orderRef = useRef(order);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const revenueMinNetCashRef = useRef(revenueMinNetCashCents);
  const revenueMinCollectedRef = useRef(revenueMinCollectedCents);
  const revenueMaxRefundedRef = useRef(revenueMaxRefundedCents);
  limitRef.current = limit;
  offsetRef.current = offset;
  sortRef.current = sort;
  orderRef.current = order;
  startRef.current = start;
  endRef.current = end;
  revenueMinNetCashRef.current = revenueMinNetCashCents;
  revenueMinCollectedRef.current = revenueMinCollectedCents;
  revenueMaxRefundedRef.current = revenueMaxRefundedCents;

  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<{
    view?: string;
    rowCount?: number;
    offset?: number;
    sort?: string | null;
    order?: string | null;
    start?: string | null;
    end?: string | null;
    filters?: Record<string, number>;
  } | null>(null);
  const [resultBatch, setResultBatch] = useState(0);

  const applyDatePreset = (preset: '3m' | '6m' | '12m' | 'ytd') => {
    const now = new Date();
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let startDate = new Date(endDate);
    if (preset === '3m') startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 2, 1));
    if (preset === '6m') startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 5, 1));
    if (preset === '12m') startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 11, 1));
    if (preset === 'ytd') startDate = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1));
    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    setStart(toIso(startDate));
    setEnd(toIso(endDate));
  };

  const fetchRows = useCallback(
    async (opts?: { silent?: boolean }) => {
      const k = requireKey();
      if (k) {
        if (!opts?.silent) {
          setVariant('err');
          setMsg(k);
        } else {
          setMsg(null);
        }
        setRows([]);
        setMeta(null);
        return;
      }
      const lim = Number.parseInt(limitRef.current, 10);
      if (!Number.isFinite(lim) || lim < 1) {
        setVariant('err');
        setMsg('Limit must be a positive number (max 500).');
        return;
      }
      const off = Number.parseInt(offsetRef.current, 10);
      if (!Number.isFinite(off) || off < 0) {
        setVariant('err');
        setMsg('Offset must be a non-negative number.');
        return;
      }
      setLoading(true);
      if (!opts?.silent) setMsg(null);
      const q = new URLSearchParams({
        limit: String(Math.min(lim, 500)),
        offset: String(off),
      });
      if (sortRef.current.trim()) q.set('sort', sortRef.current.trim());
      if (orderRef.current) q.set('order', orderRef.current);
      if (startRef.current.trim()) q.set('start', startRef.current.trim());
      if (endRef.current.trim()) q.set('end', endRef.current.trim());
      if (slug === 'revenue-waterfall-monthly') {
        if (revenueMinNetCashRef.current.trim()) q.set('min_net_cash_cents', revenueMinNetCashRef.current.trim());
        if (revenueMinCollectedRef.current.trim()) q.set('min_collected_cents', revenueMinCollectedRef.current.trim());
        if (revenueMaxRefundedRef.current.trim()) q.set('max_refunded_cents', revenueMaxRefundedRef.current.trim());
      }
      const { ok, status, data } = await adminFetch<{
        ok?: boolean;
        error?: string;
        view?: string;
        rowCount?: number;
        offset?: number;
        sort?: string | null;
        order?: string | null;
        start?: string | null;
        end?: string | null;
        filters?: Record<string, number>;
        rows?: Record<string, unknown>[];
      }>(apiBase, adminKey, `/api/admin/reporting/views/${encodeURIComponent(slug)}?${q}`);
      setLoading(false);
      if (!ok) {
        setVariant('err');
        setRows([]);
        setMeta(null);
        setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
        return;
      }
      setVariant('ok');
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMeta({
        view: data.view,
        rowCount: data.rowCount,
        offset: data.offset,
        sort: data.sort ?? null,
        order: data.order ?? null,
        start: data.start ?? null,
        end: data.end ?? null,
        filters: data.filters ?? {},
      });
      setResultBatch((b) => b + 1);
      setMsg(`Loaded ${data.rowCount ?? 0} row(s) from ${data.view ?? slug}.`);
    },
    [apiBase, adminKey, requireKey, slug],
  );

  useEffect(() => {
    void fetchRows({ silent: !adminKey.trim() });
  }, [slug, apiBase, adminKey, fetchRows]);

  async function onRefresh(e?: FormEvent) {
    e?.preventDefault();
    await fetchRows();
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          {meta?.view && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {meta.view} · {meta.rowCount} rows (limit {Math.min(Number.parseInt(limit, 10) || 200, 500)}, offset{' '}
              {meta.offset ?? 0}
              {meta.sort ? `, sort ${meta.sort} ${meta.order ?? ''}` : ''}
              {meta.start || meta.end ? `, range ${meta.start ?? '...'} -> ${meta.end ?? '...'}` : ''})
            </p>
          )}
          {meta?.filters && Object.keys(meta.filters).length > 0 && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              filters: {JSON.stringify(meta.filters)}
            </p>
          )}
        </div>
        <form onSubmit={onRefresh} className="flex flex-wrap items-end gap-3">
          <Field id="view-limit" label="Row limit">
            <Input
              id="view-limit"
              type="number"
              min={1}
              max={500}
              step={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="h-9 w-24 font-mono text-sm"
            />
          </Field>
          <Field id="view-offset" label="Offset">
            <Input
              id="view-offset"
              type="number"
              min={0}
              step={1}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              className="h-9 w-24 font-mono text-sm"
            />
          </Field>
          <Field id="view-sort" label="Sort column">
            <Input
              id="view-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              placeholder="optional"
              className="h-9 w-40 font-mono text-xs"
            />
          </Field>
          <Field id="view-order" label="Order">
            <select
              id="view-order"
              className="flex h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
              value={order}
              onChange={(e) => setOrder(e.target.value === 'asc' ? 'asc' : 'desc')}
            >
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </Field>
          <Field id="view-start" label="Start date">
            <Input
              id="view-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-9 w-36 font-mono text-xs"
            />
          </Field>
          <Field id="view-end" label="End date">
            <Input
              id="view-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-9 w-36 font-mono text-xs"
            />
          </Field>
          {slug === 'revenue-waterfall-monthly' && (
            <>
              <Field id="rev-min-net-cash" label="Min net cash (cents)">
                <Input
                  id="rev-min-net-cash"
                  type="number"
                  min={0}
                  step={1}
                  value={revenueMinNetCashCents}
                  onChange={(e) => setRevenueMinNetCashCents(e.target.value)}
                  className="h-9 w-36 font-mono text-xs"
                />
              </Field>
              <Field id="rev-min-collected" label="Min collected (cents)">
                <Input
                  id="rev-min-collected"
                  type="number"
                  min={0}
                  step={1}
                  value={revenueMinCollectedCents}
                  onChange={(e) => setRevenueMinCollectedCents(e.target.value)}
                  className="h-9 w-36 font-mono text-xs"
                />
              </Field>
              <Field id="rev-max-refunded" label="Max refunded (cents)">
                <Input
                  id="rev-max-refunded"
                  type="number"
                  min={0}
                  step={1}
                  value={revenueMaxRefundedCents}
                  onChange={(e) => setRevenueMaxRefundedCents(e.target.value)}
                  className="h-9 w-36 font-mono text-xs"
                />
              </Field>
            </>
          )}
          {slug === 'revenue-waterfall-monthly' && (
            <div className="flex items-end gap-1">
              <Button type="button" variant="outline" className="h-9 px-2 text-xs" onClick={() => applyDatePreset('3m')}>
                3M
              </Button>
              <Button type="button" variant="outline" className="h-9 px-2 text-xs" onClick={() => applyDatePreset('6m')}>
                6M
              </Button>
              <Button type="button" variant="outline" className="h-9 px-2 text-xs" onClick={() => applyDatePreset('12m')}>
                12M
              </Button>
              <Button type="button" variant="outline" className="h-9 px-2 text-xs" onClick={() => applyDatePreset('ytd')}>
                YTD
              </Button>
            </div>
          )}
          <Button type="submit" disabled={loading} variant="secondary" className="h-9">
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </form>
      </div>

      <StatusMessage message={msg} variant={variant} />

      {columns.length > 0 && (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div className="max-h-[min(75vh,800px)] overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 backdrop-blur-sm">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="h-11 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${resultBatch}-${i}`} className="border-b border-border/60 hover:bg-muted/40">
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="px-3 py-2 align-top text-xs whitespace-nowrap max-w-[min(24rem,40vw)] truncate md:max-w-[320px]"
                        title={formatReportingCell(row[c])}
                      >
                        {formatReportingCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && adminKey.trim() && columns.length === 0 && (
        <p className="text-sm text-muted-foreground">No rows returned (empty view or filter).</p>
      )}
    </div>
  );
}

function WaiverTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [waiverId, setWaiverId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<{ pdf?: string; sig?: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    if (!waiverId.trim()) {
      setVariant('err');
      setMsg('Waiver ID is required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    setLinks(null);
    const { ok, status, data } = await adminFetch<{
      signatureUrl?: string;
      documentPdfUrl?: string;
      error?: string;
    }>(apiBase, adminKey, `/api/admin/waivers/${encodeURIComponent(waiverId.trim())}`);
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg('Signed URLs retrieved (short-lived).');
    setLinks({ pdf: data.documentPdfUrl, sig: data.signatureUrl });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Waiver lookup</CardTitle>
        <CardDescription>GET signed URLs for PDF and signature (expires in minutes).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="wid" label="Waiver ID (UUID)">
            <Input id="wid" value={waiverId} onChange={(e) => setWaiverId(e.target.value)} />
          </Field>
          <Button type="submit" disabled={loading} variant="secondary">
            {loading ? 'Loading…' : 'Fetch signed URLs'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
        {links && (links.pdf || links.sig) && (
          <div className="mt-4 flex flex-col gap-2 text-sm">
            {links.pdf && (
              <a className="text-primary underline underline-offset-4" href={links.pdf} target="_blank" rel="noreferrer">
                Open PDF
              </a>
            )}
            {links.sig && (
              <a className="text-primary underline underline-offset-4" href={links.sig} target="_blank" rel="noreferrer">
                Open signature image
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
