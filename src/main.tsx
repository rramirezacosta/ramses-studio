import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useSettingsStore, ensureSystemLanguageStored } from './store/useSettingsStore'
import './styles/index.css'

const container = document.getElementById('root')
const root = container ? createRoot(container) : null

// Rehydrate the persisted language before the first paint so the UI never
// flashes the system language over the user's stored preference. After
// rehydration, detect the OS language and persist it on first run so the
// detected language survives across sessions.
void Promise.resolve(useSettingsStore.persist.rehydrate())
  .then(() => ensureSystemLanguageStored())
  .catch(() => undefined)
  .finally(() => {
    if (root) root.render(<StrictMode><App /></StrictMode>)
  })
