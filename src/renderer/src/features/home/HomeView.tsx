import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_SETTINGS, type HomeTile, type HomeTileType } from '@shared/types'
import { sanitizeLayout } from '@shared/home'
import { stepTextSize, tileZoom } from '@shared/textSize'
import { useAuthMutations, useAuthStatus, useSettings, useSettingsMutation } from '../../api/hooks'
import { useUi } from '../../stores/uiStore'
import { BigButton } from '../../components/ui'
import { PinDialog } from '../../components/PinDialog'
import { GripIcon, PlusIcon, XIcon } from '../../components/icons'
import { TILE_REGISTRY } from './tileRegistry'
import { useHomeGrid } from './useHomeGrid'
import { AddTileSheet } from './AddTileSheet'

// memo matters: during a drag, HomeView re-renders at pointer-event rate and
// tile bodies (with their data hooks) must not re-execute for every move
const TileBody = memo(function TileBody({ tile, compact, zoom }: { tile: HomeTile; compact: boolean; zoom: number }) {
  const Component = TILE_REGISTRY[tile.type].component
  return (
    // flow-root: a child's negative margin (edge-to-edge camera/photo) must not
    // collapse through this wrapper, or the media sits short of the tile's top
    <div className="flow-root h-full" style={zoom !== 1 ? { zoom } : undefined}>
      <Component tile={tile} compact={compact} />
    </div>
  )
})

/**
 * Tile padding in px, the same on all sides: ~3.5% of the tile's shorter side,
 * scaled with the tile's own text size, between 3px and 8px × that size — small
 * tiles keep almost all their space for content.
 */
function tilePadding(widthPx: number, heightPx: number, zoom: number): number {
  return Math.round(Math.max(3, Math.min(8 * zoom, 0.035 * Math.min(widthPx, heightPx))))
}

/** Edge-to-edge media tiles have no text to size (and bleed past the padding, which zoom would break). */
const NO_TEXT_SIZE = new Set<HomeTileType>(['camera', 'photo'])

function withTileTextSize(tile: HomeTile, direction: 1 | -1): HomeTile {
  const textSize = stepTextSize(tile.config?.textSize ?? 100, direction)
  const { textSize: _old, ...rest } = tile.config ?? {}
  const config = textSize === 100 ? rest : { ...rest, textSize }
  return { ...tile, config: Object.keys(config).length > 0 ? config : undefined }
}

