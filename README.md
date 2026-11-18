<h1 align="center">Folio</h1>

<p align="center"><b>Convert, open, edit and write documents — and take notes.</b><br>
On your Android phone, or in any browser. Everything stays on your device; nothing is uploaded.<br>
In the family of WatchHub and Grabber, and wearing the same look.</p>

## Install on Android

Open the **[folio-latest](../../releases/tag/folio-latest)** release on your phone, download **`Folio.apk`** and open it
(allow "install unknown apps" for your browser or Files app when asked). Each new build installs over the last and keeps your documents.

Once installed, Folio appears in **Open with** and **Share** for PDFs, Word, OpenDocument, EPUB, spreadsheets, text and pictures —
so a document Grabber downloads opens straight in Folio.

## What it does

| | |
|---|---|
| 🔁 **Convert** | Any of PDF · DOCX · ODT · RTF · Markdown · TXT · HTML · EPUB · PPTX (text) to PDF · DOCX · ODT · RTF · MD · TXT · HTML · EPUB. Spreadsheets (XLSX · XLS · ODS · CSV · TSV · JSON) to each other, HTML, PDF and Markdown. Pictures to PDF, PNG, JPEG, WebP, DOCX. PDF pages to pictures. Many files at once, a ZIP of the results, or several pictures/PDFs combined into one PDF. |
| 📂 **Open** | A real PDF viewer (zoom, search, selectable text, password-protected PDFs), a picture viewer (rotate, flip), and Word/ODT/RTF/Markdown/HTML/EPUB/PowerPoint open as editable documents. |
| ✍️ **Edit & create** | A full editor: headings, fonts, sizes, colours, highlight, alignment, lists, checklists, tables, pictures, links, find & replace, table of contents, templates (meeting notes, letter, report, CV, to-do), page or continuous view, focus mode, word count, autosave. |
| 🧮 **Spreadsheets** | Edit cells, several sheets, sort, insert/delete rows and columns, filter, sum/average of a column. |
| 🗒️ **Notes** | Quick capture, checklists, colours, pins, tags, search — and turn any note into a full document. |
| 🛠️ **PDF tools** | Organize pages (reorder, rotate, delete, extract), merge, split by ranges, scan to PDF with the camera, pictures to PDF, PDF to editable text, watermark, page numbers, title & author. |
| 🔒 **Yours** | Library with search, sort, pins and a 30-day trash; one-file backup and restore; dark and light themes. |

## Building

The app is a React + TypeScript web app (`src/`), built with Vite; `android/` wraps it in a WebView with the
Android-only parts (Open with, Share, saving to Downloads, the camera). GitHub Actions (`.github/workflows/build.yml`)
builds both on every push to `main` and publishes `Folio.apk` to the `folio-latest` pre-release.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ — also an installable, offline web app (PWA)
```

## Credits

Google Sans Flex (SIL Open Font License, `public/fonts/OFL.txt`), pdf.js, pdf-lib, pdfmake, TipTap, mammoth, docx, SheetJS, Turndown, marked, Lucide icons.
