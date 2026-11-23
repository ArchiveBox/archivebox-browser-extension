import { t } from './i18n';

const browserTarget = import.meta.env.BROWSER;

export const extensionBrowserName = browserTarget || t("unknown browser");
export const supportsDirectBrowserImport = browserTarget !== 'safari';

export const supportsMhtmlCapture = browserTarget === 'chrome' || browserTarget === 'edge';

export const supportsUnlimitedStoragePermission = browserTarget === 'chrome' || browserTarget === 'edge' || browserTarget === 'firefox';

export function mhtmlUnsupportedMessage(): string {
  return t("MHTML capture is only available in Chrome and Edge.");
}

const singleFileCompanions = {
  chrome: { id: 'mpiodijhokgodhhofbcjdecpffjipkle', url: 'https://chromewebstore.google.com/detail/singlefile/mpiodijhokgodhhofbcjdecpffjipkle' },
  edge: { id: 'efnbkdcfmcmnhlkaijjjmhjjgladedno', url: 'https://microsoftedge.microsoft.com/addons/detail/efnbkdcfmcmnhlkaijjjmhjjgladedno' },
  firefox: { id: '{531906d3-e22f-4a6c-a102-8057b88a1a63}', url: 'https://addons.mozilla.org/firefox/addon/single-file/' },
};

export const singleFileCompanion = singleFileCompanions[browserTarget as keyof typeof singleFileCompanions] as
  { id: string; url: string } | undefined;

export const defaultTabManagerPlusExtensionId = 'cnkdjjdmfiffagllbiiilooaoofcoeff';

export function singleFileCaptureUnavailableMessage(): string {
  return t("SingleFile capture requires the SingleFile browser extension to be installed.");
}
