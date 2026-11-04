import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'

const TOKEN_KEY = 'osl.companionToken'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Pull a pairing token out of the QR URL fragment (#t=…), then scrub it. */
export function adoptTokenFromUrl(): void {
  const match = window.location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/)
  if (match) {
    setToken(match[1])
    history.replaceState(null, '', window.location.pathname)
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export class RpcError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Same shape as the kiosk renderer's ipcInvoke, over HTTP. */
export async function rpc<K extends IpcChannel>(
  channel: K,
  req: IpcContract[K]['req']
): Promise<IpcContract[K]['res']> {
  const res = await fetch(`/api/rpc/${channel}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken() ?? ''}`,
      'Content-Type': 'application/json'
    },
    body: req === undefined ? '' : JSON.stringify(req)
  })
  if (res.status === 401) {
    clearToken()
    onUnauthorized()
    throw new RpcError('UNAUTHORIZED', 'Not paired')
  }
  const json = (await res.json()) as IpcResult<IpcContract[K]['res']>
  if (!json.ok) throw new RpcError(json.error.code, json.error.message)
  return json.data
}

/** fetch with the pairing token; a 401 drops back to the pairing screen, like rpc(). */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${getToken() ?? ''}` }
  })
  if (res.status === 401) {
    clearToken()
    onUnauthorized()
    throw new RpcError('UNAUTHORIZED', 'Not paired')
  }
  return res
}
