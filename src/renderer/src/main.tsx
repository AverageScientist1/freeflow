import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './styles.css'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { useStore } from './store'
import { applyTheme, initialTheme } from './theme'

// set before the first paint so the window never flashes the wrong theme
applyTheme(initialTheme())

// Closing the window with unsaved changes asks first (the desktop shell shows the question).
window.addEventListener('beforeunload', (e) => {
  if (useStore.getState().dirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
