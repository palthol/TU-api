import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { adminFetch, getDefaultApiBase } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const PAYMENT_METHODS = ['cash', 'card', 'cashapp', 'venmo', 'paypal', 'zelle', 'other'] as const;

type TabId = 'record' | 'lookup' | 'void' | 'refund';

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

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function buildShareText(params: { name?: string; amountCents: number; paymentId: string; receiptId: string | null }) {
  const amt = formatUsdFromCents(params.amountCents);
  const who = params.name?.trim() ? ` for ${params.name.trim()}` : '';
  const receiptLine = params.receiptId ? ` Receipt ID: ${params.receiptId}.` : '';
  return `Temple Underground — payment recorded${who}. Amount: ${amt}. Payment ID: ${params.paymentId}.${receiptLine} Questions? Reply to this message.`;
}

export default function App() {
  const [apiBase, setApiBase] = useState(getDefaultApiBase);
  const [adminKey, setAdminKey] = useState('');
  const [tab, setTab] = useState<TabId>('record');

  const requireKey = useCallback(() => {
    if (!adminKey.trim()) return 'Enter your admin API key (x-admin-key).';
    return null;
  }, [adminKey]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Temple Underground — Receipts</h1>
            <p className="text-sm text-muted-foreground">
              Staff finance capture: record payments, issue receipts, void, and refund receipts. Use HTTPS and trusted
              devices only.
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
        <nav className="flex flex-wrap gap-2 border-t border-border px-4 py-2" aria-label="Receipts sections">
          {(
            [
              ['record', 'Record + receipt'],
              ['lookup', 'Lookup (board)'],
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
        {tab === 'record' && <RecordReceiptTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'lookup' && <LookupTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'void' && <VoidReceiptTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
        {tab === 'refund' && <RefundReceiptTab apiBase={apiBase} adminKey={adminKey} requireKey={requireKey} />}
      </main>
    </div>
  );
}

function RecordReceiptTab({
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
    return buildShareText({
      name: memberName,
      amountCents: last.amountCents,
      paymentId: last.paymentId,
      receiptId: last.receiptId ?? '',
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
    if (!accountId.trim() || !chargeId.trim() || !issuedBy.trim() || cents === null) {
      setVariant('err');
      setMsg('Account ID, charge ID, issued-by name, and a positive dollar amount are required.');
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
    setMsg(`Payment recorded. payment_id=${data.payment_id}${data.receipt_id ? ` receipt_id=${data.receipt_id}` : ''}`);
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
      setMsg('Unable to share or copy. Copy manually from the box below.');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Record payment + receipt</CardTitle>
        <CardDescription>
          Creates a succeeded payment with one allocation and optionally a money-in receipt. Use Lookup to pull IDs from
          the payment board.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="member-name" label="Member display name (optional, for SMS text)">
            <Input id="member-name" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field id="acct" label="Account ID (UUID)">
            <Input id="acct" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field id="chg" label="Charge ID (UUID)">
            <Input id="chg" value={chargeId} onChange={(e) => setChargeId(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field id="amt" label="Amount (USD)">
            <Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150.00" inputMode="decimal" />
          </Field>
          <Field id="meth" label="Method">
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
          <Field id="by" label="Issued by (display name)">
            <Input id="by" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="Front desk" />
          </Field>
          <Field id="ref" label="Reference (optional)">
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field id="notes" label="Notes (optional)">
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={issueReceipt} onChange={(e) => setIssueReceipt(e.target.checked)} />
            Issue money-in receipt
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Record payment'}
          </Button>
        </form>
        <StatusMessage message={msg} variant={variant} />
        {last && (
          <div className="mt-6 space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">Share / SMS draft</p>
            <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{shareText}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void onShare()}>
                Share or copy
              </Button>
            </div>
          </div>
        )}
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
    setMsg(`Loaded ${Array.isArray(data.rows) ? data.rows.length : 0} row(s).`);
  }, [apiBase, adminKey, requireKey]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Payment board lookup</CardTitle>
        <CardDescription>
          Read-only view of `view_member_payment_board`. Use account_id + charge_id on the Record tab. Tap a row to copy
          IDs (clipboard).
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
                      const line = `account_id=${aid}\ncharge_id=${cid}`;
                      void navigator.clipboard.writeText(line);
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
        <CardTitle className="text-base">Void receipt</CardTitle>
        <CardDescription>Soft void: sets voided_at + void_reason on the receipt row.</CardDescription>
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
        <CardDescription>
          Requires an existing `payment_refunds` row. Voids active money-in receipt for that payment (if any) and inserts
          money_out_refund.
        </CardDescription>
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
          <Field id="ib" label="Issued by (display name)">
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
