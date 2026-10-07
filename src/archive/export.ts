import type { ArchiveDB } from '@webrecorder/wabac/swlib';
import { PluginDownloader } from '../capture/wacz-metadata';
import type { Capture } from '../capture/types';
import { ArchiveReader } from './reader';
import { readArchive, writeArchive, archivePath } from './storage';

/** Seal and verify before deleting the temporary acquisition database. */
export async function exportCapture(capture: Capture, db: ArchiveDB, expectedRecords: number) {
  const exporter = new PluginDownloader({
    coll: { name: capture.id, store: db, config: { ctime: capture.created, metadata: { title: capture.title, mtime: Date.now() } } },
    format: 'wacz', filename: capture.id, softwareString: 'ArchiveBox JS 0.1.0 / ArchiveWeb.page',
  }, {...capture,state:'complete'}, capture.pluginConfig);
  capture.size = await writeArchive(capture.id, await exporter.download());
  const reader = await ArchiveReader.from(await readArchive(capture.id), capture.id);
  const integrity = await reader.verifyPackage();
  if (integrity.some(check => !check.valid)) throw Error('WACZ package integrity validation failed');
  if (reader.entries.length < expectedRecords) throw Error(`Export lost records: ${reader.entries.length}/${expectedRecords}`);
  capture.state = 'complete';
  capture.file = await archivePath(capture.id); capture.resourceCount = reader.entries.length;
  await db.delete();
}
