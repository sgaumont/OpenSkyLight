import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import type { HomeTile } from '@shared/types'
import { canPlace, HOME_COLS, HOME_ROWS, TILE_SPECS, type Rect } from '@shared/home'

const GAP = 12
const DRAG_SLOP_PX = 8

interface Gesture {
  kind: 'drag' | 'resize'
  tileId: string
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  /** pointer has moved past the slop — gesture is live */
  started: boolean
}

export interface GhostRect {
  left: number
  top: number
  width: number
  height: number
  valid: boolean
}

/**
 * The drag/resize engine for the home grid. Pure pointer events: capture on
 * pointerdown, transient transform while dragging, snap-to-cell ghost, commit
 * on valid release, CSS-transition snap-back on invalid release.
 */
export function useHomeGrid(opts: {
  containerRef: RefObject<HTMLDivElement | null>
  layout: HomeTile[]
  enabled: boolean
  onChange: (next: HomeTile[]) => void
}) {
  const { containerRef, layout, enabled, onChange } = opts
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [containerRef])

  const cellW = size.w > 0 ? (size.w - GAP * (HOME_COLS - 1)) / HOME_COLS : 0
  const cellH = size.h > 0 ? (size.h - GAP * (HOME_ROWS - 1)) / HOME_ROWS : 0
  const stride = (cell: number): number => cell + GAP
  const toPxX = (x: number): number => x * stride(cellW)
  const toPxY = (y: number): number => y * stride(cellH)
  const spanW = (w: number): number => w * cellW + (w - 1) * GAP
  const spanH = (h: number): number => h * cellH + (h - 1) * GAP

  function candidateRect(tile: HomeTile, g: Gesture): Rect {
    if (g.kind === 'drag') {
      const x = Math.round((toPxX(tile.x) + g.dx) / stride(cellW))
      const y = Math.round((toPxY(tile.y) + g.dy) / stride(cellH))
      return {
        x: Math.min(Math.max(x, 0), HOME_COLS - tile.w),
        y: Math.min(Math.max(y, 0), HOME_ROWS - tile.h),
        w: tile.w,
        h: tile.h
      }
    }
    const spec = TILE_SPECS[tile.type]
    const w = Math.round((spanW(tile.w) + g.dx + GAP) / stride(cellW))
    const h = Math.round((spanH(tile.h) + g.dy + GAP) / stride(cellH))
    return {
      x: tile.x,
      y: tile.y,
      w: Math.min(Math.max(w, spec.minW), HOME_COLS - tile.x),
      h: Math.min(Math.max(h, spec.minH), HOME_ROWS - tile.y)
    }
  }

  const activeTile = gesture ? layout.find((t) => t.id === gesture.tileId) : undefined
  let ghost: GhostRect | null = null
  if (gesture?.started && activeTile && cellW > 0) {
    const rect = candidateRect(activeTile, gesture)
    ghost = {
      left: toPxX(rect.x),
      top: toPxY(rect.y),
      width: spanW(rect.w),
      height: spanH(rect.h),
      valid: canPlace(layout, rect, activeTile.id)
    }
  }

  function begin(kind: Gesture['kind'], tileId: string, e: PointerEvent): void {
    if (!enabled || gesture || !e.isPrimary) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setGesture({ kind, tileId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, started: false })
  }

  function move(e: PointerEvent): void {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const dx = e.clientX - gesture.startX
    const dy = e.clientY - gesture.startY
    const started = gesture.started || Math.hypot(dx, dy) > DRAG_SLOP_PX
    setGesture({ ...gesture, dx, dy, started })
  }

  function finish(e: PointerEvent, commit: boolean): void {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const tile = layoutRef.current.find((t) => t.id === gesture.tileId)
    if (commit && gesture.started && tile && cellW > 0) {
      const rect = candidateRect(tile, gesture)
      if (canPlace(layoutRef.current, rect, tile.id)) {
        onChange(layoutRef.current.map((t) => (t.id === tile.id ? { ...t, ...rect } : t)))
      }
      // invalid: do nothing — clearing the gesture removes the transform and
      // the CSS transition animates the tile back home
    }
    setGesture(null)
  }

  /** Handlers for the tile body (drag) — spread onto the tile root in edit mode. */
  function tileHandlers(tileId: string) {
    return {
      onPointerDown: (e: PointerEvent) => begin('drag', tileId, e),
      onPointerMove: move,
      onPointerUp: (e: PointerEvent) => finish(e, true),
      onPointerCancel: (e: PointerEvent) => finish(e, false)
    }
  }

  /** Handlers for the corner resize grip (stop propagation so the tile's own drag handlers stay quiet). */
  function resizeHandlers(tileId: string) {
    return {
      onPointerDown: (e: PointerEvent) => {
        e.stopPropagation()
        begin('resize', tileId, e)
      },
      onPointerMove: (e: PointerEvent) => {
        e.stopPropagation()
        move(e)
      },
      onPointerUp: (e: PointerEvent) => {
        e.stopPropagation()
        finish(e, true)
      },
      onPointerCancel: (e: PointerEvent) => finish(e, false)
    }
  }

  function tileStyle(tile: HomeTile): CSSProperties {
    const dragging = gesture?.started && gesture.tileId === tile.id
    const style: CSSProperties = {
      position: 'absolute',
      left: toPxX(tile.x),
      top: toPxY(tile.y),
      width: spanW(tile.w),
      height: spanH(tile.h),
      transition: dragging ? 'none' : 'transform 200ms ease, left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease'
    }
    if (dragging && gesture) {
      if (gesture.kind === 'drag') {
        style.transform = `translate(${gesture.dx}px, ${gesture.dy}px) scale(1.02)`
        style.zIndex = 20
      } else {
        style.width = Math.max(spanW(tile.w) + gesture.dx, cellW)
        style.height = Math.max(spanH(tile.h) + gesture.dy, cellH)
        style.zIndex = 20
      }
    }
    return style
  }

  return {
    ready: cellW > 0,
    cellW,
    cellH,
    /** pixel size of a span of grid units, gaps included */
    spanW,
    spanH,
    ghost,
    activeTileId: gesture?.started ? gesture.tileId : null,
    tileHandlers,
    resizeHandlers,
    tileStyle
  }
}
