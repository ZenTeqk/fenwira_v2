/**
 * Transactional email templates. Plain, table-free HTML so every client renders them; the brand
 * color below is the email equivalent of `primary-strong` (docs/DESIGN_SYSTEM.md).
 */
const BUTTON =
  'background:#007F64;color:#FFFFFF;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block'
const WRAP =
  'font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A;font-size:14px;line-height:22px;max-width:520px'

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

function layout(
  title: string,
  lines: string[],
  cta: { label: string; url: string },
  footer: string,
) {
  const html = `<div style="${WRAP}"><p style="font-size:18px;font-weight:600">${escape(title)}</p>${lines
    .map((l) => `<p>${escape(l)}</p>`)
    .join(
      '',
    )}<p><a href="${escape(cta.url)}" style="${BUTTON}">${escape(cta.label)}</a></p><p style="color:#64748B;font-size:13px">${escape(
    footer,
  )}<br/>If the button doesn't work, paste this link into your browser:<br/>${escape(cta.url)}</p></div>`
  const text = `${title}\n\n${lines.join('\n\n')}\n\n${cta.label}: ${cta.url}\n\n${footer}\n`
  return { html, text }
}

export function verificationEmail(name: string, url: string) {
  return {
    subject: 'Verify your email for Fenwira',
    ...layout(
      `Hi ${name}, confirm your email`,
      ['Confirm your email address to finish setting up your Fenwira account.'],
      { label: 'Verify email', url },
      'This link expires in 24 hours.',
    ),
  }
}

export function passwordResetEmail(name: string, url: string) {
  return {
    subject: 'Reset your Fenwira password',
    ...layout(
      `Hi ${name}, reset your password`,
      [
        'We received a request to reset your password. Signing in with the new password logs you out everywhere else.',
      ],
      { label: 'Choose a new password', url },
      "This link expires in 1 hour. If you didn't ask for this, you can ignore this email.",
    ),
  }
}

/**
 * Low balance / insufficient funds (P11-D12). Amounts are pre-formatted by the caller. Top-ups
 * are manual and made by the Fenwira team (P11-D13); no payment link exists (P11-D19).
 */
export function walletLowBalanceEmail(
  name: string,
  workspace: string,
  state: 'LOW_BALANCE' | 'INSUFFICIENT_FUNDS',
  available: string,
  url: string,
) {
  const out = state === 'INSUFFICIENT_FUNDS'
  return {
    subject: out
      ? `${workspace}: WhatsApp sends are paused, add credits`
      : `${workspace}: your Fenwira wallet balance is low`,
    ...layout(
      out ? `Hi ${name}, your wallet is out of credits` : `Hi ${name}, your wallet is running low`,
      [
        `${workspace} has ${available} available.`,
        out
          ? 'Template messages, including those sent by campaigns and automations, are refused until credits are added. Inbound messages and free-form replies inside the 24-hour window continue.'
          : 'Template messages, including those sent by campaigns and automations, stop when the balance runs out.',
        'Credits are added by the Fenwira team. Contact Fenwira to arrange a top-up.',
      ],
      { label: 'Open wallet', url },
      'You get this email because you can view billing for this workspace.',
    ),
  }
}

export function invitationEmail(inviter: string, workspace: string, role: string, url: string) {
  return {
    subject: `${inviter} invited you to ${workspace} on Fenwira`,
    ...layout(
      `Join ${workspace} on Fenwira`,
      [`${inviter} invited you to join ${workspace} as ${role}.`],
      { label: 'Accept invitation', url },
      'This invitation expires in 7 days.',
    ),
  }
}
