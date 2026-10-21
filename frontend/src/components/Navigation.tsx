import styles from './display.module.css'

export interface NavigationProps {
  items: readonly { href: string; label: string }[]
  currentHref: string
}

/** Provides standard keyboard-accessible links and identifies the current page. */
export function Navigation({ items, currentHref }: NavigationProps) {
  return <nav className={styles.navigation} aria-label="Navegación principal">
    {items.map(item => <a key={item.href} href={item.href} aria-current={item.href === currentHref ? 'page' : undefined}>{item.label}</a>)}
  </nav>
}
