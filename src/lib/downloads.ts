import type { Snapshot } from './types';

// Walks a selection in bounded batches (see forEachSnapshot in models.ts), so
// exports never hold every selected snapshot at once.
export type SnapshotBatches = (fn: (batch: Snapshot[]) => Promise<void>) => Promise<void>;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function exportDateSegment(date = new Date()): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

export function archiveboxExportBaseName(date = new Date()): string {
  return `${exportDateSegment(date)}__archivebox_export`;
}

// The file is assembled from per-batch string parts; a Blob made of parts
// does not need them joined into one string first.
export async function snapshotCsvBlob(batches: SnapshotBatches): Promise<Blob> {
  const parts = ['id,timestamp,url,title,tags'];
  await batches(async (batch) => {
    parts.push(...batch.map((snapshot) => '\n' + [
      snapshot.id,
      snapshot.timestamp,
      csvEscape(snapshot.url),
      csvEscape(snapshot.title || ''),
      csvEscape(snapshot.tags.join(';')),
    ].join(',')));
  });
  return new Blob(parts, { type: 'text/csv;charset=utf-8;' });
}

// Same text as JSON.stringify(allSnapshots, null, 2), built one item at a time.
export async function snapshotJsonBlob(batches: SnapshotBatches): Promise<Blob> {
  const parts: string[] = [];
  await batches(async (batch) => {
    for (const snapshot of batch) {
      parts.push(`${parts.length ? ',' : ''}\n  ${JSON.stringify(snapshot, null, 2).replaceAll('\n', '\n  ')}`);
    }
  });
  return new Blob(parts.length ? ['[', ...parts, '\n]'] : ['[]'], { type: 'application/json;charset=utf-8' });
}
