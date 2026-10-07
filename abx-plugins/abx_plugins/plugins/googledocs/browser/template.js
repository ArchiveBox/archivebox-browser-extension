// Original googledocs/full.html initializer; WACZ resource URLs replace relative files.
export async function initializeGoogleDocs(document, manifest, options) {
        const byId = (id) => document.getElementById(id),
          el = (tag, text, cls) => {
            const node = document.createElement(tag);
            if (text != null) node.textContent = text;
            if (cls) node.className = cls;
            return node;
          };
        const raw = value => String(value);
        byId('raw').href = options.rawURL;
        const labels = {
          docx: "Word document",
          xlsx: "Excel workbook",
          pptx: "PowerPoint",
          pdf: "PDF document",
          csv: "CSV spreadsheet",
          tsv: "TSV spreadsheet",
          odt: "OpenDocument text",
          ods: "OpenDocument sheet",
          odp: "OpenDocument slides",
          txt: "Plain text",
          md: "Markdown",
          rtf: "Rich text",
          zip: "HTML & assets",
          epub: "EPUB ebook",
          svg: "Vector drawing",
          png: "PNG image",
          jpg: "JPEG image",
        };
        const sizeLabel = (size) =>
          size >= 1048576
            ? (size / 1048576).toFixed(1) + " MB"
            : size >= 1024
            ? Math.ceil(size / 1024) + " KB"
            : size + " B";
        let exports = [],
          selectedSheet,
          currentFormat,
          selection = 0;
        byId("sheet").addEventListener("change", () => {
          const item = exports.find(
            (file) =>
              file.format === currentFormat &&
              file.sheet_id === byId("sheet").value
          );
          if (item) select(item);
        });
        async function readText(url) {
          const response = await fetch(raw(url));
          if (!response.ok) throw Error("Preview unavailable");
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let text = "",
            bytes = 0;
          try {
            while (bytes < 262144) {
              const { done, value } = await reader.read();
              if (done)
                return { text: text + decoder.decode(), truncated: false };
              const part = value.subarray(0, 262144 - bytes);
              bytes += part.length;
              text += decoder.decode(part, { stream: true });
            }
            return { text, truncated: true };
          } finally {
            await reader.cancel();
          }
        }
        function csvRows(text, delimiter) {
          const rows = [];
          let row = [],
            cell = "",
            quoted = false;
          for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '"') {
              if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
              } else quoted = !quoted;
            } else if (c === delimiter && !quoted) {
              row.push(cell);
              cell = "";
            } else if ((c === "\n" || c === "\r") && !quoted) {
              if (c === "\r" && text[i + 1] === "\n") i++;
              row.push(cell);
              rows.push(row);
              row = [];
              cell = "";
              if (rows.length >= 201) break;
            } else cell += c;
          }
          if (rows.length < 201 && (cell || row.length))
            rows.push([...row, cell]);
          return rows;
        }
        async function select(item) {
          const generation = ++selection,
            preview = byId("preview"),
            note = byId("note");
          preview.replaceChildren();
          note.hidden = true;
          currentFormat = item.format;
          if (item.sheet_id != null) selectedSheet = item.sheet_id;
          const sheets = exports.filter(
            (file) => file.format === item.format && file.sheet_id != null
          );
          byId("sheet-control").hidden = !sheets.length;
          byId("sheet").replaceChildren(
            ...sheets.map((file) => {
              const option = el("option", file.sheet_name || file.sheet_id);
              option.value = file.sheet_id;
              option.selected = file.sheet_id === selectedSheet;
              return option;
            })
          );
          for (const button of byId("formats").children)
            button.setAttribute(
              "aria-pressed",
              String(button.dataset.format === item.format)
            );
          byId("preview-title").textContent = labels[item.format];
          const url = options.url(item),
            download = byId("download");
          download.href = raw(url);
          download.download = item.path;
          download.hidden = false;
          download.textContent = "⤓ Download " + item.format.toUpperCase();
          download.onclick = event => {
            event.preventDefault();
            void options.download(item).catch(error => {
              note.textContent = error.message;
              note.hidden = false;
            });
          };
          const pdf = exports.find((file) => file.format === "pdf");
          if (
            item.format === "pdf" ||
            (!["csv", "tsv", "txt", "md", "svg", "png", "jpg"].includes(
              item.format
            ) &&
              pdf)
          ) {
            const frame = el("iframe");
            frame.title = "Archived document PDF";
            const pdfURL = await options.pdf(pdf);
            if (generation !== selection) return;
            frame.src = pdfURL + "#view=FitH";
            preview.append(frame);
            if (item.format !== "pdf") {
              note.textContent =
                "PDF preview · Download " +
                item.format.toUpperCase() +
                " for the original export.";
              note.hidden = false;
            }
            return;
          }
          if (["svg", "png", "jpg"].includes(item.format)) {
            const image = el("img", null, "image");
            image.alt = "Archived drawing";
            image.src = raw(url);
            preview.append(image);
            return;
          }
          if (!["csv", "tsv", "txt", "md"].includes(item.format)) {
            const empty = el("div", null, "empty");
            empty.append(
              el("strong", labels[item.format]),
              el(
                "span",
                "Download this export to open it in a compatible application."
              )
            );
            preview.append(empty);
            return;
          }
          try {
            const { text, truncated } = await readText(url);
            if (generation !== selection) return;
            if (["csv", "tsv"].includes(item.format)) {
              const rows = csvRows(text, item.format === "csv" ? "," : "\t"),
                table = el("table"),
                head = el("thead"),
                body = el("tbody");
              rows.forEach((row, index) => {
                const tr = el("tr");
                for (const cell of row.slice(0, 30))
                  tr.append(el(index === 0 ? "th" : "td", cell));
                (index === 0 ? head : body).append(tr);
              });
              table.append(head, body);
              preview.append(table);
              note.textContent =
                (item.sheet_name || "Single-sheet export") +
                (rows.length >= 201 || truncated
                  ? " · Showing the first 200 rows"
                  : "") +
                (rows.some((row) => row.length > 30)
                  ? " · First 30 columns"
                  : "");
              note.hidden = false;
            } else {
              preview.append(el("pre", text));
              if (truncated) {
                note.textContent =
                  "Preview truncated · Download the complete file above.";
                note.hidden = false;
              }
            }
          } catch (error) {
            if (generation === selection)
              preview.append(el("p", error.message, "empty"));
          }
        }
        await Promise.resolve(manifest)
          .then((manifest) => {
            document.body.dataset.kind = manifest.document_type;
            byId("title").textContent = manifest.title || "Google Docs exports";
            exports = (manifest.exports || []).filter(
              (item) =>
                Object.hasOwn(labels, item.format) &&
                (item.path === "document." + item.format ||
                  (["csv", "tsv"].includes(item.format) &&
                    /^\d+$/.test(item.sheet_id) &&
                    item.path === "sheet-" + item.sheet_id + "." + item.format))
            );
            selectedSheet = manifest.selected_sheet;
            const formats = [...new Set(exports.map((item) => item.format))];
            const sheetCount = new Set(
              exports
                .filter((item) => item.sheet_id != null)
                .map((item) => item.sheet_id)
            ).size;
            byId("summary").textContent =
              formats.length +
              " formats · " +
              (sheetCount ? sheetCount + " sheets · " : "") +
              sizeLabel(
                exports.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
              );
            byId("errors").textContent = (manifest.errors || [])
              .map(
                (item) =>
                  item.format.toUpperCase() +
                  (item.sheet_name ? " (" + item.sheet_name + ")" : "") +
                  ": " +
                  item.error
              )
              .join("\n");
            for (const format of formats) {
              const items = exports.filter((item) => item.format === format);
              const button = el("button", format.toUpperCase(), "format");
              button.type = "button";
              button.dataset.format = format;
              button.title =
                labels[format] +
                " · " +
                sizeLabel(items.reduce((sum, item) => sum + item.size, 0));
              button.setAttribute("aria-pressed", "false");
              button.addEventListener("click", () =>
                select(
                  items.find((item) => item.sheet_id === selectedSheet) ||
                    items[0]
                )
              );
              byId("formats").append(button);
            }
            const preferredFormat = manifest.document_type === "spreadsheets" ? "csv" : "pdf";
            const initial =
              exports.find((item) => item.format === preferredFormat && item.sheet_id === selectedSheet) ||
              exports.find((item) => item.format === preferredFormat) || exports[0];
            if (initial) return select(initial);
            else
              byId("preview").replaceChildren(
                el("p", "No exports saved", "empty")
              );
          })
          .catch((error) =>
            byId("preview").replaceChildren(el("p", error.message, "empty"))
          );
      }
