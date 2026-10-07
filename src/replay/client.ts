/** The same plugin queries reach Webrecorder in an extension or a web player. */
export const isExtension = location.protocol === 'chrome-extension:';
export const playerURL = (path: string) => isExtension ? chrome.runtime.getURL(path) : new URL(path, document.baseURI).href;

export async function replayCommand(message: Record<string, unknown>): Promise<any> {
  if (isExtension) return chrome.runtime.sendMessage(message);
  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) throw Error('Replay service worker is not active');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(Error('Replay service worker did not respond')); }, 60000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
    registration.active!.postMessage({ ...message, archivebox: true }, [channel.port2]);
  });
}
