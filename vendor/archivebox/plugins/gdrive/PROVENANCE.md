# Google Drive and Dropbox browser port

The original `full.html`, `card.html`, icons and hook sources are copied verbatim
from the canonical `abx-plugins` checkout. `SHA256SUMS` covers each HTML template.
The identical Drive/Dropbox explorer and card scripts are compiled in
`gdrive/browser/template.js` and `card-template.js`; Dropbox reuses those scripts.
Filesystem URL lookup becomes read-only WACZ response/member lookup. Downloads
and native PDF preview materialize the selected original bytes in a temporary Blob.

Acquisition keeps the canonical folder identification, Drive breadcrumb/select-all
and Download actions, Dropbox Download/dialog actions, and the shared modalcloser
coordination attribute. AWP's existing paused-response acquisition reads and
commits the actual provider attachment, then cancels Chrome's native save. No URL
is invented and no second fetch follows the download action. The response's
filename and reference identify each provider download. `downloads.json` file
inventory fields live in hook metadata; no JSON or extracted file copies are saved.

Provider ZIPs remain original HTTP responses in WARC. `src/archive/zip-members.ts`
uses pinned zip.js with CRC validation and unsafe-path/symlink rejection to expose
transient member bytes. Nested ZIPs stay ordinary original files and can be opened
in the same canonical explorer. Member references retain the parent response and
exact ZIP member path for OCR, full-text indexing and read-only original previews.

Real acceptance lives in `tests/cloud-folders-live.test.ts`, using the canonical
public gdown nested Drive folder and SHIFT Nursing Dropbox Lockups folder with
all plugins enabled. No provider success is established by source/type checks.
