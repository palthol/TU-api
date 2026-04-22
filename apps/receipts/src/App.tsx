import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { adminFetch, getDefaultApiBase } from '@/lib/admin-api';
import { SharePreviewPanel } from '@/components/SharePreviewPanel';
import {
  buildFormalShareText,
  buildInvoiceShareText,
  buildQuickShareText,
  formatUsdFromCents,
} from '@/lib/shareFormats';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const PAYMENT_METHODS = ['cash', 'card', 'cashapp', 'venmo', 'paypal', 'zelle', 'other'] as const;

type TabId = 'quick' | 'invoice' | 'recent' | 'formal' | 'preview' | 'lookup' | 'void' | 'refund';

type PersonalEntry = {
  id: string;
  entry_kind: string;
  member_display_name: string;
  amount_cents: number;
  method?: string | null;
  issued_by: string;
  notes?: string | null;
  due_at?: string | null;
  invoice_status?: string | null;
  account_id?: string | null;
  charge_id?: string | null;
  created_at?: string;
};

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

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

function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function defaultTomorrowIsoDate() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return t.toISOString().slice(0, 10);
}

export default function App() {
  const [apiBase, setApiBase] = useState(getDefaultApiBase);
  const [adminKey, setAdminKey] = useState('');
  const [tab, setTab] = useState<TabId>('quick');

  const requireKey = useCallback(() => {
    if (!adminKey.trim()) return 'Enter your admin API key (x-admin-key).';
    return null;
  }, [adminKey]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Temple Underground — Finance log</h1>
            <p className="text-sm text-muted-foreground">
              Personal operator tool: log cash you collected, draft invoices for upcoming dues, and optionally use formal
              billing when you already have Supabase account and charge IDs. Same admin API key as the dashboard.
            </p>
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
        <nav className="flex flex-wrap gap-2 border-t border-border px-4 py-2" aria-label="Finance sections">
          {(
            [
              ['quick', 'Cash log'],
              ['invoice', 'Invoice'],
              ['recent', 'Recent'],
              ['formal', 'Formal billing'],
              ['preview', 'Share preview'],
              ['lookup', 'Board lookup'],
              ['void', 'Void receipt'],
              ['refund', 'Refund receipt'],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={tab === id ? 'default' : 'outline'}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 pb-16 md:p-6">
        {tab === 'quick' && <QuickCashTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'invoice' && <InvoiceTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'recent' && <RecentTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'formal' && <FormalBillingTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'preview' && <SharePreviewTab />}
        {tab === 'lookup' && <LookupTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'void' && <VoidReceiptTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'refund' && <RefundReceiptTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
      </main>
    </div>
  );
}

function QuickCashTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [memberName, setMemberName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [issuedBy, setIssuedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [lastCents, setLastCents] = useState<number | null>(null);

  const shareText = useMemo(() => {
    if (!lastId || lastCents === null || !memberName.trim()) return '';
    return buildQuickShareText({
      name: memberName,
      amountCents: lastCents,
      entryId: lastId,
      notes,
    });
  }, [lastId, lastCents, memberName, notes]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    const cents = parseDollarsToCents(amount);
    if (!memberName.trim() || !issuedBy.trim() || cents === null) {
      setVariant('err');
      setMsg('Member display name, issued-by, and a positive dollar amount are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ ok?: boolean; id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/personal-finance-entries',
      {
        method: 'POST',
        json: {
          entry_kind: 'cash_received',
          member_display_name: memberName.trim(),
          amount_cents: cents,
          method,
          issued_by: issuedBy.trim(),
          notes: notes.trim() || undefined,
        },
      },
    );
    setLoading(false);
    if (!ok || !data.id) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setLastId(null);
      setLastCents(null);
      return;
    }
    setVariant('ok');
    setMsg(`Saved personal cash log. id=${data.id}`);
    setLastId(data.id);
    setLastCents(cents);
  }

  async function onShare() {
    if (!shareText) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        setVariant('ok');
        setMsg('Shared via device share sheet.');
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setVariant('ok');
      setMsg('Copied share text to clipboard.');
    } catch {
      setVariant('err');
      setMsg('Unable to share or copy. Copy manually from the box below.');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Log cash received</CardTitle>
        <CardDescription>
          Saves a row in `personal_finance_entries` (no account or charge UUIDs required). This is your day-to-day
          memory of who paid and how much. Formal Supabase billing is optional and lives under Formal billing when you
          want receipts tied to `payments` and `charges`.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="mn" label="Member display name">
            <Input id="mn" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Who paid" />
          </Field>
          <Field id="amt" label="Amount (USD)">
            <Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150.00" inputMode="decimal" />
          </Field>
          <Field id="meth" label="Payment method">
            <select
              id="meth"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field id="by" label="Issued by (your name)">
            <Input id="by" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="You" />
          </Field>
          <Field id="notes" label="Notes">
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional context" />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save cash log'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
        {lastId && shareText && (
          <div className="mt-6 space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">Share draft (SMS or copy)</p>
            <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{shareText}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void onShare()}>
              Share or copy
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [memberName, setMemberName] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState(defaultTomorrowIsoDate);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<{ id: string; cents: number; due: string } | null>(null);

  const shareText = useMemo(() => {
    if (!last || !memberName.trim()) return '';
    return buildInvoiceShareText({
      name: memberName,
      amountCents: last.cents,
      dueAt: last.due,
      entryId: last.id,
      status: 'draft',
    });
  }, [last, memberName]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    const cents = parseDollarsToCents(amount);
    if (!memberName.trim() || !issuedBy.trim() || !dueAt.trim() || cents === null) {
      setVariant('err');
      setMsg('Member name, issued-by, due date, and a positive dollar amount are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ ok?: boolean; id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/personal-finance-entries',
      {
        method: 'POST',
        json: {
          entry_kind: 'invoice',
          member_display_name: memberName.trim(),
          amount_cents: cents,
          issued_by: issuedBy.trim(),
          notes: notes.trim() || undefined,
          due_at: dueAt.trim(),
          invoice_status: 'draft',
        },
      },
    );
    setLoading(false);
    if (!ok || !data.id) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setLast(null);
      return;
    }
    setVariant('ok');
    setMsg(`Invoice draft saved. id=${data.id}`);
    setLast({ id: data.id, cents, due: dueAt.trim() });
  }

  async function onShare() {
    if (!shareText) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        setVariant('ok');
        setMsg('Shared via device share sheet.');
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setVariant('ok');
      setMsg('Copied share text to clipboard.');
    } catch {
      setVariant('err');
      setMsg('Unable to share or copy.');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Create invoice (draft)</CardTitle>
        <CardDescription>
          Lightweight reminder you can text someone before their subscription charge. Default due date is tomorrow. This
          does not create a `charges` row yet; automation can be layered later (Discord, email, or generated charges).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="inv-name" label="Member display name">
            <Input id="inv-name" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
          </Field>
          <Field id="inv-amt" label="Amount due (USD)">
            <Input id="inv-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Field id="inv-due" label="Due date">
            <Input id="inv-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field id="inv-by" label="Issued by (your name)">
            <Input id="inv-by" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} />
          </Field>
          <Field id="inv-notes" label="Notes">
            <Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save invoice draft'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
        {last && shareText && (
          <>
            <SharePreviewPanel
              title="After save — invoice share"
              payload={{
                kind: 'invoice',
                data: {
                  name: memberName,
                  amountCents: last.cents,
                  dueAt: last.due,
                  entryId: last.id,
                  status: 'draft',
                },
              }}
            />
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void onShare()}>
              Device share or copy (same text)
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [rows, setRows] = useState<PersonalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');

  const load = useCallback(async () => {
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      setRows([]);
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ rows?: PersonalEntry[]; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/personal-finance-entries?limit=80',
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setRows([]);
      return;
    }
    setVariant('ok');
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setMsg(`Loaded ${Array.isArray(data.rows) ? data.rows.length : 0} entr(y/ies).`);
  }, [apiBase, adminKey, requireKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setInvoiceStatus(id: string, status: string) {
    const k = requireKey();
    if (k) return;
    const { ok, status: st, data } = await adminFetch(apiBase, adminKey, `/api/admin/billing/personal-finance-entries/${id}/invoice-status`, {
      method: 'POST',
      json: { status },
    });
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${st}: ${(data as { error?: string }).error ?? JSON.stringify(data)}`);
      return;
    }
    await load();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent personal entries</CardTitle>
        <CardDescription>Cash logs and invoices you created here (not the full formal ledger).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
        <StatusMessage message={msg} variant={variant} />
        <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/90">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Kind</th>
                <th className="px-2 py-2">Member</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Meta</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-1">{r.entry_kind}</td>
                  <td className="px-2 py-1">{r.member_display_name}</td>
                  <td className="px-2 py-1">{formatUsdFromCents(r.amount_cents)}</td>
                  <td className="max-w-[10rem] px-2 py-1 align-top text-muted-foreground">
                    {r.entry_kind === 'invoice' ? (
                      <>
                        due {r.due_at ?? '—'} · {r.invoice_status ?? '—'}
                      </>
                    ) : (
                      <>{r.method ?? '—'}</>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {r.entry_kind === 'invoice' && r.invoice_status !== 'void' && r.invoice_status !== 'paid' ? (
                      <div className="flex flex-wrap gap-1">
                        {r.invoice_status === 'draft' && (
                          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => void setInvoiceStatus(r.id, 'sent')}>
                            Mark sent
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => void setInvoiceStatus(r.id, 'paid')}>
                          Mark paid
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void setInvoiceStatus(r.id, 'void')}>
                          Void
                        </Button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function FormalBillingTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [accountId, setAccountId] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [issuedBy, setIssuedBy] = useState('');
  const [issueReceipt, setIssueReceipt] = useState(true);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [memberName, setMemberName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<{ paymentId: string; receiptId: string | null; amountCents: number } | null>(null);

  const shareText = useMemo(() => {
    if (!last) return '';
    return buildFormalShareText({
      name: memberName,
      amountCents: last.amountCents,
      paymentId: last.paymentId,
      receiptId: last.receiptId,
      issuedBy: issuedBy.trim() || undefined,
    });
  }, [last, memberName, issuedBy]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      return;
    }
    const cents = parseDollarsToCents(amount);
    if (!accountId.trim() || !chargeId.trim() || !issuedBy.trim() || cents === null) {
      setVariant('err');
      setMsg('Account ID, charge ID, issued-by, and a positive dollar amount are required for formal billing.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{
      ok?: boolean;
      payment_id?: string;
      receipt_id?: string | null;
      error?: string;
    }>(apiBase, adminKey, '/api/admin/billing/record-payment', {
      method: 'POST',
      json: {
        account_id: accountId.trim(),
        amount_cents: cents,
        method,
        issued_by: issuedBy.trim(),
        allocations: [{ charge_id: chargeId.trim(), amount_cents: cents }],
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        issue_receipt: issueReceipt,
      },
    });
    setLoading(false);
    if (!ok || !data.payment_id) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setLast(null);
      return;
    }
    setVariant('ok');
    setMsg(`Formal payment recorded. payment_id=${data.payment_id}${data.receipt_id ? ` receipt_id=${data.receipt_id}` : ''}`);
    setLast({ paymentId: data.payment_id, receiptId: data.receipt_id ?? null, amountCents: cents });
  }

  async function onShare() {
    if (!shareText) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        setVariant('ok');
        setMsg('Shared via device share sheet.');
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setVariant('ok');
      setMsg('Copied share text to clipboard.');
    } catch {
      setVariant('err');
      setMsg('Unable to share or copy.');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Formal billing: payment plus receipt</CardTitle>
        <CardDescription>
          Optional path when you know the Supabase billing identifiers. An <strong>account</strong> is the billing bucket
          tied to members; a <strong>charge</strong> is a receivable line (for example a monthly subscription invoice
          row). This calls `record-payment` and can issue a real `receipts` row. Use Board lookup to copy UUIDs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="mn2" label="Member display name (optional, for SMS text only)">
            <Input id="mn2" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
          </Field>
          <Field id="acct" label="Account ID (UUID)">
            <Input id="acct" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field id="chg" label="Charge ID (UUID)">
            <Input id="chg" value={chargeId} onChange={(e) => setChargeId(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field id="amt2" label="Amount (USD)">
            <Input id="amt2" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Field id="meth2" label="Method">
            <select
              id="meth2"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field id="by2" label="Issued by (your name)">
            <Input id="by2" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} />
          </Field>
          <Field id="ref" label="Reference (optional)">
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field id="notes2" label="Notes (optional)">
            <Textarea id="notes2" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={issueReceipt} onChange={(e) => setIssueReceipt(e.target.checked)} />
            Issue money-in receipt in Postgres
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Record formal payment'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
        {last && (
          <>
            <SharePreviewPanel
              title="After save — formal payment / receipt share"
              payload={{
                kind: 'formal',
                data: {
                  name: memberName.trim() || undefined,
                  amountCents: last.amountCents,
                  paymentId: last.paymentId,
                  receiptId: last.receiptId,
                  issuedBy: issuedBy.trim() || undefined,
                },
              }}
            />
            {shareText ? (
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void onShare()}>
                Device share or copy (same text)
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type PreviewScenario = 'quick' | 'invoice' | 'formal';

function SharePreviewTab() {
  const [scenario, setScenario] = useState<PreviewScenario>('formal');

  const samplePayload = useMemo(() => {
    if (scenario === 'quick') {
      return {
        kind: 'quick' as const,
        data: {
          name: 'Alex Rivera',
          amountCents: 15_000,
          entryId: '00000000-0000-4000-8000-000000000001',
          notes: 'Day pass + guest',
        },
      };
    }
    if (scenario === 'invoice') {
      return {
        kind: 'invoice' as const,
        data: {
          name: 'Alex Rivera',
          amountCents: 8900,
          dueAt: '2026-04-30',
          entryId: '00000000-0000-4000-8000-000000000002',
          status: 'draft',
        },
      };
    }
    return {
      kind: 'formal' as const,
      data: {
        name: 'Alex Rivera',
        amountCents: 8900,
        paymentId: 'pay_demo_abc123',
        receiptId: 'rcpt_demo_xyz789',
        issuedBy: 'Jordan',
      },
    };
  }, [scenario]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Share preview (no API)</CardTitle>
        <CardDescription>
          Switch scenarios to see SMS-style text and the on-screen card before you record anything. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run test --workspace apps/receipts</code>{' '}
          to lock copy in unit tests while you iterate on layout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Scenario">
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as PreviewScenario)}
          >
            <option value="formal">Formal payment + receipt IDs</option>
            <option value="invoice">Invoice (draft)</option>
            <option value="quick">Cash log</option>
          </select>
        </Field>
        <SharePreviewPanel payload={samplePayload} title="Sample data" />
      </CardContent>
    </Card>
  );
}

function LookupTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'ok' | 'err'>('ok');

  const load = useCallback(async () => {
    const k = requireKey();
    if (k) {
      setVariant('err');
      setMsg(k);
      setRows([]);
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ rows?: Record<string, unknown>[]; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/reporting/views/payment-board?limit=100&sort=next_due_date&order=asc',
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${data.error ?? JSON.stringify(data)}`);
      setRows([]);
      return;
    }
    setVariant('ok');
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setMsg(`Loaded ${Array.isArray(data.rows) ? data.rows.length : 0} row(s). Tap a row to copy account_id and charge_id.`);
  }, [apiBase, adminKey, requireKey]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Payment board lookup</CardTitle>
        <CardDescription>
          Read-only `view_member_payment_board`. Use this when you want to run the Formal billing tab with real UUIDs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh board'}
        </Button>
        <StatusMessage message={msg} variant={variant} />
        {columns.length > 0 && (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/90">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-2 py-2 font-semibold text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                    onClick={() => {
                      const aid = String(row.account_id ?? '');
                      const cid = String(row.charge_id ?? '');
                      void navigator.clipboard.writeText(`account_id=${aid}\ncharge_id=${cid}`);
                    }}
                  >
                    {columns.map((c) => (
                      <td key={c} className="max-w-[10rem] truncate px-2 py-1 font-mono">
                        {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VoidReceiptTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [receiptId, setReceiptId] = useState('');
  const [voidReason, setVoidReason] = useState('');
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
    if (!receiptId.trim() || !voidReason.trim()) {
      setVariant('err');
      setMsg('Receipt ID and void reason are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ ok?: boolean; error?: string }>(
      apiBase,
      adminKey,
      `/api/admin/billing/receipts/${encodeURIComponent(receiptId.trim())}/void`,
      { method: 'POST', json: { void_reason: voidReason.trim() } },
    );
    setLoading(false);
    if (!ok) {
      setVariant('err');
      setMsg(`Error ${status}: ${(data as { error?: string }).error ?? JSON.stringify(data)}`);
      return;
    }
    setVariant('ok');
    setMsg('Receipt voided.');
    setVoidReason('');
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Void formal receipt</CardTitle>
        <CardDescription>Applies to rows in the `receipts` table (money-in), not the personal cash log.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="rid" label="Receipt ID (UUID)">
            <Input id="rid" value={receiptId} onChange={(e) => setReceiptId(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field id="why" label="Void reason">
            <Textarea id="why" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} />
          </Field>
          <Button type="submit" variant="destructive" disabled={loading}>
            {loading ? 'Voiding…' : 'Void receipt'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}

function RefundReceiptTab({
  apiBase,
  adminKey,
  requireKey,
}: {
  apiBase: string;
  adminKey: string;
  requireKey: () => string | null;
}) {
  const [paymentRefundId, setPaymentRefundId] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [notes, setNotes] = useState('');
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
    if (!paymentRefundId.trim() || !issuedBy.trim()) {
      setVariant('err');
      setMsg('payment_refund_id and issued_by are required.');
      return;
    }
    setLoading(true);
    setMsg(null);
    const { ok, status, data } = await adminFetch<{ ok?: boolean; receipt_id?: string; error?: string }>(
      apiBase,
      adminKey,
      '/api/admin/billing/receipts/issue-for-refund',
      {
        method: 'POST',
        json: {
          payment_refund_id: paymentRefundId.trim(),
          issued_by: issuedBy.trim(),
          notes: notes.trim() || undefined,
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
    setMsg(`Refund receipt issued. receipt_id=${data.receipt_id ?? ''}`);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Issue refund receipt</CardTitle>
        <CardDescription>Formal billing only: requires an existing `payment_refunds` row.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="prid" label="Payment refund ID (UUID)">
            <Input
              id="prid"
              value={paymentRefundId}
              onChange={(e) => setPaymentRefundId(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>
          <Field id="ib" label="Issued by (your name)">
            <Input id="ib" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} />
          </Field>
          <Field id="n" label="Notes (optional)">
            <Textarea id="n" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <Button type="submit" disabled={loading}>
            {loading ? 'Issuing…' : 'Issue refund receipt'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
      </CardContent>
    </Card>
  );
}
