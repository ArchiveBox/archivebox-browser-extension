import { t } from './i18n';

const browserTarget = import.meta.env.BROWSER;

export const extensionBrowserName = browserTarget || t("unknown browser");

export const supportsMhtmlCapture = browserTarget === 'chrome' || browserTarget === 'edge';

export const supportsUnlimitedStoragePermission = browserTarget === 'chrome' || browserTarget === 'edge' || browserTarget === 'firefox';

export function mhtmlUnsupportedMessage(): string {
  return t("MHTML capture is only available in Chrome and Edge.");
}

export const defaultSingleFileExtensionId = browserTarget === 'firefox'
  ? '{531906d3-e22f-4a6c-a102-8057b88a1a63}'
  : 'mpiodijhokgodhhofbcjdecpffjipkle';

export const defaultTabManagerPlusExtensionId = 'cnkdjjdmfiffagllbiiilooaoofcoeff';

export const singleFileChromeWebStoreUrl = 'https://chromewebstore.google.com/detail/singlefile/mpiodijhokgodhhofbcjdecpffjipkle';

export function singleFileCaptureUnavailableMessage(): string {
  return t("SingleFile capture requires the SingleFile browser extension to be installed.");
}
