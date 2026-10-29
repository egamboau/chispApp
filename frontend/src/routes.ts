/** Recognizes only the public and preserved administrative page URLs. */
export function pageRoute(path: string) {
  if (/^\/display(?:\/index\.html|\/)?$/.test(path)) return 'display'
  if (/^\/admin(?:\/(?:index|teams|calendar|scoring)\.html|\/)?$/.test(path)) return 'admin'
}
