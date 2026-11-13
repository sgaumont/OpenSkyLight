import { mirrorToNative } from '../api/base'

/** This phone's name ("Mom's phone"), set in its 📱 screen and shown on the messages it sends. */
const KEY = 'osl.phoneName'
export const PHONE_NAME_MAX = 40

export function getPhoneName(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setPhoneName(name: string): void {
  try {
    const clean = name.trim().slice(0, PHONE_NAME_MAX)
    if (clean) localStorage.setItem(KEY, clean)
    else localStorage.removeItem(KEY)
    // the Android app's notification Reply button signs with it too
    mirrorToNative(KEY, clean || null)
    window.dispatchEvent(new Event('osl-phone-name'))
  } catch {
    // private browsing: messages just say "Phone"
  }
}
