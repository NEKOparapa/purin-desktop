import { useSyncExternalStore } from 'react'
import english from './en.json' with { type: 'json' }

export const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
] as const
export type Language = (typeof languageOptions)[number]['value']

const storageKey = 'purin.language'
const listeners = new Set<() => void>()
let current: Language = 'zh-CN'

export const language = () => current

export function applyLanguage(value: Language) {
  document.documentElement.lang = value
  if (current === value) return
  current = value
  listeners.forEach(notify => notify())
}

export function initializeLanguage() {
  const native = window.purin ?? window.purinPet
  if (native) {
    applyLanguage(native.initialLanguage)
  } else {
    try {
      const read = () => applyLanguage(localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh-CN')
      read()
      window.addEventListener('storage', event => {
        if (event.key === storageKey || event.key === null) read()
      })
    } catch {
      applyLanguage('zh-CN')
    }
  }
}

export async function saveLanguage(value: Language) {
  if (window.purin) return window.purin.setLanguage(value)
  localStorage.setItem(storageKey, value)
  applyLanguage(value)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, language)
}

// IPC errors and built-in connector labels come from the Electron process.
export function translateKnown(source: string) {
  return current === 'en' && Object.hasOwn(english, source)
    ? english[source as keyof typeof english]
    : source
}

export function t(source: keyof typeof english, ...values: (string | number)[]) {
  const message = current === 'en' ? english[source] : source
  return values.length ? message.replace(/\{(\d+)\}/g, (_, i) => String(values[i])) : message
}

export function dateFormatter(options: Intl.DateTimeFormatOptions) {
  const formats = {
    en: new Intl.DateTimeFormat('en', options),
    'zh-CN': new Intl.DateTimeFormat('zh-CN', options),
  }
  return () => formats[current]
}
