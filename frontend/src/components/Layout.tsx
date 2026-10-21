import type { ReactNode } from 'react'
import styles from './display.module.css'

export interface LayoutProps { navigation: ReactNode; children: ReactNode }

/** Supplies the shared display shell, skip link, content landmark and informational footer. */
export function Layout({ navigation, children }: LayoutProps) {
  return <div className={styles.layout}>
    <a className={styles.skipLink} href="#main-content">Saltar al contenido</a>
    <header className={styles.header}>
      <div><h1>ChispApp</h1><p>Datos proporcionados por Chisperos</p></div>
      {navigation}
    </header>
    <main id="main-content" tabIndex={-1} className={styles.main}>{children}</main>
    <footer className={styles.footer}>La información mostrada es de carácter informativo. Los datos oficiales son los publicados por la Asociación Deportiva de Jupas.<p>© 2026 Eduardo Gamboa.</p></footer>
  </div>
}
