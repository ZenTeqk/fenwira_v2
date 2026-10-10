import { type WhatsAppSignupConfig } from '@fenwira/contracts'

/**
 * Meta Embedded Signup in the browser (docs/META_INTEGRATION.md → Embedded Signup flow):
 * FB.login with the configuration ID returns a code, and the popup posts the chosen WABA and
 * phone number IDs as a WA_EMBEDDED_SIGNUP message. Both are needed for POST /whatsapp/connections.
 */
type FacebookSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void
}
declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

export type SignupResult = { code: string; wabaId: string; phoneNumberId: string }

let sdk: Promise<FacebookSdk> | undefined

function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  sdk ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version })
      resolve(window.FB!)
    }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      sdk = undefined
      reject(new Error('Could not load the Facebook SDK. Check your connection or ad blocker.'))
    }
    document.body.appendChild(script)
  })
  return sdk
}

export async function launchEmbeddedSignup(config: WhatsAppSignupConfig): Promise<SignupResult> {
  if (!config.appId || !config.configId) throw new Error('Embedded Signup is not configured.')
  const fb = await loadSdk(config.appId, config.graphVersion)
  return new Promise<SignupResult>((resolve, reject) => {
    let ids: { wabaId: string; phoneNumberId: string } | undefined
    let code: string | undefined
    const finish = () => {
      if (!ids || !code) return
      window.removeEventListener('message', onMessage)
      resolve({ code, ...ids })
    }
    const onMessage = (event: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return
      let data: { type?: string; event?: string; data?: Record<string, string> }
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data.event === 'FINISH' && data.data?.waba_id && data.data.phone_number_id) {
        ids = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id }
        finish()
      } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
        window.removeEventListener('message', onMessage)
        reject(new Error('Signup was cancelled before a number was chosen.'))
      }
    }
    window.addEventListener('message', onMessage)
    fb.login(
      (response) => {
        code = response.authResponse?.code ?? undefined
        if (!code) {
          window.removeEventListener('message', onMessage)
          reject(new Error('Signup was cancelled.'))
          return
        }
        finish()
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: 3 },
      },
    )
  })
}
