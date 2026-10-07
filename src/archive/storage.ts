import type { Capture } from '../capture/types';
import { getSnapshots, mutateSnapshots } from '../lib/storage';
import { snapshotDirectoryPath, deleteSnapshotOpfs } from '../lib/screenshotStorage';
import { deleteDerivedCache } from './derived-cache';

export async function listCaptures(): Promise<Capture[]> {
  return (await getSnapshots()).flatMap(snapshot => snapshot.wacz ? [snapshot.wacz] : []);
}
export async function saveCapture(capture: Capture): Promise<void> {
  const saved = structuredClone(capture);
  await mutateSnapshots(entries => entries.map(snapshot => snapshot.id === saved.id
    ? { ...snapshot, title: saved.title || snapshot.title, wacz: saved } : snapshot));
}
export async function archivePath(id: string): Promise<string> {
  const snapshot = (await getSnapshots()).find(snapshot => snapshot.id === id);
  if (!snapshot) throw Error('Saved snapshot no longer exists');
  return snapshot.wacz?.file || `${snapshotDirectoryPath(snapshot)}/archivebox_js/capture.wacz`;
}
export async function archiveFileHandle(id: string, create = false): Promise<FileSystemFileHandle> {
  const parts = (await archivePath(id)).split('/');
  const filename = parts.pop()!;
  let directory = await navigator.storage.getDirectory();
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(filename, { create });
}
export async function writeArchive(id: string, response: Response): Promise<number> {
  if (!response.body) throw Error('Exporter returned no archive');
  const file = await archiveFileHandle(id, true);
  await response.body.pipeTo(await file.createWritable());
  return (await file.getFile()).size;
}
export async function readArchive(id: string): Promise<File> {
  return (await archiveFileHandle(id)).getFile();
}
export async function removeArchive(id: string): Promise<void> {
  const result = await chrome.runtime.sendMessage({type:'unmount-wacz', id});
  if (result?.error) throw Error(result.error);
  const parts = (await archivePath(id)).split('/');
  const filename = parts.pop()!;
  try {
    let directory = await navigator.storage.getDirectory();
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    await directory.removeEntry(filename);
  } catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
}
export async function deleteCapture(id: string): Promise<void> {
  await navigator.locks.request(`archivebox-artifacts:${id}`, async () => {
    const snapshot = (await getSnapshots()).find(snapshot => snapshot.id === id);
    if (!snapshot) return;
    if (snapshot.wacz) {
      const result = await chrome.runtime.sendMessage({type:'unmount-wacz', id});
      if (!result?.ok) throw Error(result?.error || 'Unable to close archive replay');
      await deleteDerivedCache(id);
      await deleteAcquisitionDatabase(id);
    }
    await deleteSnapshotOpfs(snapshot);
    await mutateSnapshots(entries => entries.filter(entry => entry.id !== id));
  });
}

export async function deleteAcquisitionDatabase(id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`capture-${id}`);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Capture database is still in use'));
  });
}
