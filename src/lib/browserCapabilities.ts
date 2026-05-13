const browserTarget = import.meta.env.BROWSER;

export const extensionBrowserName = browserTarget || 'unknown browser';

export const supportsMhtmlCapture = browserTarget === 'chrome' || browserTarget === 'edge';

export const mhtmlUnsupportedMessage = 'MHTML capture is only available in Chrome, Edge, and Chromium-based builds.';

export const defaultSingleFileExtensionId = browserTarget === 'firefox'
  ? '{531906d3-e22f-4a6c-a102-8057b88a1a63}'
  : 'mpiodijhokgodhhofbcjdecpffjipkle';

export const singleFileCaptureUnavailableMessage = 'SingleFile HTML capture requires the SingleFile extension with ArchiveBox capture API support.';
