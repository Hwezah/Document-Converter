import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Folio installs as an app: offline after the first visit, in the phone's share sheet,
// and (on Windows, macOS, ChromeOS) in "Open with" for the document types it reads.
const docTypes = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/rtf": [".rtf"],
  "text/markdown": [".md", ".markdown"],
  "text/plain": [".txt"],
  "text/html": [".html", ".htm"],
  "application/epub+zip": [".epub"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
};

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: { maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, globPatterns: ["**/*.{js,mjs,css,html,woff2,png,svg,ico}"] },
      manifest: {
        id: "folio",
        name: "Folio — documents",
        short_name: "Folio",
        description: "Convert, open, edit and write documents and notes.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        start_url: "./",
        scope: "./",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "New document", url: "./?new=doc", icons: [{ src: "icons/icon-192.png", sizes: "192x192" }] },
          { name: "Quick note", url: "./?new=note", icons: [{ src: "icons/icon-192.png", sizes: "192x192" }] },
          { name: "Convert", url: "./?view=convert", icons: [{ src: "icons/icon-192.png", sizes: "192x192" }] },
        ],
        // @ts-expect-error: file_handlers and share_target are newer than the plugin's manifest type.
        file_handlers: [{ action: "./", accept: { ...docTypes, "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"] } }],
        share_target: {
          action: "./share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [{ name: "files", accept: [...Object.keys(docTypes), ...Object.values(docTypes).flat(), "image/*"] }],
          },
        },
      },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
});
