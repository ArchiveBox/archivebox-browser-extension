import type { Snapshot } from './types';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

export function snapshotCsvContent(snapshots: Snapshot[]): string {
  const headers = ['id', 'timestamp', 'url', 'title', 'tags'];
  const csvRows = [
    headers.join(','),
    ...snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.timestamp,
      csvEscape(snapshot.url),
      csvEscape(snapshot.title || ''),
      csvEscape(snapshot.tags.join(';')),
    ].join(',')),
  ];

  return csvRows.join('\n');
}

export function snapshotJsonContent(snapshots: Snapshot[]): string {
  return JSON.stringify(snapshots, null, 2);
}

export function downloadCsv(snapshots: Snapshot[]): void {
  downloadBlob(
    new Blob([snapshotCsvContent(snapshots)], { type: 'text/csv;charset=utf-8;' }),
    `${archiveboxExportBaseName()}.csv`,
  );
}

export function downloadJson(snapshots: Snapshot[]): void {
  downloadBlob(
    new Blob([snapshotJsonContent(snapshots)], {
      type: 'application/json;charset=utf-8',
    }),
    `${archiveboxExportBaseName()}.json`,
  );
}
