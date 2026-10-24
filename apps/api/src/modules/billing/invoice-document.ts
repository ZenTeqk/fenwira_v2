import { type InvoiceDetail } from '@fenwira/contracts'

/**
 * Printable, self-contained HTML for a payment request or its receipt (ADR-0027, ML-D3). No
 * scripts, no external resources; every interpolated value is escaped. Titled "Payment request" /
 * "Receipt", never "Tax invoice": GST invoicing rules are undecided (Q22, P11-D14).
 */
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100)
const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—'

export function invoiceDocument(
  inv: InvoiceDetail,
  workspace: { name: string },
  kind: 'request' | 'receipt',
): string {
  const title =
    kind === 'receipt' ? `Receipt ${inv.receiptNumber ?? ''}` : `Payment request ${inv.number}`
  const rows = [
    ['Workspace', workspace.name],
    ['Reference', inv.number],
    ...(kind === 'receipt'
      ? [
          ['Receipt', inv.receiptNumber ?? '—'],
          ['Paid on', date(inv.paidAt)],
        ]
      : []),
    ['Issued', date(inv.issuedAt)],
    ['Due', date(inv.dueAt)],
    ['Payee', `${inv.payee.name} (${inv.payee.vpa})`],
    ...(inv.gstin ? [['GSTIN', inv.gstin]] : []),
  ]
  const approved = inv.proofs.find((p) => p.status === 'APPROVED')
  const lines = [
    [inv.description, money(inv.subtotalMinor, inv.currency)],
    ...inv.taxLines.map((t) => [t.label, money(t.amountMinor, inv.currency)]),
  ]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Fenwira</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18201D; background: #FFFFFF; margin: 0; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .muted { color: #4B5550; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #E5E7E3; vertical-align: top; }
  td.amount, th.amount { text-align: right; }
  tfoot td { font-weight: 600; border-bottom: none; }
  .pay { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; border: 1px solid #D6D9D4; border-radius: 8px; padding: 16px; }
  .pay img { width: 240px; height: 240px; image-rendering: pixelated; }
  .note { font-size: 13px; color: #4B5550; margin-top: 24px; }
  @media print { main { padding: 0; } }
</style>
</head>
<body>
<main>
  <p class="muted">Fenwira</p>
  <h1>${esc(title)}</h1>
  <p class="muted">${kind === 'receipt' ? 'Payment received with thanks.' : 'Please pay by UPI using the details below.'}</p>
  <table aria-label="Details"><tbody>
    ${rows.map(([k, v]) => `<tr><th scope="row">${esc(k!)}</th><td>${esc(v!)}</td></tr>`).join('\n    ')}
  </tbody></table>
  <table aria-label="Amounts">
    <thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead>
    <tbody>
    ${lines.map(([k, v]) => `<tr><td>${esc(k!)}</td><td class="amount">${esc(v!)}</td></tr>`).join('\n    ')}
    </tbody>
    <tfoot><tr><td>Total</td><td class="amount">${esc(money(inv.totalMinor, inv.currency))}</td></tr></tfoot>
  </table>
  ${
    kind === 'receipt' && approved
      ? `<p>UPI reference (UTR): <strong>${esc(approved.utr)}</strong></p>`
      : inv.upi
        ? `<div class="pay"><img src="${esc(inv.upi.qrDataUrl)}" alt="UPI QR code for ${esc(inv.number)}"><div><p><strong>Scan with any UPI app</strong> or pay to <strong>${esc(inv.payee.vpa)}</strong>.</p><p>Amount: ${esc(money(inv.totalMinor, inv.currency))}<br>Note / reference: ${esc(inv.number)}</p><p>After paying, submit the UTR in Fenwira → Billing → Invoices.</p></div></div>`
        : ''
  }
  <p class="note">${inv.gstin ? '' : 'This is a payment request / receipt, not a tax invoice. '}Meta's WhatsApp conversation charges are billed by Meta to your own Meta payment method and are not part of this amount.</p>
</main>
</body>
</html>
`
}
