// Source-ported from abx-plugins/googledocs/googledocs_utils.js. See ../README.md.
const FORMATS = {
  document: ["docx", "pdf", "odt", "rtf", "txt", "md", "zip", "epub"],
  spreadsheets: ["xlsx", "csv", "pdf", "ods", "tsv", "zip"],
  presentation: ["pptx", "pdf", "odp", "txt"],
  drawings: ["svg", "pdf", "png", "jpg"],
};

function parseDocumentUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.host !== "docs.google.com" ||
      url.username ||
      url.password
    )
      return null;
    const match = url.pathname.match(
      /^\/(?:a\/[^/]+\/)?(document|spreadsheets|presentation|drawings)(\/u\/\d+)?\/d\/([\w-]+)(?:\/|$)/
    );
    if (!match || match[3] === "e") return null; // Published IDs are not file IDs.
    return {
      kind: match[1],
      id: match[3],
      base: `https://docs.google.com${match[0].replace(/\/$/, "")}`,
      authuser: url.searchParams.get("authuser") || match[2]?.split("/").pop(),
      resourcekey: url.searchParams.get("resourcekey"),
      gid:
        url.searchParams.get("gid") ||
        new URLSearchParams(url.hash.slice(1)).get("gid"),
    };
  } catch {
    return null;
  }
}

function exportUrl(doc, format) {
  if (!FORMATS[doc.kind]?.includes(format))
    throw new Error(`Unsupported export format: ${format}`);
  const url = new URL(`${doc.base}/export`);
  if (["presentation", "drawings"].includes(doc.kind))
    url.pathname += `/${format === "jpg" ? "jpeg" : format}`;
  else url.searchParams.set("format", format);
  for (const key of ["authuser", "resourcekey"]) {
    if (doc[key]) url.searchParams.set(key, doc[key]);
  }
  if (["csv", "tsv"].includes(format) && /^\d+$/.test(doc.gid || ""))
    url.searchParams.set("gid", doc.gid);
  return url.href;
}

async function discoverSheets(page) {
  // The editor's initial model includes every worksheet, including tabs that
  // are offscreen. Read its embedded JSON without switching tabs or fetching
  // metadata. Google clears window.bootstrapData after loading the editor.
  const sheets = await page.evaluate(() => {
    for (const script of document.scripts) {
      const match = script.textContent.match(
        /var bootstrapData\s*=\s*(\{.*\});\s*function loadWaffle/s
      );
      if (!match) continue;
      const records = JSON.parse(match[1]).changes?.topsnapshot;
      if (!Array.isArray(records)) break;
      // 21350203 is the worksheet-definition record in Google's editor model.
      return records
        .filter((record) => record[0] === 21350203)
        .map((record) => {
          const sheet = JSON.parse(record[1]);
          const name = sheet[3]
            ?.flatMap((properties) => properties["1"] || [])
            .find(
              (property) => property[0] === 0 && typeof property[2] === "string"
            )?.[2];
          return { id: sheet[2], name };
        });
    }
    return [];
  });
  if (
    !sheets.length ||
    sheets.some(
      (sheet) => !/^\d+$/.test(sheet.id) || typeof sheet.name !== "string"
    ) ||
    new Set(sheets.map((sheet) => sheet.id)).size !== sheets.length
  ) {
    throw new Error(
      "Unable to discover all sheets from the loaded Google editor"
    );
  }
  return sheets;
}

function validateExport(body, format, mimeType) {
  const bytes = body.subarray(0, 1024);
  const length = bytes.length;
  const text = new TextDecoder().decode(bytes).trimStart();
  const mime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (
    !length ||
    /html|json/.test(mime) ||
    /^(?:<!doctype\s+html|<html\b)/i.test(text)
  )
    throw new Error("Export returned an empty file or login/error page");
  let valid = false;
  if (
    ["docx", "xlsx", "pptx", "odt", "ods", "odp", "zip", "epub"].includes(
      format
    )
  )
    valid = [80, 75, 3, 4].every((value, index) => bytes[index] === value);
  else if (format === "pdf") valid = text.startsWith("%PDF-");
  else if (format === "png")
    valid = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  else if (format === "jpg")
    valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (format === "svg")
    valid =
      mime === "image/svg+xml" && /^(?:<\?xml[^>]*>\s*)?<svg\b/.test(text);
  else if (format === "rtf") valid = text.startsWith("{\\rtf");
  else
    valid = [
      "text/plain",
      "text/csv",
      "text/tab-separated-values",
      "text/markdown",
      "text/x-markdown",
    ].includes(mime);
  if (!valid)
    throw new Error(
      `Invalid ${format.toUpperCase()} export (${
        mime || "missing Content-Type"
      })`
    );
}


export {FORMATS, parseDocumentUrl, exportUrl, discoverSheets, validateExport};
