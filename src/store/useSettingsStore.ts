import { create } from 'zustand'

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

const STORAGE_KEY = 'ramses-studio-language'

const availableLanguages = new Set(LANGUAGES.map((language) => language.id))

const matchLocale = (locale: unknown): Language | undefined => {
  if (typeof locale !== 'string') return undefined
  const code = locale.split('-')[0].toLowerCase()
  return availableLanguages.has(code as Language) ? (code as Language) : undefined
}

const loadStoredLanguage = (): Language => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && availableLanguages.has(stored as Language)) return stored as Language
  // No stored preference: follow the system, trying each configured locale
  // ('pt-BR' matches 'pt', 'zh-TW' matches 'zh', etc.).
  const candidates = [...(navigator.languages ?? []), navigator.language]
  for (const candidate of candidates) {
    const matched = matchLocale(candidate)
    if (matched) return matched
  }
  return 'en'
}

interface SettingsStore {
  language: Language
  setLanguage: (language: Language) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  language: loadStoredLanguage(),
  setLanguage: (language) => {
    localStorage.setItem(STORAGE_KEY, language)
    set({ language })
  },
}))
