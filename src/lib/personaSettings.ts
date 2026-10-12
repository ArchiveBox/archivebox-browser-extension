import type { PersonaSettings } from './types';

// Permission-free values are collected in an extension page, never during a sync.
export async function currentPersonaSettings(): Promise<PersonaSettings> {
  // A UA string alone makes CDP erase client hints. Export the browser's real
  // metadata alongside it, including OS/CPU values absent from the reduced UA.
  const { userAgentData } = navigator as Navigator & { userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<NonNullable<PersonaSettings['userAgentMetadata']>>;
  } };
  const userAgentMetadata = await userAgentData?.getHighEntropyValues([
    'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'wow64', 'formFactors',
  ]) ?? null;
  const ua = navigator.userAgent;
  const operatingSystem = ua.includes('Android') ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : ua.includes('Windows') ? 'Windows'
        : ua.includes('Mac OS X') ? 'macOS'
          : ua.includes('Linux') ? 'Linux' : '';
  return {
    userAgent: ua,
    userAgentMetadata,
    platform: navigator.platform,
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
