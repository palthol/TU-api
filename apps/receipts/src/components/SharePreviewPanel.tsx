import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  buildFormalShareText,
  buildInvoiceShareText,
  buildQuickShareText,
  formalCardFields,
  invoiceCardFields,
  quickCardFields,
  type FormalShareInput,
  type InvoiceShareInput,
  type QuickShareInput,
} from '@/lib/shareFormats';

export type SharePreviewKind = 'quick' | 'invoice' | 'formal';

export type SharePreviewPayload =
  | { kind: 'quick'; data: QuickShareInput }
  | { kind: 'invoice'; data: InvoiceShareInput }
  | { kind: 'formal'; data: FormalShareInput };

function buildSmsText(payload: SharePreviewPayload): string {
  if (payload.kind === 'quick') return buildQuickShareText(payload.data);
  if (payload.kind === 'invoice') return buildInvoiceShareText(payload.data);
  return buildFormalShareText(payload.data);
}

function cardRows(payload: SharePreviewPayload): { label: string; value: string }[] {
  if (payload.kind === 'quick') return quickCardFields(payload.data);
  if (payload.kind === 'invoice') return invoiceCardFields(payload.data);
  return formalCardFields(payload.data);
}

export function SharePreviewPanel({ payload, title = 'Share preview' }: { payload: SharePreviewPayload; title?: string }) {
  const [mode, setMode] = useState<'text' | 'card'>('text');
  const sms = buildSmsText(payload);
  const rows = cardRows(payload);

  async function copySms() {
    try {
      await navigator.clipboard.writeText(sms);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-6 space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant={mode === 'text' ? 'default' : 'outline'} onClick={() => setMode('text')}>
            Text (SMS)
          </Button>
          <Button type="button" size="sm" variant={mode === 'card' ? 'default' : 'outline'} onClick={() => setMode('card')}>
            Card (screen)
          </Button>
        </div>
      </div>

      {mode === 'text' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">This is what gets copied / shared (plain text).</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
            {sms}
          </pre>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copySms()}>
            Copy text
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            On-screen card layout (tweak Tailwind in SharePreviewPanel). Later you can screenshot or export as image.
          </p>
          <div className="mx-auto max-w-sm rounded-xl border-2 border-foreground/10 bg-card p-5 shadow-sm">
            <div className="space-y-3">
              {rows.map((row, i) => (
                <div key={i} className={i === 0 ? 'border-b border-border pb-3' : 'flex flex-col gap-0.5'}>
                  {i === 0 ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</p>
                      <p className="text-lg font-semibold tracking-tight">{row.value}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">{row.label}</p>
                      <p className="break-all font-mono text-sm">{row.value}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
