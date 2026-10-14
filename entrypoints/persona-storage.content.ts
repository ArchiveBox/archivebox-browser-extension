import { captureOriginStorage } from '@/src/lib/personaStorage';

export default defineContentScript({
  registration: 'runtime',
  main() {
    const scope = globalThis as typeof globalThis & { archiveboxPersonaStorageInstalled?: boolean };
    if (scope.archiveboxPersonaStorageInstalled) return;
    scope.archiveboxPersonaStorageInstalled = true;
    browser.runtime.onMessage.addListener((message: { type: string; includeOrigin?: boolean }) => {
      if (message.type === 'persona_capture_storage') return captureOriginStorage(message.includeOrigin !== false);
    });
  },
});
