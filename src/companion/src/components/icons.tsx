import type { ReactNode } from 'react'

/**
 * The phone app's tab and header icons: simple 2px line icons that fill in when their tab is
 * selected, the way native Android apps mark the current tab. Drawn in currentColor; the inner
 * details switch to the card colour on the filled (selected) version so they stay visible.
 */
function Icon({ active, children, label }: { active?: boolean; children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      data-icon-active={active ? '' : undefined}
    >
      {children}
    </svg>
  )
}

/** fill for the main shape, and the stroke for details drawn on top of it */
const shape = (active?: boolean): string => (active ? 'currentColor' : 'none')
const detail = (active?: boolean): string => (active ? 'var(--color-card)' : 'currentColor')

export function TabStarIcon({ active }: { active?: boolean }) {
  return (
    <Icon active={active}>
      <path
        d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.35 2.85 1-6L3.3 9.6l6-.9z"
        fill={shape(active)}
      />
    </Icon>
  )
}

export function TabListIcon({ active }: { active?: boolean }) {
  return (
    <Icon active={active}>
      <rect x="4" y="3" width="16" height="18" rx="3" fill={shape(active)} />
      <path d="M8 9l1.6 1.6L12.5 7.7" stroke={detail(active)} />
      <path d="M8 15.5h8" stroke={detail(active)} />
    </Icon>
  )
}

export function TabMealIcon({ active }: { active?: boolean }) {
  return (
    <Icon active={active}>
      {/* a plate between a fork and a knife */}
      <circle cx="12" cy="12" r="6" fill={shape(active)} />
      <circle cx="12" cy="12" r="3" stroke={detail(active)} />
      <path d="M2.5 4v4.5a1.5 1.5 0 0 0 3 0V4M4 9.5V20" />
      <path d="M21.5 20V4c-1.6.8-2.5 3-2.5 6.5h2.5" />
    </Icon>
  )
}

export function TabPhotoIcon({ active }: { active?: boolean }) {
  return (
    <Icon active={active}>
      <rect x="3" y="4.5" width="18" height="15" rx="3" fill={shape(active)} />
      <circle cx="15.5" cy="9.5" r="1.5" stroke={detail(active)} />
      <path d="M6.5 16.5l4-4.5 3.5 4 1.5-1.5 2 2" stroke={detail(active)} />
    </Icon>
  )
}

export function TabChatIcon({ active }: { active?: boolean }) {
  return (
    <Icon active={active}>
      <path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6.5L7 21.5V18H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill={shape(active)} />
      <path d="M8 11h.01M12 11h.01M16 11h.01" stroke={detail(active)} strokeWidth={2.6} />
    </Icon>
  )
}

/** The header's settings button (this phone's name and notifications). */
export function SettingsIcon() {
  return (
    <Icon>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}