export function HomeView() {
  const { data: settings } = useSettings()
  const layout = useMemo(() => sanitizeLayout(settings?.homeLayout), [settings?.homeLayout])
  const [draft, setDraft] = useState<HomeTile[] | null>(null)
  const [pinPrompt, setPinPrompt] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const editing = draft !== null
  const effective = draft ?? layout
  const textSizes = settings?.textSize ?? DEFAULT_SETTINGS.textSize

  const { data: auth } = useAuthStatus()
  const authMutations = useAuthMutations()
  const mutation = useSettingsMutation()
  const setView = useUi((s) => s.setView)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const grid = useHomeGrid({
    containerRef,
    layout: effective,
    enabled: editing,
    onChange: (next) => setDraft(next)
  })

  const enterEdit = (): void => {
    // never edit before auth (fail-open) or settings (the draft would seed from
    // the DEFAULT layout and Done would overwrite the family's real layout)
    if (!auth || !settings) return
    if (auth.pinSet && !auth.unlocked) {
      setPinError(null)
      setPinPrompt(true)
    } else {
      setDraft(layout.map((t) => ({ ...t })))
    }
  }

  // the header's pencil asks for customize mode; remember the count seen on
  // mount so returning to Home never replays an old request
  const homeEditRequest = useUi((s) => s.homeEditRequest)
  const seenEditRequest = useRef(homeEditRequest)
  useEffect(() => {
    if (homeEditRequest === seenEditRequest.current) return
    seenEditRequest.current = homeEditRequest
    if (!editing) enterEdit()
  }, [homeEditRequest])

  const relock = (): void => {
    if (auth?.pinSet) authMutations.lock.mutate(undefined)
  }

  const save = (): void => {
    mutation.mutate(
      { homeLayout: draft! },
      {
        onSuccess: () => {
          setDraft(null)
          relock()
        }
      }
    )
  }

  const cancel = (): void => {
    setDraft(null)
    relock()
  }

  return (
    <div className="relative flex h-full flex-col px-6 pb-6">
      {/* in edit mode the grid shrinks to keep the bottom row clear of the floating chrome bar */}
      <div ref={containerRef} className={`relative min-h-0 flex-1 ${editing ? 'mb-24' : ''}`} data-home-grid {...(editing ? { 'data-no-swipe': '' } : {})}>
        {/* nothing renders until settings load (the fallback default layout must
            never be mistaken for the user's) and the grid is measured */}
        {settings != null &&
          grid.ready &&
          effective.map((tile) => {
          const zoom = NO_TEXT_SIZE.has(tile.type) ? 1 : tileZoom(textSizes, tile.config?.textSize)
          // bigger text makes the tile effectively smaller
          const compact = grid.spanW(tile.w) < 260 * zoom || grid.spanH(tile.h) < 170 * zoom
          const padStyle: CSSProperties = { padding: tilePadding(grid.spanW(tile.w), grid.spanH(tile.h), zoom) }
          const isActive = grid.activeTileId === tile.id
          if (!editing) {
            const navTarget = TILE_REGISTRY[tile.type].navTarget
            return (
              <button
                key={tile.id}
                type="button"
                data-tile-id={tile.id}
                data-tile-type={tile.type}
                style={{ ...grid.tileStyle(tile), ...padStyle }}
                onClick={() => navTarget && setView(navTarget)}
                className={`animate-rise rounded-card bg-card text-left shadow-card ${navTarget ? 'pressable' : 'cursor-default'} overflow-hidden`}
              >
                <TileBody tile={tile} compact={compact} zoom={zoom} />
              </button>
            )
          }
          return (
            <div
              key={tile.id}
              data-tile-id={tile.id}
              data-tile-type={tile.type}
              style={{ ...grid.tileStyle(tile), ...padStyle, touchAction: 'none' }}
              {...grid.tileHandlers(tile.id)}
              className={`rounded-card bg-card shadow-card select-none ${
                isActive ? 'ring-4 ring-ember' : 'ring-2 ring-ember/50'
              } overflow-hidden`}
            >
              {/* arranging: the tile's own taps (claim a chore, next photo) are off — drags hit the tile */}
              <div className="pointer-events-none h-full">
                <TileBody tile={tile} compact={compact} zoom={zoom} />
              </div>
              {/* text size */}
              {!NO_TEXT_SIZE.has(tile.type) && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-1.5 left-1.5 flex items-center rounded-full bg-ink/80 p-1 text-paper"
                >
                  <button
                    type="button"
                    aria-label={`Smaller text in ${TILE_REGISTRY[tile.type].label}`}
                    onClick={() => setDraft(effective.map((t) => (t.id === tile.id ? withTileTextSize(t, -1) : t)))}
                    className="pressable flex h-10 w-10 items-center justify-center rounded-full text-sm font-extrabold"
                  >
                    A−
                  </button>
                  <span className="min-w-11 text-center text-sm font-bold tabular-nums">{tile.config?.textSize ?? 100}%</span>
                  <button
                    type="button"
                    aria-label={`Larger text in ${TILE_REGISTRY[tile.type].label}`}
                    onClick={() => setDraft(effective.map((t) => (t.id === tile.id ? withTileTextSize(t, 1) : t)))}
                    className="pressable flex h-10 w-10 items-center justify-center rounded-full text-lg font-extrabold"
                  >
                    A+
                  </button>
                </div>
              )}
              {/* remove */}
              <button
                type="button"
                aria-label={`Remove ${TILE_REGISTRY[tile.type].label}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDraft(effective.filter((t) => t.id !== tile.id))}
                className="pressable absolute top-1.5 right-1.5 flex h-12 w-12 items-center justify-center rounded-full bg-ink/80 text-paper"
              >
                <XIcon size={18} />
              </button>
              {/* resize grip */}
              <div
                data-resize-handle
                {...grid.resizeHandlers(tile.id)}
                style={{ touchAction: 'none' }}
                className="absolute right-0 bottom-0 flex h-14 w-14 cursor-nwse-resize items-end justify-end p-2 text-ink-faint"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-deep">
                  <GripIcon size={18} />
                </span>
              </div>
            </div>
          )
        })}

        {grid.ghost && (
          <div
            className={`pointer-events-none absolute z-10 rounded-card border-[3px] border-dashed ${
              grid.ghost.valid ? 'border-ember bg-ember/15' : 'border-ember-deep/60 bg-ember-deep/10'
            }`}
            style={{ left: grid.ghost.left, top: grid.ghost.top, width: grid.ghost.width, height: grid.ghost.height }}
          />
        )}

        {settings && effective.length === 0 && !editing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="font-display text-3xl text-ink-faint">Your home screen is empty</div>
            <BigButton onClick={enterEdit}>Customize</BigButton>
          </div>
        )}
      </div>

      {/* the customize pencil lives in the header (next to the gear) */}
      {editing && (
        <div className="fixed inset-x-0 bottom-5 z-30 flex justify-center">
          <div className="flex items-center gap-3 rounded-full bg-ink/90 p-2 shadow-float backdrop-blur-sm">
            <BigButton variant="ghost" onClick={() => setAddOpen(true)}>
              <span className="flex items-center gap-2">
                <PlusIcon size={18} /> Add tile
              </span>
            </BigButton>
            <BigButton variant="ghost" onClick={cancel}>
              Cancel
            </BigButton>
            <BigButton onClick={save} className="min-w-32">
              Done
            </BigButton>
          </div>
        </div>
      )}

      <AddTileSheet
        open={addOpen}
        layout={effective}
        onClose={() => setAddOpen(false)}
        onAdd={(tile) => setDraft([...effective, tile])}
      />

      <PinDialog
        open={pinPrompt}
        title="Enter parent PIN"
        autoAccept
        error={pinError}
        onClose={() => setPinPrompt(false)}
        onSubmit={(pin) =>
          authMutations.verifyPin.mutate(
            { pin },
            {
              onSuccess: (res) => {
                if (res.valid) {
                  setPinPrompt(false)
                  setDraft(layout.map((t) => ({ ...t })))
                } else {
                  setPinError('Wrong PIN — try again')
                }
              }
            }
          )
        }
      />
    </div>
  )
}
