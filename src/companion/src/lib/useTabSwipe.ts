import { useEffect, type RefObject } from 'react'
import { swipeStep } from '@shared/swipe'

/** Where a swipe should be left alone: typing, or content that scrolls sideways itself. */
function ownsSwipe(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable="true"], [data-no-swipe]')) return true
    const ox = getComputedStyle(el).overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true
  }
  return false
}

/**
 * Swipe left → next tab, swipe right → previous (OPE-18). Only a clear sideways flick counts
 * (shared `swipeStep`: 60px+, mostly horizontal, quick), so scrolling up and down is untouched.
 */
export function useTabSwipe(ref: RefObject<HTMLElement | null>, onStep: (step: 1 | -1) => void, enabled = true): void {
  useEffect(() => {
    const root = ref.current
    if (!root || !enabled) return
    let start: { x: number; y: number; t: number } | null = null
    const onStart = (e: TouchEvent): void => {
      start = e.touches.length === 1 && !ownsSwipe(e.target, root) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp } : null
    }
    const onEnd = (e: TouchEvent): void => {
      if (!start || e.changedTouches.length !== 1) return
      const t = e.changedTouches[0]
      const step = swipeStep(t.clientX - start.x, t.clientY - start.y, e.timeStamp - start.t)
      start = null
      if (step) onStep(step)
    }
    const onCancel = (): void => {
      start = null
    }
    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onCancel)
    }
  }, [ref, onStep, enabled])
}
