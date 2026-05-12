import { describe, expect, it } from 'vitest';
import {
  buildFormalShareText,
  buildInvoiceShareText,
  buildQuickShareText,
  formalCardFields,
  formatUsdFromCents,
} from './shareFormats';

describe('formatUsdFromCents', () => {
  it('formats whole dollars', () => {
    expect(formatUsdFromCents(8900)).toBe('$89.00');
  });
});

describe('buildQuickShareText', () => {
  it('includes member, amount, id, and closing line', () => {
    expect(
      buildQuickShareText({
        name: 'Alex Rivera',
        amountCents: 1500,
        entryId: 'e1',
        notes: null,
      }),
    ).toBe(
      'Temple Underground — cash logged for Alex Rivera. Amount: $15.00. Log entry ID: e1. Questions? Reply to this message.',
    );
  });

  it('appends note when present', () => {
    const t = buildQuickShareText({
      name: 'Alex Rivera',
      amountCents: 1500,
      entryId: 'e1',
      notes: 'Day pass',
    });
    expect(t).toContain('Note: Day pass.');
    expect(t).toContain('Questions? Reply to this message.');
  });
});

describe('buildInvoiceShareText', () => {
  it('includes status and due date', () => {
    expect(
      buildInvoiceShareText({
        name: 'Alex Rivera',
        amountCents: 8900,
        dueAt: '2026-04-30',
        entryId: 'inv-1',
        status: 'draft',
      }),
    ).toBe(
      'Temple Underground — invoice (draft) for Alex Rivera. Amount: $89.00. Due: 2026-04-30. Entry ID: inv-1. Reply to this message if you have questions.',
    );
  });
});

describe('buildFormalShareText', () => {
  it('includes payment id and optional receipt and issued by', () => {
    expect(
      buildFormalShareText({
        name: 'Alex Rivera',
        amountCents: 8900,
        paymentId: 'pay-1',
        receiptId: 'rcpt-1',
        issuedBy: 'Jordan',
      }),
    ).toBe(
      'Temple Underground — payment recorded for Alex Rivera. Amount: $89.00. Payment ID: pay-1. Receipt ID: rcpt-1. Recorded by: Jordan. Questions? Reply to this message.',
    );
  });

  it('omits name, receipt, and issued-by lines when absent', () => {
    expect(
      buildFormalShareText({
        amountCents: 100,
        paymentId: 'pay-2',
        receiptId: null,
      }),
    ).toBe(
      'Temple Underground — payment recorded. Amount: $1.00. Payment ID: pay-2. Questions? Reply to this message.',
    );
  });
});

describe('formalCardFields', () => {
  it('puts branding header first', () => {
    const rows = formalCardFields({
      name: 'Alex',
      amountCents: 100,
      paymentId: 'p',
      receiptId: 'r',
      issuedBy: 'Jordan',
    });
    expect(rows[0]).toEqual({ label: 'Temple Underground', value: 'Payment confirmation' });
  });
});
