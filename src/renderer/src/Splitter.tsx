import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'

interface Props {
  orientation: 'vertical' | 'horizontal' // vertical: a bar between side-by-side areas (dragged left and right)
  value: number // the size being changed, in pixels
  min: number
  max: number
  onChange: (v: number) => void
  label: string
  invert?: boolean // dragging towards the start makes the area bigger (the area is after the bar)
  onToggle?: () => void
  open?: boolean
  toggleLabel?: string
}

// A bar between two areas: drag it, or focus it and use the arrow keys, to change the size of one of them. A small button on it folds
// that area away and brings it back.
export function Splitter({ orientation, value, min, max, onChange, label, invert = false, onToggle, open = true, toggleLabel }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const vertical = orientation === 'vertical'
  const pos = (e: PointerEvent): number => (vertical ? e.clientX : e.clientY)
  const sign = invert ? -1 : 1
  const onKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 64 : 16
    const more = vertical ? (invert ? 'ArrowLeft' : 'ArrowRight') : (invert ? 'ArrowUp' : 'ArrowDown')
    const less = vertical ? (invert ? 'ArrowRight' : 'ArrowLeft') : (invert ? 'ArrowDown' : 'ArrowUp')
    if (e.key === more) { e.preventDefault(); onChange(Math.min(max, value + step)) }
    else if (e.key === less) { e.preventDefault(); onChange(Math.max(min, value - step)) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(min) }
    else if (e.key === 'End') { e.preventDefault(); onChange(max) }
    else if ((e.key === 'Enter' || e.key === ' ') && onToggle && e.target === e.currentTarget) { e.preventDefault(); onToggle() }
  }
  const Icon = vertical ? (invert ? (open ? ChevronRight : ChevronLeft) : (open ? ChevronLeft : ChevronRight)) : (open ? ChevronUp : ChevronDown)
  return (
    <div className={`splitter-wrap ${orientation}`}>
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={open ? value : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={onToggle}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.split-toggle')) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { pos: pos(e), value }
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        onChange(Math.min(max, Math.max(min, start.current.value + sign * (pos(e) - start.current.pos))))
      }}
      onPointerUp={(e) => { start.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }}
      onPointerCancel={() => { start.current = null }}
    />
    {onToggle && (
      <button type="button" className="split-toggle" aria-label={toggleLabel ?? label} aria-expanded={open} onClick={onToggle}>
        <Icon size={12} />
      </button>
    )}
    </div>
  )
}