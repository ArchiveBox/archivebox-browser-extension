import { translations } from './i18nMessages';

type AppLocale = keyof typeof translations;
type UiLanguage = 'auto' | 'en' | AppLocale;

let uiLanguage: UiLanguage = 'auto';

function interpolate(message: string, substitutions: Array<number | string>): string {
  return substitutions.reduce<string>((current, value, index) => (
    current.replaceAll(`$${index + 1}`, String(value))
  ), message);
}

function normalizeLocale(locale: string): AppLocale | 'en' {
  const normalized = locale.replace('_', '-').toLowerCase();
  if (normalized.startsWith('es')) return 'es';
  if (normalized.startsWith('zh')) return 'zh_CN';
  return 'en';
}

function currentLocale(): AppLocale | 'en' {
  if (uiLanguage !== 'auto') return uiLanguage;

  const extensionLanguage = (() => {
    try {
      return typeof browser !== 'undefined' ? browser.i18n?.getUILanguage?.() : undefined;
    } catch {
      return undefined;
    }
  })();

  const navigatorLanguage = (() => {
    try {
      return typeof navigator !== 'undefined' ? navigator.language : undefined;
    } catch {
      return undefined;
    }
  })();

  for (const candidate of [extensionLanguage, navigatorLanguage]) {
    if (!candidate) continue;
    const locale = normalizeLocale(candidate);
    if (locale !== 'en') return locale;
  }
  return 'en';
}

export function setUiLanguage(language?: string): void {
  uiLanguage = language === 'es' || language === 'zh_CN' || language === 'en' ? language : 'auto';
}

export function t(englishText: string, ...substitutions: Array<number | string>): string {
  const locale = currentLocale();
  const translated = locale === 'en' ? undefined : translations[locale]?.[englishText as keyof typeof translations[typeof locale]];
  return interpolate(translated || englishText, substitutions);
}
