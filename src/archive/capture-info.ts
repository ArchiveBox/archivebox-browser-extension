import type { Capture } from '../capture/types';
import type { ArchiveReader } from './reader';

export function captureInfo(reader: ArchiveReader, filename = 'capture.wacz'): Capture {
  const original = reader.metadata;
  return {
    id: reader.captureId!, created: original?.created || Date.parse(reader.pages[0]?.ts) || Date.now(),
    url: original?.url || reader.pages[0]?.url || '', finalUrl: original?.finalUrl,
    title: original?.title || reader.manifest.title || filename,
    state: original?.state || 'complete', error: original?.error,
    hooks: (original?.plugins || []).flatMap(plugin => plugin.hooks.map(({name, logs, ...hook}) => ({...hook, plugin: plugin.id, hook: name, logs: logs || []}))),
    plugins: original?.plugins.map(plugin => plugin.id) || [],
    pluginConfig: Object.fromEntries((original?.plugins || []).map(plugin => [plugin.id, plugin.config || {}])),
    resourceCount: reader.entries.length, size: reader.size, file: filename,
  };
}
