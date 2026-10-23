import { type InvoiceNotice } from '../billing'

export type InvoiceFacts = {
  number: string
  amount: string
  dueDate: string
  receiptNumber?: string | null
  reason?: string | null
}

/** Email and in-app copy for each manual-billing notice (plain, customer-facing). */
export function invoiceNoticeCopy(notice: InvoiceNotice, f: InvoiceFacts) {
  switch (notice) {
    case 'ISSUED':
      return {
        subject: `Payment request ${f.number}: ${f.amount}`,
        title: `a new payment request is ready`,
        lines: [
          `Amount: ${f.amount}. Due by ${f.dueDate}.`,
          'Pay by UPI with the QR or link on the invoice, then enter the UTR so we can confirm it.',
        ],
        cta: 'View and pay',
        severity: 'INFO' as const,
      }
    case 'DUE_SOON':
      return {
        subject: `Reminder: ${f.number} is due on ${f.dueDate}`,
        title: `your payment is due soon`,
        lines: [
          `${f.number} for ${f.amount} is due on ${f.dueDate}.`,
          'If you have already paid, enter the UTR on the invoice so we can confirm it.',
        ],
        cta: 'View and pay',
        severity: 'INFO' as const,
      }
    case 'OVERDUE':
      return {
        subject: `Overdue: ${f.number} (${f.amount})`,
        title: `your payment is overdue`,
        lines: [
          `${f.number} for ${f.amount} was due on ${f.dueDate}.`,
          'Please pay by UPI and enter the UTR to keep sending messages without interruption.',
        ],
        cta: 'Pay now',
        severity: 'WARNING' as const,
      }
    case 'PAID':
      return {
        subject: `Payment received: ${f.number}`,
        title: `thank you, we received your payment`,
        lines: [
          `Receipt ${f.receiptNumber ?? ''} for ${f.amount}.`.replace('  ', ' '),
          'You can download the receipt from Billing.',
        ],
        cta: 'View receipt',
        severity: 'INFO' as const,
      }
    case 'REJECTED':
      return {
        subject: `We couldn't verify your payment for ${f.number}`,
        title: `we couldn't verify your payment`,
        lines: [
          `Reason: ${f.reason ?? 'not given'}.`,
          'Please check the UTR and submit it again from the invoice.',
        ],
        cta: 'Submit again',
        severity: 'WARNING' as const,
      }
  }
}
