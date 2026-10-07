import {mountDirectoryBrowser} from '@/src/ui/directory-browser';

// Compiled original gdrive/dropbox full.html script; only archived file access is injected.

export function initializeCloudFiles(document, manifest, options) {
        const byId = (id) => document.getElementById(id),
          el = (tag, text, cls) => {
            const n = document.createElement(tag);
            if (text != null) n.textContent = text;
            if (cls) n.className = cls;
            return n;
          };

        const valid = (path) =>
          typeof path === "string" &&
          path.startsWith("files/") &&
          !path.split("/").some((p) => !p || p === "." || p === "..") &&
          !path.includes("\\");
        const fileURL = file => options.url(file);
        let controller = null;
        const clearPreview = () => {
          controller?.abort();
          byId("content").replaceChildren();
        };
        const report = (error) => {
          if (error.name !== "AbortError")
            byId("error").textContent = error.message;
        };
        async function openFile(file) {
          clearPreview();
          controller = new AbortController();
          const signal = controller.signal;
          byId("error").textContent = "";
          byId("preview").hidden = false;
          byId("filename").textContent = file.filename.split("/").pop();
          const url = await fileURL(file);
          if(signal.aborted)return;
          byId("download").onclick = () => options.download(file).catch(report);
          const content = byId("content"),
            ext = file.filename.split(".").pop().toLowerCase();
          if (ext === "zip") {
            const link = el("button", "Browse archive");
            link.onclick = () => options.browseZip(file, document).catch(report);
            content.append(link);
            return;
          }
          if (file.size > 16 * 1024 * 1024) {
            content.append(
              el("span", "File is too large to preview. Use Download.", "empty")
            );
            return;
          }
          if (
            ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"].includes(ext)
          ) {
            const img = el("img");
            img.alt = file.filename;
            img.src = url;
            content.append(img);
          } else if (ext === "pdf") {
            const frame = el("iframe");
            frame.title = file.filename;

            frame.src = url;
            content.append(frame);
          } else if (["mp3", "ogg", "wav", "mp4", "webm"].includes(ext)) {
            const media = el(["mp4", "webm"].includes(ext) ? "video" : "audio");
            media.controls = true;
            media.src = url;
            content.append(media);
          } else if (
            /^(txt|md|csv|tsv|json|xml|html?|css|js|py|log|ya?ml|svg|rtf)$/.test(
              ext
            )
          ) {
            content.append(el("span", "Loading…", "empty"));
            try {
              const response = await fetch(url, { signal });
              if (!response.ok) throw Error("File unavailable");
              const text = await response.text();
              if (!signal.aborted) content.replaceChildren(el("pre", text));
            } catch (error) {
              report(error);
            }
          } else
            content.append(
              el(
                "span",
                "Preview unavailable for this file type. Use Download.",
                "empty"
              )
            );
        }
        byId("close").onclick = () => {
          clearPreview();
          byId("preview").hidden = true;
        };
        byId("title").textContent = manifest.title || "Saved files";
        document.title = byId("title").textContent;
        const files = (manifest.files || []).filter(f => valid(f.path)).map(f => ({...f, filename:f.path.slice(6)}));
        const disposeFiles=mountDirectoryBrowser(byId('entries'),{
          title:'Files', files:files.map(file=>({path:file.filename,mime:file.mime,size:file.size,
            url:()=>options.url(file),read:()=>options.read(file),open:()=>openFile(file)})),
        });
return ()=>{clearPreview();disposeFiles()};
}
