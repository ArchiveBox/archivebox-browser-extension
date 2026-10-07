// Original shared gdrive/dropbox card.html script with recorded manifest input.
export function initializeCloudFilesCard(document,manifest){

      const bytes = (n) =>
        n < 1024
          ? n + " B"
          : n < 1048576
          ? (n / 1024).toFixed(1) + " KB"
          : (n / 1048576).toFixed(1) + " MB";
      const icon = (name) => {
        const ext = name.split(".").pop().toLowerCase();
        return /^(png|jpe?g|gif|webp|svg|avif)$/.test(ext)
          ? "🖼️"
          : /^(csv|tsv|xlsx?|ods)$/.test(ext)
          ? "▦"
          : /^(pptx?|odp)$/.test(ext)
          ? "▣"
          : ext === "pdf"
          ? "📕"
          : ext === "zip"
          ? "📦"
          : "📄";
      };

          const files = manifest.files || manifest.exports || [];
          document.getElementById("title").textContent =
            manifest.title || "Saved files";
          document.getElementById("summary").textContent =
            files.length +
            " files · " +
            bytes(files.reduce((n, f) => n + (Number(f.size) || 0), 0));
          for (const file of files.slice(0, 3)) {
            const row = document.createElement("li"),
              name = file.filename || file.path;
            for (const [cls, text] of [
              ["icon", icon(name)],
              ["name", name],
              ["size", bytes(file.size || 0)],
            ]) {
              const span = document.createElement("span");
              span.className = cls;
              span.textContent = text;
              if (cls === "name") span.title = name;
              row.append(span);
            }
            document.getElementById("files").append(row);
          }
          if (files.length > 3)
            document.getElementById("more").textContent =
              "+" + (files.length - 3) + " more files";

}
