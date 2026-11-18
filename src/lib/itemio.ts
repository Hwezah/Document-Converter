import { exportHtml, exportSheets } from "./exporters";
import { fmt, targetsFor } from "./formats";
import { readAsHtml } from "./importers";
import { getBlob, type Item } from "./store";
import { convertFile } from "./convert";

/** The formats an item can be saved as. */
export function exportTargets(item: Item): string[] {
  if (item.kind === "sheet") return ["xlsx", "csv", "ods", "pdf", "html", "json", "md", "txt"];
  if (item.kind === "doc" || item.kind === "note") return ["pdf", "docx", "odt", "html", "md", "txt", "rtf", "epub"];
  const ext = item.ext ?? "";
  return [ext, ...targetsFor(ext)];
}

const safe = (s: string) => (s || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120).trim() || "Untitled";

/** An item as files in [ext]: one for most, one per page for a PDF to pictures. */
export async function exportItem(item: Item, ext: string, onProgress?: (m: string) => void): Promise<{ name: string; blob: Blob }[]> {
  const name = safe(item.title);
  if (item.kind === "doc" || item.kind === "note") {
    const html = item.kind === "note" && item.title ? `<h1>${item.title.replace(/</g, "&lt;")}</h1>${item.html ?? ""}` : item.html ?? "";
    return [{ name: `${name}.${ext}`, blob: await exportHtml(html, item.title, ext) }];
  }
  if (item.kind === "sheet") return [{ name: `${name}.${ext}`, blob: await exportSheets(item.sheets ?? [], item.title, ext) }];
  const blob = await getBlob(item.id);
  if (!blob) throw new Error("The original file is missing");
  if (ext === item.ext) return [{ name: `${name}.${ext}`, blob }];
  return convertFile(blob, `${name}.${item.ext}`, ext, onProgress);
}

/** A file (PDF, picture) as an editable document. */
export async function fileToHtml(item: Item, onProgress?: (m: string) => void) {
  const blob = await getBlob(item.id);
  if (!blob) throw new Error("The original file is missing");
  return readAsHtml(blob, item.ext ?? "", onProgress);
}

export const describe = (ext: string) => {
  const f = fmt(ext);
  const notes: Record<string, string> = {
    pdf: "Print-ready, real text",
    docx: "Microsoft Word",
    odt: "LibreOffice, Google Docs",
    html: "Web page",
    md: "Markdown",
    txt: "Just the words",
    rtf: "Any word processor",
    epub: "eBook readers",
    xlsx: "Microsoft Excel",
    csv: "Any spreadsheet",
    ods: "LibreOffice Calc",
    json: "For developers",
    png: "Sharp pictures",
    jpg: "Small pictures",
    webp: "Smallest pictures",
  };
  return { label: f.label, note: notes[ext] ?? f.label, color: f.color };
};
