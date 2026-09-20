import { validateRegistry } from './server_registry';
import type { ServerRegistry } from './types';

export async function appConnection(): Promise<ServerRegistry | undefined> {
  if (import.meta.env.BROWSER !== 'safari') return;
  const response = await browser.runtime.sendNativeMessage('io.archivebox.ArchiveBox', {
    action: 'get_server_registry', schema_version: 1,
  });
  if (response?.error) throw new Error(response.error);
  validateRegistry(response.server_registry);
  return response.server_registry;
}
