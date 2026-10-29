import { createContext, useContext, useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

export type Run = (operation: () => Promise<unknown>) => Promise<boolean>
const Errors = createContext<Record<string, string>>({})

/** Warns before leaving entered drafts; callers may proceed only after acknowledgement. */
export function confirmDiscard() {
  return !document.querySelector('form[data-dirty="true"]') || confirm('Hay cambios sin guardar. ¿Descartarlos y continuar?')
}

/** Labels a native field and places shared-schema validation beside the corresponding input. */
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const errors = useContext(Errors), id = useId(), error = errors[props.name ?? '']
  return <label>{label}<input required aria-label={label} {...props} aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined} />{error && <small id={id} className="error">{error}</small>}</label>
}

/** Labels a native selector with explicit values, placeholder and adjacent validation errors. */
export function Select({ label, name, items, value, onChange, optional = false }: {
  label: string; name?: string; items: { id: number | string; name: string }[]; value?: string | number
  onChange?: (value: string) => void; optional?: boolean
}) {
  const errors = useContext(Errors), id = useId(), error = errors[name ?? '']
  return <label>{label}<select aria-label={label} name={name} required={!optional} aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined} value={onChange ? value : undefined} defaultValue={onChange ? undefined : value ?? ''} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    <option value="">{optional ? 'Sin asignar' : 'Seleccione'}</option>
    {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select>{error && <small id={id} className="error">{error}</small>}</label>
}

/** Submits named fields once, retains failed drafts and shows schema errors beside fields.
 * Optional disclosure keeps creation forms mounted but closed until requested. Drafts warn on page exit. */
export function Form({ title, children, submit, disabled = false, save, disclosure = false }: {
  title: string; children: ReactNode; submit: (values: Record<string, string>) => Promise<boolean>; disabled?: boolean; save?: string; disclosure?: boolean
}) {
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<Record<string, string>>({}), [failure, setFailure] = useState('')
  const form = <><h3>{title}</h3><Errors.Provider value={errors}><form className="compact-form" onChange={event => { event.currentTarget.dataset.dirty = 'true' }} onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    if (form.dataset.submitting === 'true') return
    form.dataset.submitting = 'true'
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>
    setBusy(true); setErrors({}); setFailure('')
    try { if (await submit(values)) { form.reset(); delete form.dataset.dirty } }
    catch (error) {
      const issues = error && typeof error === 'object' && 'issues' in error ? error.issues as { path: unknown[]; message: string }[] : []
      setErrors(Object.fromEntries(issues.map(item => [String(item.path[0] ?? ''), item.message])))
      setFailure(error instanceof Error && !issues.length ? error.message : 'Revisa los campos indicados.')
    } finally { delete form.dataset.submitting; setBusy(false) }
  }}><fieldset disabled={disabled || busy}>{children}{failure && <p role="alert" className="error">{failure}</p>}<button className="primary">{busy ? 'Guardando…' : save ?? 'GUARDAR'}</button></fieldset></form></Errors.Provider></>
  return disclosure ? <details className="form-disclosure"><summary>Agregar · {title}</summary>{form}</details> : <section>{form}</section>
}

/** Keeps names escaped by React and groups entity controls beside readable labels. */
export function Row({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`config-row ${className}`}>{children}</div> }
