const browserTarget = import.meta.env.BROWSER;

export const supportsDirectBrowserImport = browserTarget !== 'safari';
export const supportsWaczCapture = browserTarget === 'chrome' || browserTarget === 'edge';
export const defaultTabManagerPlusExtensionId = 'cnkdjjdmfiffagllbiiilooaoofcoeff';
