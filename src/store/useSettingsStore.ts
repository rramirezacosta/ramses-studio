import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { getKv, setKv } from '../db/db'

export type Language = (typeof LANGUAGES)[number]['id']

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
  { id: 'ru', label: 'Русский' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' },
  { id: 'zh', label: '中文' },
  { id: 'de', label: 'Deutsch' },
  { id: 'eo', label: 'Esperanto' },
] as const

const availableLanguages = new Set(LANGUAGES.map((language) => language.id))

const LEGACY_STORAGE_KEY = 'ramses-studio-language'

const matchLocale = (locale: unknown): Language | undefined => {
  if (typeof locale !== 'string') return undefined
  const code = locale.split('-')[0].toLowerCase()
  return availableLanguages.has(code as Language) ? (code as Language) : undefined
}

const loadSystemLanguage = (): Language => {
  // No stored preference: follow the system, trying each configured locale
  // ('pt-BR' matches 'pt', 'zh-TW' matches 'zh', etc.).
  const candidates = [...(navigator.languages ?? []), navigator.language]
  for (const candidate of candidates) {
    const matched = matchLocale(candidate)
    if (matched) return matched
  }
  return 'en'
}

/**
 * Persisted language backed by the IndexedDB `kv` store. The legacy
 * localStorage value migrates on first read; the sync initial state is the
 * system language, corrected as soon as `rehydrate()` completes in main.tsx.
 */
const languageStorage: StateStorage = {
  getItem: async (name) => {
    const stored = await getKv<string>(name)
    if (stored != null) return stored
    // Migrate the pre-IndexedDB preference once, transparently.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy && availableLanguages.has(legacy as Language)) {
      return JSON.stringify({ state: { language: legacy }, version: 0 })
    }
    return null
  },
  setItem: async (name, value) => {
    await setKv(name, value)
  },
  removeItem: async (name) => {
    await setKv(name, undefined)
  },
}

interface SettingsStore {
  language: Language
  setLanguage: (language: Language) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      language: loadSystemLanguage(),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ramses-studio-settings',
      storage: createJSONStorage(() => languageStorage),
      partialize: (store) => ({ language: store.language }) as SettingsStore,
    },
  ),
)
