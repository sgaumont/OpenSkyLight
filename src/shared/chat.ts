import type { NoteDto } from './types'

/** A phone has the last word: the tablet hasn't answered since. */
export const waiting = (n: NoteDto): boolean => !(n.replies.at(-1)?.fromKiosk ?? n.fromKiosk)

/** Chats that pop up on the tablet: every chat from a phone, and the tablet's own once a phone answers. */
export const popsUp = (n: NoteDto): boolean => !n.fromKiosk || n.replies.some((r) => !r.fromKiosk)
