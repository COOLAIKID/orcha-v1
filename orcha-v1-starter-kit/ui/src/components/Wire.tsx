import type { ReactNode } from 'react'
import type { RegionProps } from '../types'

export function Region({ n, label, children, className = '' }: RegionProps) {
  return (
    <section className={`region ${className}`}>
      <div className="region-label">{n ? `${n} · ${label}` : label}</div>
      {children}
    </section>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="wf-note">{children}</p>
}

export function Placeholder({ children, large }: { children?: ReactNode; large?: boolean }) {
  return <div className={`placeholder ${large ? 'lg' : ''}`}>{children}</div>
}

export function Button({ children, onClick, variant = 'default', disabled, type = 'button' }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return <button type={type} className={`btn ${variant}`} onClick={onClick} disabled={disabled}>{children}</button>
}
