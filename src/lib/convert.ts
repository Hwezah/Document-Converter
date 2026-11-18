import { baseName, extOf, familyOf } from "./formats";
import { readAsHtml, readSheets } from "./importers";
import { exportHtml, exportSheets, type OutFile } from "./exporters";
import { imagesToPdf, openPdf, pdfToImages, reencode } from "./pdf";

/** Converts one file to [target]. Most give one file back; a PDF to pictures gives one per page. */
export async function convertFile(file: Blob, name: string, target: string, onProgress?: (msg: string) => void): Promise<OutFile[]> {
  const ext = extOf(name, file.type);
  const fam = familyOf(ext);
  const base = baseName(name);
  const out = (blob: Blob, n = `${base}.${target}`): OutFile[] => [{ name: n, blob }];

  if (fam === "image") {
    if (target === "pdf") return out(await imagesToPdf([file], "fit"));
    if (["png", "jpg", "webp"].includes(target)) return out(await reencode(file, target === "jpg" ? "image/jpeg" : `image/${target}`));
  }
  if (fam === "pdf" && (target === "png" || target === "jpg")) {
    onProgress?.("Opening PDF");
    const doc = await openPdf(await file.arrayBuffer());
    const pics = await pdfToImages(doc, target === "png" ? "image/png" : "image/jpeg", 2, (n) => onProgress?.(`Page ${n} of ${doc.numPages}`));
    return pics.map((b, i) => ({ name: pics.length > 1 ? `${base} - page ${i + 1}.${target}` : `${base}.${target}`, blob: b }));
  }
  if (fam === "sheet") {
    onProgress?.("Reading sheet");
    const sheets = await readSheets(file, ext);
    return out(await exportSheets(sheets, base, target));
  }
  onProgress?.("Reading");
  const html = await readAsHtml(file, ext, onProgress);
  onProgress?.(`Writing ${target.toUpperCase()}`);
  return out(await exportHtml(html, base, target));
}
