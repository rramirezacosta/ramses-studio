import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useSettingsStore } from './store/useSettingsStore'
import './styles/index.css'

const container = document.getElementById('root')
const root = container ? createRoot(container) : null

// Rehydrate the persisted language before the first paint so the UI never
// flashes the system language over the user's stored preference.
void Promise.resolve(useSettingsStore.persist.rehydrate())
  .catch(() => undefined)
  .finally(() => {
    if (root) root.render(<StrictMode><App /></StrictMode>)
  })
