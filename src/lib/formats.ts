/** What Folio reads and writes, and how each format is shown. */
export type Family = "doc" | "pdf" | "sheet" | "image" | "slides" | "other";

export interface Fmt {
  ext: string;
  label: string;
  family: Family;
  /** Accent for its badge: red docs, orange PDFs, green sheets, gold images. */
  color: string;
  mime: string;
}

const F = (ext: string, label: string, family: Family, color: string, mime: string): Fmt => ({ ext, label, family, color, mime });

export const FORMATS: Record<string, Fmt> = {
  pdf: F("pdf", "PDF", "pdf", "#e8590c", "application/pdf"),
  docx: F("docx", "Word", "doc", "#2b6cd4", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  odt: F("odt", "OpenDocument", "doc", "#2b6cd4", "application/vnd.oasis.opendocument.text"),
  rtf: F("rtf", "Rich Text", "doc", "#6c5ce7", "application/rtf"),
  md: F("md", "Markdown", "doc", "#7a7a7a", "text/markdown"),
  txt: F("txt", "Plain text", "doc", "#7a7a7a", "text/plain"),
  html: F("html", "Web page", "doc", "#b81d24", "text/html"),
  epub: F("epub", "eBook", "doc", "#9b4dca", "application/epub+zip"),
  json: F("json", "JSON", "sheet", "#7a7a7a", "application/json"),
  csv: F("csv", "CSV", "sheet", "#1e9e52", "text/csv"),
  xlsx: F("xlsx", "Excel", "sheet", "#1e9e52", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  xls: F("xls", "Excel 97", "sheet", "#1e9e52", "application/vnd.ms-excel"),
  ods: F("ods", "Calc", "sheet", "#1e9e52", "application/vnd.oasis.opendocument.spreadsheet"),
  tsv: F("tsv", "TSV", "sheet", "#1e9e52", "text/tab-separated-values"),
  pptx: F("pptx", "PowerPoint", "slides", "#d24726", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
  png: F("png", "PNG", "image", "#c99a06", "image/png"),
  jpg: F("jpg", "JPEG", "image", "#c99a06", "image/jpeg"),
  webp: F("webp", "WebP", "image", "#c99a06", "image/webp"),
  gif: F("gif", "GIF", "image", "#c99a06", "image/gif"),
  bmp: F("bmp", "Bitmap", "image", "#c99a06", "image/bmp"),
  svg: F("svg", "SVG", "image", "#c99a06", "image/svg+xml"),
  zip: F("zip", "ZIP", "other", "#7a7a7a", "application/zip"),
};

const ALIAS: Record<string, string> = { htm: "html", markdown: "md", jpeg: "jpg", text: "txt", xhtml: "html" };

export function extOf(name: string, mime = ""): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  let e = m ? m[1].toLowerCase() : "";
  e = ALIAS[e] ?? e;
  if (FORMATS[e]) return e;
  const byMime = Object.values(FORMATS).find((f) => f.mime === mime);
  if (byMime) return byMime.ext;
  if (mime.startsWith("image/")) return "png";
  if (mime.startsWith("text/")) return "txt";
  return e || "bin";
}

export const fmt = (ext: string): Fmt => FORMATS[ext] ?? F(ext, ext.toUpperCase(), "other", "#7a7a7a", "application/octet-stream");
export const familyOf = (ext: string): Family => fmt(ext).family;

/** Which targets each kind of input converts to. */
export function targetsFor(ext: string): string[] {
  switch (familyOf(ext)) {
    case "pdf":
      return ["docx", "txt", "md", "html", "png", "jpg"];
    case "sheet":
      return ["xlsx", "csv", "ods", "json", "html", "pdf", "md"];
    case "image":
      return ["pdf", "png", "jpg", "webp", "docx"].filter((t) => t !== ext);
    case "slides":
      return ["pdf", "docx", "txt", "md", "html"];
    default:
      return ["pdf", "docx", "odt", "html", "md", "txt", "rtf", "epub"].filter((t) => t !== ext);
  }
}

export const ACCEPT = [
  ".pdf,.docx,.odt,.rtf,.md,.markdown,.txt,.html,.htm,.epub,.csv,.tsv,.json,.xlsx,.xls,.ods,.pptx",
  ".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg",
  "application/pdf,text/*,image/*",
].join(",");

export function humanSize(n?: number) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: s > 300 * 86400 ? "numeric" : undefined });
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || "Untitled";
