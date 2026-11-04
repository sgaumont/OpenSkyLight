import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, EmptyNote } from '../components/ui'
import { deletePhoto, listPhotos, shrinkPhoto, thumbUrl, uploadPhoto, type PhonePhoto } from '../api/photos'

/** Photos sent from phones to the kiosk's screensaver: add from the camera roll, or remove. */
export function PhotosPage() {
  const queryClient = useQueryClient()
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['phonePhotos'],
    queryFn: listPhotos,
    refetchOnWindowFocus: true
  })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<string | null>(null)
  // select mode: tick photos, then delete them together
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null)

  async function send(files: File[]): Promise<void> {
    setResult(null)
    let added = 0
    const failed: string[] = []
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length })
      try {
        await uploadPhoto(await shrinkPhoto(files[i]))
        added++
      } catch (err) {
        failed.push(err instanceof Error ? err.message : 'A photo failed')
      }
    }
    setProgress(null)
    void queryClient.invalidateQueries({ queryKey: ['phonePhotos'] })
    setResult(
      [added > 0 ? `Added ${added} ✓ — they'll be on the screensaver next.` : '', failed.length > 0 ? `${failed.length} didn't send (${failed[0]}).` : '']
        .filter(Boolean)
        .join(' ')
    )
  }

  function stopSelecting(): void {
    setSelecting(false)
    setPicked(new Set())
    setConfirming(false)
  }

  /** Ticks or unticks a photo; tapping one outside select mode starts it. */
  function toggle(name: string): void {
    setSelecting(true)
    setConfirming(false)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function removePicked(): Promise<void> {
    const names = [...picked]
    let failed = 0
    for (let i = 0; i < names.length; i++) {
      setDeleting({ done: i, total: names.length })
      try {
        await deletePhoto(names[i])
      } catch {
        failed++
      }
    }
    setDeleting(null)
    stopSelecting()
    setResult(failed > 0 ? `${failed} couldn't be deleted — try again.` : `Deleted ${names.length} ✓`)
    void queryClient.invalidateQueries({ queryKey: ['phonePhotos'] })
  }

  const count = picked.size
  const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <label
          className={`pressable flex min-h-12 items-center justify-center rounded-xl bg-ember px-4 text-base font-extrabold text-white ${
            progress ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {progress ? `Sending ${progress.done + 1} of ${progress.total}…` : '+ Add photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={progress !== null}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length > 0) void send(files.slice(0, 20))
            }}
          />
        </label>
        <p className="mt-2 text-sm font-semibold text-ink-faint">
          Up to 20 at a time. Photos are made screen-sized and their location is removed before sending.
        </p>
        {result && <p className="mt-2 text-sm font-bold text-ink-soft">{result}</p>}
      </Card>

      {isLoading ? null : photos.length === 0 ? (
        <EmptyNote>No photos sent from phones yet.</EmptyNote>
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-sm font-bold text-ink-faint">
              {selecting ? (count > 0 ? `${plural(count)} selected` : 'Tap photos to select them') : plural(photos.length)}
            </span>
            {selecting ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(new Set(photos.map((p) => p.name)))
                    setConfirming(false)
                  }}
                  className="pressable rounded-full px-3 py-1.5 text-sm font-extrabold text-ember"
                >
                  Select all
                </button>
                <button type="button" onClick={stopSelecting} className="pressable rounded-full px-3 py-1.5 text-sm font-extrabold text-ink-soft">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelecting(true)}
                className="pressable rounded-full border-2 border-line px-4 py-1.5 text-sm font-extrabold text-ink-soft"
              >
                Select
              </button>
            )}
          </div>
          <div className={`grid grid-cols-3 gap-2 ${count > 0 ? 'pb-20' : ''}`}>
            {photos.map((p) => (
              <Thumb key={p.name} photo={p} selecting={selecting} picked={picked.has(p.name)} onTap={() => toggle(p.name)} />
            ))}
          </div>
        </div>
      )}

      {/* the delete bar: shown once something is ticked; a second tap confirms */}
      {selecting && count > 0 && (
        <div className="fixed inset-x-0 z-20 px-4" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
          <button
            type="button"
            disabled={deleting !== null}
            onClick={() => (confirming ? void removePicked() : setConfirming(true))}
            className="pressable min-h-12 w-full rounded-xl bg-ember px-4 text-base font-extrabold text-white shadow-lg disabled:opacity-70"
          >
            {deleting
              ? `Deleting ${deleting.done + 1} of ${deleting.total}…`
              : confirming
                ? `Tap again to delete ${plural(count)}`
                : `Delete ${plural(count)}`}
          </button>
        </div>
      )}
    </div>
  )
}

function Thumb({ photo, selecting, picked, onTap }: { photo: PhonePhoto; selecting: boolean; picked: boolean; onTap: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let live = true
    thumbUrl(photo.name)
      .then((u) => {
        url = u
        if (live) setSrc(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => {})
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [photo.name])

  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={picked}
      aria-label={picked ? 'Photo, selected' : 'Photo'}
      className={`relative block aspect-square overflow-hidden rounded-xl bg-paper-deep ${picked ? 'ring-4 ring-ember' : ''}`}
    >
      {src && <img src={src} alt="" className={`h-full w-full object-cover ${picked ? 'opacity-75' : ''}`} />}
      {/* the tick circle only shows in select mode */}
      {selecting && (
        <span
          className={`absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold ${
            picked ? 'bg-ember text-white' : 'border-2 border-white bg-black/25'
          }`}
        >
          {picked ? '✓' : ''}
        </span>
      )}
    </button>
  )
}
