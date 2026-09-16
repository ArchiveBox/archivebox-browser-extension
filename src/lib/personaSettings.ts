import type { PersonaSettings } from './types';

// Permission-free values are collected in an extension page, never during a sync.
export function currentPersonaSettings(): PersonaSettings {
  const ua = navigator.userAgent;
  const operatingSystem = ua.includes('Android') ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : ua.includes('Windows') ? 'Windows'
        : ua.includes('Mac OS X') ? 'macOS'
          : ua.includes('Linux') ? 'Linux' : '';
  return {
    userAgent: ua,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    viewportScale: String(window.devicePixelRatio || 1),
    colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    operatingSystem,
  };
}

export async function detectPersonaLocation(): Promise<NonNullable<PersonaSettings['geolocation']>> {
  if (!navigator.geolocation) throw new Error('Location is unavailable in this browser');
  if ((browser.runtime.getManifest().optional_permissions as string[] | undefined)?.includes('geolocation')) {
    const granted = await browser.permissions.request({ permissions: ['geolocation'] });
    if (!granted) throw new Error('Location permission denied');
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      reject,
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 },
    );
  });
}
