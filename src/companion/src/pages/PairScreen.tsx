import { useState } from 'react'
import { GhostButton } from '../components/ui'
import { isNativeApp } from '../api/base'
import { pairWithLink } from '../api/client'

export function PairScreen({ onRetry }: { onRetry: () => void }) {
  const native = isNativeApp()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center" data-pair-screen>
      <img src="/icon-192.png" alt="" className="h-20 w-20 rounded-3xl shadow-card" />
      <h1 className="font-display text-3xl font-semibold">{native ? 'Family Skyview' : 'OpenSkyLight'}</h1>
      <p className="max-w-xs text-base font-semibold text-ink-soft">
        This phone isn't paired with the family display.
      </p>
      <ol className="max-w-xs list-decimal space-y-1.5 pl-5 text-left text-base font-semibold text-ink-soft">
        <li>On the display, open Settings → General</li>
        <li>
          Under <span className="font-extrabold">Companion app</span>, tap{' '}
          <span className="font-extrabold">Pair a phone</span>
        </li>
        <li>{native ? 'Tap Scan below and point this phone at the QR code' : "Scan the QR code with this phone's camera"}</li>
      </ol>
      {native ? <AppPairing onPaired={onRetry} /> : <GhostButton onClick={onRetry}>I've scanned it — retry</GhostButton>}
    </div>
  )
}

/** The Android app scans the display's QR code itself (or takes the link pasted in). */
function AppPairing({ onPaired }: { onPaired: () => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pair = async (raw: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await pairWithLink(raw)
      onPaired()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scan = async (): Promise<void> => {
    setError(null)
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE })
      if (result.ScanResult) await pair(result.ScanResult)
    } catch (e) {
      // closing the scanner isn't an error worth showing
      const msg = (e as Error).message ?? ''
      if (!/cancel/i.test(msg)) setError(msg || "Couldn't open the camera")
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void scan()}
        className="pressable min-h-13 rounded-full bg-ember text-lg font-extrabold text-white shadow-card disabled:opacity-50"
        data-scan
      >
        📷 Scan the QR code
      </button>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (link.trim()) void pair(link)
        }}
      >
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="…or paste the pairing link"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/15 bg-card px-3 text-base"
          data-pair-link
        />
        <button type="submit" disabled={busy || !link.trim()} className="pressable rounded-xl bg-paper-deep px-4 font-extrabold disabled:opacity-40">
          Pair
        </button>
      </form>
      {busy && <p className="text-sm font-bold text-ink-faint">Pairing…</p>}
      {error && (
        <p className="text-sm font-bold text-ember" data-pair-error>
          {error}
        </p>
      )}
    </div>
  )
}
