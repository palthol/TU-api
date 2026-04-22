/**
 * Plain-text and structured labels for SMS / share-sheet previews.
 * Edit here and run `npm run test --workspace apps/receipts` to lock intended wording.
 */

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export type QuickShareInput = {
  name: string;
  amountCents: number;
  entryId: string;
  notes?: string | null;
};

export function buildQuickShareText(params: QuickShareInput): string {
  const amt = formatUsdFromCents(params.amountCents);
  const noteLine = params.notes?.trim() ? ` Note: ${params.notes.trim()}.` : '';
  return `Temple Underground — cash logged for ${params.name.trim()}. Amount: ${amt}. Log entry ID: ${params.entryId}.${noteLine} Questions? Reply to this message.`;
}

export type InvoiceShareInput = {
  name: string;
  amountCents: number;
  dueAt: string;
  entryId: string;
  status: string;
};

export function buildInvoiceShareText(params: InvoiceShareInput): string {
  const amt = formatUsdFromCents(params.amountCents);
  return `Temple Underground — invoice (${params.status}) for ${params.name.trim()}. Amount: ${amt}. Due: ${params.dueAt}. Entry ID: ${params.entryId}. Reply to this message if you have questions.`;
}

export type FormalShareInput = {
  name?: string;
  amountCents: number;
  paymentId: string;
  receiptId: string | null;
  issuedBy?: string;
};

export function buildFormalShareText(params: FormalShareInput): string {
  const amt = formatUsdFromCents(params.amountCents);
  const who = params.name?.trim() ? ` for ${params.name.trim()}` : '';
  const receiptLine = params.receiptId ? ` Receipt ID: ${params.receiptId}.` : '';
  const by = params.issuedBy?.trim() ? ` Recorded by: ${params.issuedBy.trim()}.` : '';
  return `Temple Underground — payment recorded${who}. Amount: ${amt}. Payment ID: ${params.paymentId}.${receiptLine}${by} Questions? Reply to this message.`;
}

/** Labels for the “card” layout (not SMS — on-screen / screenshot / future image export). */
export function formalCardFields(params: FormalShareInput): { label: string; value: string }[] {
  const body: { label: string; value: string }[] = [];
  if (params.name?.trim()) body.push({ label: 'Member', value: params.name.trim() });
  body.push(
    { label: 'Amount', value: formatUsdFromCents(params.amountCents) },
    { label: 'Payment ID', value: params.paymentId },
  );
  if (params.receiptId) body.push({ label: 'Receipt ID', value: params.receiptId });
  if (params.issuedBy?.trim()) body.push({ label: 'Recorded by', value: params.issuedBy.trim() });
  return [{ label: 'Temple Underground', value: 'Payment confirmation' }, ...body];
}

export function quickCardFields(params: QuickShareInput): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Member', value: params.name.trim() },
    { label: 'Amount', value: formatUsdFromCents(params.amountCents) },
    { label: 'Log entry ID', value: params.entryId },
  ];
  if (params.notes?.trim()) rows.push({ label: 'Notes', value: params.notes.trim() });
  rows.unshift({ label: 'Temple Underground', value: 'Cash log' });
  return rows;
}

export function invoiceCardFields(params: InvoiceShareInput): { label: string; value: string }[] {
  return [
    { label: 'Temple Underground', value: 'Invoice' },
    { label: 'Member', value: params.name.trim() },
    { label: 'Amount due', value: formatUsdFromCents(params.amountCents) },
    { label: 'Due date', value: params.dueAt },
    { label: 'Status', value: params.status },
    { label: 'Entry ID', value: params.entryId },
  ];
}
