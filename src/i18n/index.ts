import { useMemo } from 'react'
import { useSettingsStore, type Language, LANGUAGES } from '../store/useSettingsStore'
import { en, es, pt, ru, ja, ko, fr, zh, de, eo } from './translations'

export { LANGUAGES }
export type TranslationKey = keyof typeof en

const dictionaries: Record<Language, Partial<typeof en>> = { en, es, pt, ru, ja, ko, fr, zh, de, eo }

/** Returns a `t(key, vars?)` function that resolves the current language fallback to English. */
export function useTranslation() {
  const language = useSettingsStore((store) => store.language)
  return useMemo(() => (key: TranslationKey, vars?: Record<string, string | number>) => {
    let text: string = dictionaries[language]?.[key] ?? en[key] ?? key
    if (vars) {
      for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }, [language])
}
