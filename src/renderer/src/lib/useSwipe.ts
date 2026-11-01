import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { swipeStep } from '@shared/swipe'

/**
 * Horizontal swipe paging for a container (touch or mouse). Spread the result
 * onto the element. A swipe that starts on a tappable child (e.g. a date) must not
 * also tap it, so the click that follows a swipe is swallowed.
 */
export function useSwipe(onStep: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const swallowClick = useRef(false)

  return {
    // the browser keeps vertical panning; horizontal moves come to us
    style: { touchAction: 'pan-y' } as CSSProperties,
    onPointerDown: (e: PointerEvent) => {
      if (!e.isPrimary) return
      start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s || s.id !== e.pointerId) return
      const step = swipeStep(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t)
      if (step === null) return
      swallowClick.current = true
      // the click (if any) is dispatched right after pointerup; forget it after that
      window.setTimeout(() => (swallowClick.current = false), 0)
      onStep(step)
    },
    onPointerCancel: () => {
      start.current = null
    },
    onClickCapture: (e: MouseEvent) => {
      if (!swallowClick.current) return
      e.preventDefault()
      e.stopPropagation()
      swallowClick.current = false
    }
  }
}
