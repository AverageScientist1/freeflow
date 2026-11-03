// Undo and redo over immutable snapshots. A snapshot is whatever the caller wants to restore.

export interface History<T> {
  past: T[]
  future: T[]
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] })

// Call before a change, with the state as it is now. Any redo path is dropped.
export function record<T>(h: History<T>, current: T, limit = 100): History<T> {
  return { past: [...h.past.slice(-(limit - 1)), current], future: [] }
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null
  const state = h.past[h.past.length - 1]
  return { state, history: { past: h.past.slice(0, -1), future: [current, ...h.future] } }
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null
  const [state, ...rest] = h.future
  return { state, history: { past: [...h.past, current], future: rest } }
}
