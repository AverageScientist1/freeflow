import { describe, it, expect } from 'vitest'
import { emptyHistory, record, undo, redo } from '../src/core/history'

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = emptyHistory<number>()
    h = record(h, 1) // about to change from 1 to 2
    h = record(h, 2) // about to change from 2 to 3
    let current = 3
    const u1 = undo(h, current)!
    expect(u1.state).toBe(2)
    h = u1.history; current = u1.state
    const u2 = undo(h, current)!
    expect(u2.state).toBe(1)
    h = u2.history; current = u2.state
    expect(undo(h, current)).toBeNull()
    const r1 = redo(h, current)!
    expect(r1.state).toBe(2)
    h = r1.history; current = r1.state
    const r2 = redo(h, current)!
    expect(r2.state).toBe(3)
    expect(redo(r2.history, r2.state)).toBeNull()
  })

  it('a new change drops the redo path', () => {
    let h = record(emptyHistory<number>(), 1)
    const u = undo(h, 2)!
    h = record(u.history, u.state)
    expect(h.future).toEqual([])
    expect(redo(h, 5)).toBeNull()
  })

  it('keeps only the last N states', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 10; i++) h = record(h, i, 4)
    expect(h.past).toEqual([6, 7, 8, 9])
  })

  it('does nothing to undo or redo on an empty history', () => {
    expect(undo(emptyHistory<number>(), 1)).toBeNull()
    expect(redo(emptyHistory<number>(), 1)).toBeNull()
  })
})
