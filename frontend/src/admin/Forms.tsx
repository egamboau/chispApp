import { useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export type Run = (operation: () => Promise<unknown>) => Promise<boolean>

/** Labels an uncontrolled text/number field, preserving string jersey numbers and native constraints. */
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label>{label}<input required {...props} /></label>
}

/** Labels a native selector with explicit values and a selectable empty placeholder. */
export function Select({ label, name, items, value, onChange, optional = false }: {
  label: string; name?: string; items: { id: number | string; name: string }[]; value?: string | number
  onChange?: (value: string) => void; optional?: boolean
}) {
  return <label>{label}<select name={name} required={!optional} value={onChange ? value : undefined} defaultValue={onChange ? undefined : value ?? ''} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    <option value="">{optional ? 'Sin asignar' : 'Seleccione'}</option>
    {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label>
}

/** Submits named string fields to a typed page handler; keeps entered values on failure and blocks duplicate submits. */
export function Form({ title, children, submit, disabled = false, save }: {
  title: string; children: ReactNode; submit: (values: Record<string, string>) => Promise<boolean>; disabled?: boolean; save?: string
}) {
  const [busy, setBusy] = useState(false)
  return <section><h3>{title}</h3><form className="compact-form" onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>
    setBusy(true)
    try { if (await submit(values)) form.reset() } finally { setBusy(false) }
  }}><fieldset disabled={disabled || busy}>{children}<button className="primary">{busy ? 'Guardando…' : save ?? 'GUARDAR'}</button></fieldset></form></section>
}

/** Keeps names escaped by React and groups an entity's controls beside its readable label. */
export function Row({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`config-row ${className}`}>{children}</div> }
