import { uploadSnapshotArchiveResultFiles } from './archivebox';
import { renderMhtmlToHtml } from './mhtml';
import { composeSnapshotScreenshotBlob, readSnapshotMhtmlBlob } from './screenshotStorage';
import type { Snapshot } from './types';

const extensionArtifactSource = 'archivebox-browser-extension';

export async function uploadSnapshotScreenshotToArchiveBox(snapshot: Snapshot): Promise<boolean> {
  const screenshotBlob = await composeSnapshotScreenshotBlob(snapshot.screenshot);
  if (!screenshotBlob) return false;

  await uploadSnapshotArchiveResultFiles(snapshot.id, 'screenshot', [{
    blob: screenshotBlob,
    outputPath: 'screenshot.png',
    mimeType: 'image/png',
  }], {
    outputStr: 'screenshot.png',
    outputJson: {
      source: extensionArtifactSource,
      captured_at: snapshot.screenshot?.capturedAt,
      width: snapshot.screenshot?.width,
      height: snapshot.screenshot?.height,
      parts: snapshot.screenshot?.parts?.length || 1,
    },
  });
  return true;
}

export async function uploadSnapshotMhtmlToArchiveBox(snapshot: Snapshot): Promise<boolean> {
  const mhtmlBlob = await readSnapshotMhtmlBlob(snapshot.mhtml);
  if (!mhtmlBlob) return false;

  const rawMhtml = await mhtmlBlob.text();
  const rendered = renderMhtmlToHtml(rawMhtml, snapshot.url);
  const htmlBlob = new Blob([rendered.html], { type: 'text/html;charset=utf-8' });

  await uploadSnapshotArchiveResultFiles(snapshot.id, 'dom', [
    {
      blob: htmlBlob,
      outputPath: 'output.html',
      mimeType: 'text/html',
    },
    {
      blob: mhtmlBlob,
      outputPath: 'snapshot.mhtml',
      mimeType: snapshot.mhtml?.mimeType || 'multipart/related',
    },
  ], {
    outputStr: 'output.html',
    outputJson: {
      source: extensionArtifactSource,
      source_mime_type: snapshot.mhtml?.mimeType || 'multipart/related',
      captured_at: snapshot.mhtml?.capturedAt,
      mhtml_size: snapshot.mhtml?.size,
      mhtml_part_count: rendered.partCount,
      title: rendered.title,
    },
  });
  return true;
}

export async function uploadSnapshotCaptureArtifactsToArchiveBox(snapshot: Snapshot): Promise<{
  screenshot: boolean;
  mhtml: boolean;
}> {
  const result = {
    screenshot: false,
    mhtml: false,
  };

  if (snapshot.screenshot) {
    result.screenshot = await uploadSnapshotScreenshotToArchiveBox(snapshot);
  }
  if (snapshot.mhtml) {
    result.mhtml = await uploadSnapshotMhtmlToArchiveBox(snapshot);
  }

  return result;
}
