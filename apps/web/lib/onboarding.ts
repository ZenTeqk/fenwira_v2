/**
 * The welcome message an operator sends a new workspace owner (Managed Launch: no email needed).
 * Plain text, so it pastes cleanly into WhatsApp, email or chat.
 */
export function ownerWelcomeMessage(input: {
  ownerName: string
  workspaceName: string
  /** Null when the owner already had an account (they sign in with their password). */
  setupLink: string | null
  setupExpiresAt: string | null
  appOrigin: string
}): string {
  const first = input.ownerName.trim().split(/\s+/)[0] || 'there'
  const login = `${input.appOrigin}/login`
  const until = input.setupExpiresAt
    ? ` It works once, until ${new Date(input.setupExpiresAt).toUTCString().replace(' GMT', ' UTC')}.`
    : ''
  const access = input.setupLink
    ? `1. Set your password with this link:\n${input.setupLink}\n${until.trim()}`
    : `1. Sign in with your existing Fenwira password at ${login}`
  return [
    `Hi ${first}, welcome to Fenwira! Your workspace "${input.workspaceName}" is ready.`,
    '',
    access,
    `2. After that, sign in any time at ${login}`,
    '3. Invite your team from Settings → Team. We will connect your WhatsApp number with you.',
    '',
    'Questions? Reply to this message or write to fenwira@zenteqk.com.',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n')
}
