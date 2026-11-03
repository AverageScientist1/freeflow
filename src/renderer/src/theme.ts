export type Theme = 'light' | 'dark'

const KEY = 'freeflow.theme'
const OLD_KEY = 'flowgate.theme' // the app's earlier working name; a saved choice is carried over

// Saved choice first, then the system setting. Storage can be blocked, so every access is guarded.
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable: fall through */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, save = false): void {
  document.documentElement.dataset.theme = theme
  if (!save) return
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
}
