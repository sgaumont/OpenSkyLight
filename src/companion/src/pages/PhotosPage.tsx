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
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

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

  async function remove(name: string): Promise<void> {
    try {
      await deletePhoto(name)
    } finally {
      setSelected(null)
      setConfirming(false)
      void queryClient.invalidateQueries({ queryKey: ['phonePhotos'] })
    }
  }

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
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <Thumb
              key={p.name}
              photo={p}
              selected={selected === p.name}
              confirming={confirming && selected === p.name}
              onSelect={() => {
                setSelected(selected === p.name ? null : p.name)
                setConfirming(false)
              }}
              onDelete={() => (confirming ? void remove(p.name) : setConfirming(true))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Thumb({
  photo,
  selected,
  confirming,
  onSelect,
  onDelete
}: {
  photo: PhonePhoto
  selected: boolean
  confirming: boolean
  onSelect: () => void
  onDelete: () => void
}) {
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
    <div className="relative aspect-square overflow-hidden rounded-xl bg-paper-deep">
      <button type="button" onClick={onSelect} className="block h-full w-full" aria-label="Photo options">
        {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      </button>
      {selected && (
        <button
          type="button"
          onClick={onDelete}
          className="pressable absolute inset-x-1.5 bottom-1.5 rounded-lg bg-ember px-2 py-1.5 text-sm font-extrabold text-white"
        >
          {confirming ? 'Tap to delete' : 'Delete'}
        </button>
      )}
    </div>
  )
}
