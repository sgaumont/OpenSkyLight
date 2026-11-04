import { create } from 'zustand'

/**
 * Whether a fullscreen kiosk layer (sleep or screensaver) is covering the UI.
 * Expensive tiles (camera streams) pause themselves while covered.
 */
interface KioskState {
  covered: boolean
  setCovered(covered: boolean): void
  /** the overnight sleep screen is up (quiet hours: no note chime) */
  sleeping: boolean
  setSleeping(sleeping: boolean): void
}

export const useKioskState = create<KioskState>((set) => ({
  covered: false,
  setCovered: (covered) => set({ covered }),
  sleeping: false,
  setSleeping: (sleeping) => set({ sleeping })
}))
