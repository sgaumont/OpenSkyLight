import { existsSync, readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'
import type { FcmStatus } from '@shared/types'

/** One data-only message for the Android app (it builds the notification itself). */
export interface FcmMessage {
  token: string
  /** FCM data values must all be strings */
  data: Record<string, string>
}

/** Sends one message; throws with `statusCode` (and `gone` when the phone's token is dead). */
export type FcmSender = (msg: FcmMessage) => Promise<void>

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

/** What the HTTP call needs; swapped out in tests. */
export type FcmPost = (url: string, accessToken: string, body: unknown) => Promise<{ status: number; json: unknown }>

const fetchPost: FcmPost = async (url, accessToken, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** True when FCM says this token will never work again (app uninstalled, data cleared). */
export function fcmTokenGone(status: number, json: unknown): boolean {
  if (status === 404) return true
  const details = (json as { error?: { details?: { errorCode?: string }[] } } | null)?.error?.details ?? []
  return details.some((d) => d.errorCode === 'UNREGISTERED')
}

/**
 * Firebase Cloud Messaging (HTTP v1) with a service-account key the user drops into userData
 * (`fcm-service-account.json` — never in the repo). No key, or a broken one → `null`, and only
 * Web Push goes out. The file is looked for again on each send, so adding it needs no restart.
 */
export function createFcm(keyFile: string, deps: { post?: FcmPost; token?: (key: ServiceKey) => Promise<string> } = {}) {
  const post = deps.post ?? fetchPost
  let cached: { raw: string; key: ServiceKey; client: JWT } | null = null
  let warned = ''
  let lastError: string | null = null

  function load(): { key: ServiceKey; client: JWT } | null {
    lastError = null
    if (!existsSync(keyFile)) return null
    try {
      const text = readFileSync(keyFile, 'utf8')
      if (cached?.raw === text) return cached
      const key = JSON.parse(text) as ServiceKey
      if (!key.project_id || !key.client_email || !key.private_key) throw new Error('missing project_id / client_email / private_key')
      const client = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] })
      cached = { raw: text, key, client }
      warned = ''
      return cached
    } catch (e) {
      const msg = (e as Error).message
      lastError = msg
      if (warned !== msg) console.warn('[notify] FCM key unusable:', msg)
      warned = msg
      return null
    }
  }

  async function accessToken(c: { key: ServiceKey; client: JWT }): Promise<string> {
    if (deps.token) return deps.token(c.key)
    const t = await c.client.getAccessToken()
    if (!t.token) throw new Error('no FCM access token')
    return t.token
  }

  /** The sender, or null while there's no usable key. */
  function sender(): FcmSender | null {
    const c = load()
    if (!c) return null
    return async (msg) => {
      const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(c.key.project_id)}/messages:send`
      const { status, json } = await post(url, await accessToken(c), {
        message: { token: msg.token, data: msg.data, android: { priority: 'HIGH', ttl: '900s' } }
      })
      if (status >= 200 && status < 300) return
      throw Object.assign(new Error(`FCM ${status}`), { statusCode: status, gone: fcmTokenGone(status, json) })
    }
  }

  /** For Settings: is there a usable key, and for which Firebase project. */
  function status(): FcmStatus {
    const c = load()
    if (c) return { state: 'ready', projectId: c.key.project_id, clientEmail: c.key.client_email, keyPath: keyFile }
    if (lastError) return { state: 'invalid', error: lastError, keyPath: keyFile }
    return { state: 'missing', keyPath: keyFile }
  }

  return { sender, status }
}


export interface ServiceKey {
  project_id: string
  client_email: string
  private_key: string
}
