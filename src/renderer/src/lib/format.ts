import { DateTime } from 'luxon'
import { ZONE } from '../stores/uiStore'

export function local(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE)
}

export function formatTime(iso: string, timeFormat: '12h' | '24h'): string {
  const d = local(iso)
  if (timeFormat === '24h') return d.toFormat('HH:mm')
  return d.minute === 0 ? d.toFormat('h a').toLowerCase() : d.toFormat('h:mm a').toLowerCase()
}

/** Always with minutes and no space before am/pm ("3:00pm", "3:30pm"); 24h stays "15:00". */
export function formatTimeFull(iso: string, timeFormat: '12h' | '24h'): string {
  const d = local(iso)
  return timeFormat === '24h' ? d.toFormat('HH:mm') : d.toFormat('h:mma').toLowerCase()
}

export function formatTimeRange(startIso: string, endIso: string, timeFormat: '12h' | '24h'): string {
  return `${formatTime(startIso, timeFormat)} – ${formatTime(endIso, timeFormat)}`
}

export function formatDayHeading(dateIso: string): { weekday: string; day: string; month: string } {
  const d = DateTime.fromISO(dateIso, { zone: ZONE })
  return { weekday: d.toFormat('ccc'), day: d.toFormat('d'), month: d.toFormat('LLL') }
}

export function isToday(dateIso: string): boolean {
  return dateIso === DateTime.now().setZone(ZONE).toISODate()
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Readable text color (white or ink) for a given background hex. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 165 ? '#34302a' : '#ffffff'
}
