// Optional native host integration; extension settings always take precedence.
export async function appConnection(): Promise<{ server: string; token: string } | undefined> {
  if (import.meta.env.BROWSER !== 'safari') return;
  try {
    const response = await browser.runtime.sendNativeMessage('io.archivebox.ArchiveBox', { action: 'getConnection' });
    const { server, token } = response?.connection || {};
    if (!['http:', 'https:'].includes(new URL(server).protocol) || !token) return;
    return { server, token };
  } catch {
    // No app connection (or a locked Keychain) must not block the options page.
    return;
  }
}
