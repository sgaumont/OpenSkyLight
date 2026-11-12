/**
 * The kiosk's pairing QR code is a link to the phone web app with the token in the fragment:
 * `http://192.168.1.20:8420/#t=abc…` (or the Tailscale `https://surface.tail1234.ts.net/#t=abc…`).
 * The Android app reads the same code: the kiosk's address and the token.
 */
export function parsePairingLink(raw: string): { base: string; token: string } | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const token = url.hash.match(/[#&]t=([A-Za-z0-9_-]+)/)?.[1]
  if (!token) return null
  return { base: url.origin, token }
}

/**
 * Every address the app should try, best first: the kiosk's home Wi-Fi ones, then its Tailscale
 * https one, then the one the code was scanned from (if the kiosk didn't list it). No duplicates,
 * no trailing slashes.
 */
export function kioskBases(scanned: string, listed: { lan: string[]; secure: string | null } | null): string[] {
  const all = [...(listed?.lan ?? []), ...(listed?.secure ? [listed.secure] : []), scanned]
  return [...new Set(all.map((b) => b.replace(/\/+$/, '')).filter(Boolean))]
}
