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

export function downloadCsv(snapshots: Snapshot[]): void {
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

  downloadBlob(
    new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' }),
    `archivebox-export-${new Date().toISOString().split('T')[0]}.csv`,
  );
}

export function downloadJson(snapshots: Snapshot[]): void {
  downloadBlob(
    new Blob([JSON.stringify(snapshots, null, 2)], {
      type: 'application/json;charset=utf-8',
    }),
    `archivebox-export-${new Date().toISOString().split('T')[0]}.json`,
  );
}
