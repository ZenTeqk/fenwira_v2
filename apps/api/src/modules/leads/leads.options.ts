export type LeadsWorkerOptions = {
  /** Where lead emails go (the Fenwira team inbox). */
  teamEmail: string
  /** The web app origin, for the operator console link in the email. */
  webOrigin: string
}
export const LEADS_WORKER_OPTIONS = Symbol('LEADS_WORKER_OPTIONS')
export const LEADS_TEAM_EMAIL = 'fenwira@zenteqk.com'
