import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

export async function openPdf(data: ArrayBuffer | Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so hand it a copy and keep ours usable.
  const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)).slice();
  // fontExtraProperties: real font names (…-Bold, Courier), so text extraction can keep bold and code.
  const task = pdfjs.getDocument({ data: bytes, password, fontExtraProperties: true });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

/** Frees the worker's copy of a document. */
export function closePdf(doc: PDFDocumentProxy | null | undefined) {
  if (doc) tasks.get(doc)?.destroy().catch(() => {});
}

export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number, rotation = 0) {
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * viewport.height) / viewport.width}px`;
  const task = page.render({ canvas, viewport });
  await task.promise;
  return { width: cssWidth, height: (cssWidth * viewport.height) / viewport.width };
}

interface Run {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A line of text, split into cells wherever there's a wide gap (so tables can be found). */
interface Line {
  y: number;
  x: number;
  size: number;
  cells: { x: number; html: string }[];
  mono: boolean;
  allBold: boolean;
  /** Where the words start, after any bullet or number. */
  textX: number;
}

function runsHtml(runs: Run[]) {
  let html = "";
  let lastEnd = -Infinity;
  for (const r of runs) {
    if (html && r.x - lastEnd > r.size * 0.18 && !/\s$/.test(html) && !r.str.startsWith(" ")) html += " ";
    let t = esc(r.str);
    if (r.bold && t.trim()) t = `<strong>${t}</strong>`;
    if (r.italic && t.trim()) t = `<em>${t}</em>`;
    html += t;
    lastEnd = r.x + r.w;
  }
  return html.replace(/<\/strong>(\s*)<strong>/g, "$1").replace(/<\/em>(\s*)<em>/g, "$1").trim();
}

/**
 * A PDF's words as editable HTML. PDFs only know where glyphs sit, so this rebuilds the structure:
 * runs on one baseline make a line, close lines make a paragraph, big or bold type makes a heading,
 * bullets and "1." make lists, lines with the same columns make a table, monospace makes code.
 */
export async function pdfToHtml(doc: PDFDocumentProxy, onPage?: (n: number, of: number) => void): Promise<string> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onPage?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // The text layer only names fonts by id; the loaded fonts know their real names (…-Bold, Courier…).
    await page.getOperatorList();
    const fontInfo = new Map<string, { bold: boolean; italic: boolean; mono: boolean }>();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    const infoFor = (id: string) => {
      if (!fontInfo.has(id)) {
        let name = styles[id]?.fontFamily ?? "";
        let f: { name?: string; bold?: boolean; italic?: boolean; black?: boolean; isMonospace?: boolean } = {};
        try {
          f = page.commonObjs.get(id) ?? {};
          name += " " + (f.name ?? "");
        } catch {
          /* not loaded: fall back to the family */
        }
        fontInfo.set(id, {
          bold: !!f.bold || !!f.black || /bold|black|heavy|semibold|demi/i.test(name),
          italic: !!f.italic || /italic|oblique/i.test(name),
          mono: !!f.isMonospace || /mono|courier|consol|menlo|code/i.test(name),
        });
      }
      return fontInfo.get(id)!;
    };
    const runs: Run[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const size = Math.hypot(a, b) || it.height || 10;
      runs.push({ str: it.str, x: e, y: f, w: it.width, size, ...infoFor(it.fontName) });
    }
    if (!runs.some((r) => r.str.trim())) continue;

    // Lines: runs within half a glyph of the same baseline, read left to right.
    runs.sort((r1, r2) => r2.y - r1.y || r1.x - r2.x);
    const groups: Run[][] = [];
    for (const r of runs) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].y - r.y) < Math.max(2, r.size * 0.45)) g.push(r);
      else groups.push([r]);
    }
    const lines: Line[] = [];
    for (const g of groups) {
      g.sort((r1, r2) => r1.x - r2.x);
      const real = g.filter((r) => r.str.trim());
      if (!real.length) continue;
      const size = Math.max(...real.map((r) => r.size));
      // A gap wider than ~1.5 em starts a new cell.
      const cells: Run[][] = [];
      let lastEnd = -Infinity;
      for (const r of g) {
        if (!cells.length || (r.str.trim() && r.x - lastEnd > size * 1.5)) cells.push([]);
        cells[cells.length - 1].push(r);
        if (r.str.trim()) lastEnd = r.x + r.w;
      }
      const marker = /^\s*([•●▪◦■·–*-]|\d{1,3}[.)]|[a-z][.)])\s*$/;
      const afterMarker = marker.test(real[0].str) && real[1] ? real[1].x : real[0].x + size * 1.3;
      lines.push({
        textX: afterMarker,
        y: g[0].y,
        x: real[0].x,
        size,
        cells: cells.map((c) => ({ x: c.find((r) => r.str.trim())?.x ?? c[0].x, html: runsHtml(c) })).filter((c) => c.html),
        mono: real.every((r) => r.mono),
        allBold: real.every((r) => r.bold),
      });
    }
    const sizes = runs.filter((r) => r.str.trim()).map((r) => r.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)];

    let para: string[] = [];
    let list: { tag: string; items: string[]; textX: number } | null = null;
    let table: { cols: number[]; rows: string[][] } | null = null;
    let code: string[] = [];
    const flushPara = () => {
      const text = para.join(" ").replace(/\s+/g, " ").replace(/(\w)- (\w)/g, "$1$2").trim();
      if (text) out.push(`<p>${text}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li><p>${i}</p></li>`).join("")}</${list.tag}>`);
      list = null;
    };
    const flushTable = () => {
      if (table && table.rows.length > 1)
        out.push(`<table><tbody>${table.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th><p>${c.replace(/<\/?strong>/g, "")}</p></th>` : `<td><p>${c}</p></td>`)).join("")}</tr>`).join("")}</tbody></table>`);
      else if (table) para.push(table.rows[0].join(" "));
      table = null;
    };
    const flushCode = () => {
      if (code.length) out.push(`<pre><code>${code.join("\n").replace(/<\/?(strong|em)>/g, "")}</code></pre>`);
      code = [];
    };
    const flushAll = () => (flushTable(), flushList(), flushPara(), flushCode());

    let prev: Line | null = null;
    for (const line of lines) {
      const text = line.cells.map((c) => c.html).join(" ");
      const gapAbove = prev ? prev.y - line.y : 0;
      const breakPara = !prev || gapAbove > Math.max(line.size, prev.size) * 1.65 || Math.abs(line.size - prev.size) > 1.5;
      const heading = line.size > body * 1.6 ? "h1" : line.size > body * 1.25 ? "h2" : line.size > body * 1.05 && line.allBold ? "h3" : line.allBold && line.cells.length === 1 && text.length < 80 && breakPara && !/[.:;,]$/.test(text) ? "h3" : null;
      const bullet = /^(?:<(?:strong|em)>)?\s*(?:[•●▪◦■·]\s*|[–*-]\s+)/.exec(text);
      const numbered = /^(?:<(?:strong|em)>)?\s*(\d{1,3}|[a-z])[.)]\s+/.exec(text);

      // A wrapped cell: fewer pieces than the table has columns, each sitting under one of them.
      const col = (x: number) => table?.cols.findIndex((c, i) => Math.abs(x - c) < line.size * 2 || (x > c && x < (table!.cols[i + 1] ?? Infinity))) ?? -1;
      if (table && !line.mono && prev && gapAbove < line.size * 1.35 && line.cells.length < table.cols.length && line.cells.every((c) => col(c.x) >= 0)) {
        const last = table.rows[table.rows.length - 1];
        for (const c of line.cells) last[col(c.x)] += " " + c.html;
        prev = line;
        continue;
      }
      if (line.mono) {
        if (!code.length) flushAll();
        code.push(line.cells.map((c) => c.html).join("    "));
      } else if (line.cells.length >= 2 && !bullet && !numbered) {
        flushCode();
        // A row belongs to the open table if its cells line up with the table's columns.
        const fits = table && table.cols.length === line.cells.length && line.cells.every((c, i) => Math.abs(c.x - table!.cols[i]) < line.size * 3);
        if (!fits) {
          flushTable();
          flushList();
          flushPara();
          table = { cols: line.cells.map((c) => c.x), rows: [] };
        }
        table!.rows.push(line.cells.map((c) => c.html));
      } else if (heading) {
        flushAll();
        out.push(`<${heading}>${text.replace(/<\/?strong>/g, "")}</${heading}>`);
      } else if (bullet || numbered) {
        flushTable();
        flushPara();
        flushCode();
        const tag = bullet ? "ul" : "ol";
        if (list && (list as { tag: string }).tag !== tag) flushList();
        const content = text.slice((bullet ?? numbered)![0].length).trim();
        list = list ?? { tag, items: [], textX: line.textX };
        list.items.push(content || "");
      } else if (list && !breakPara && Math.abs(line.x - list.textX) < line.size * 0.8) {
        // A wrapped line of the last item: it starts where the item's words start.
        list.items[list.items.length - 1] += " " + text;
      } else {
        flushTable();
        flushList();
        flushCode();
        if (breakPara || (prev && Math.abs(line.x - prev.x) > line.size * 2)) flushPara();
        para.push(text);
      }
      prev = line;
    }
    flushAll();
    if (p < doc.numPages) out.push("<hr>");
  }
  return out.join("\n") || "<p><em>This PDF has no selectable text — it is probably a scan.</em></p>";
}

export async function pdfText(doc: PDFDocumentProxy) {
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join(""));
  }
  return pages;
}

/** Each page as a picture. */
export async function pdfToImages(doc: PDFDocumentProxy, type: "image/png" | "image/jpeg", scale = 2, onPage?: (n: number) => void) {
  const out: Blob[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onPage?.(p);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp }).promise;
    out.push(await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.92)));
  }
  return out;
}

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

export async function mergePdfs(files: ArrayBuffer[]) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(f, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return pdfBlob(await out.save());
}

/** A new PDF from [pages]: each an index into the source and an extra rotation, in the order given. */
export async function rebuildPdf(data: ArrayBuffer, pages: { index: number; rotate: number }[]) {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p.index));
  copied.forEach((pg, i) => {
    const r = pages[i].rotate;
    if (r) pg.setRotation(degrees((pg.getRotation().angle + r) % 360));
    out.addPage(pg);
  });
  return pdfBlob(await out.save());
}

/** Splits into one PDF per range, e.g. "1-3, 5, 8-". */
export async function splitPdf(data: ArrayBuffer, ranges: string) {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const n = src.getPageCount();
  const out: { name: string; blob: Blob }[] = [];
  for (const part of ranges.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    const [from, to] = m ? [Number(m[1] || 1), Number(m[2] || n)] : [Number(part), Number(part)];
    if (!from || from > n) continue;
    const idx = Array.from({ length: Math.min(to, n) - from + 1 }, (_, i) => from - 1 + i);
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
    out.push({ name: from === to ? `page ${from}` : `pages ${from}-${Math.min(to, n)}`, blob: pdfBlob(await doc.save()) });
  }
  return out;
}

export async function imagesToPdf(images: Blob[], size: "fit" | "a4" | "letter" = "fit", margin = 0) {
  const doc = await PDFDocument.create();
  for (const b of images) {
    // pdf-lib embeds PNG and JPEG; anything else goes through a canvas first.
    let blob = b;
    if (!/image\/(png|jpe?g)/.test(b.type)) blob = await reencode(b, "image/png");
    const bytes = await blob.arrayBuffer();
    const img = blob.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const [pw, ph] = size === "a4" ? [595.28, 841.89] : size === "letter" ? [612, 792] : [img.width + margin * 2, img.height + margin * 2];
    const landscape = size !== "fit" && img.width > img.height;
    const W = landscape ? ph : pw;
    const H = landscape ? pw : ph;
    const s = Math.min((W - margin * 2) / img.width, (H - margin * 2) / img.height, size === "fit" ? 1 : Infinity);
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
  }
  return pdfBlob(await doc.save());
}

export async function stampPdf(
  data: ArrayBuffer,
  opts: { watermark?: string; numbers?: boolean; numberFormat?: string; opacity?: number; color?: [number, number, number] },
) {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const [r, g, b] = opts.color ?? [0.72, 0.11, 0.14];
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    if (opts.watermark) {
      const size = Math.min(width, height) / Math.max(6, opts.watermark.length * 0.55);
      const tw = font.widthOfTextAtSize(opts.watermark, size);
      const a = Math.atan2(height, width);
      page.drawText(opts.watermark, {
        x: width / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * size) / 3,
        y: height / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * size) / 3,
        size,
        font,
        color: rgb(r, g, b),
        opacity: opts.opacity ?? 0.18,
        rotate: degrees((a * 180) / Math.PI),
      });
    }
    if (opts.numbers) {
      const label = (opts.numberFormat || "{n} / {total}").replace("{n}", String(i + 1)).replace("{total}", String(pages.length));
      const w = plain.widthOfTextAtSize(label, 10);
      page.drawText(label, { x: (width - w) / 2, y: 22, size: 10, font: plain, color: rgb(0.35, 0.35, 0.35) });
    }
  });
  return pdfBlob(await doc.save());
}

export async function setPdfInfo(data: ArrayBuffer, info: { title?: string; author?: string; subject?: string }) {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  if (info.title != null) doc.setTitle(info.title);
  if (info.author != null) doc.setAuthor(info.author);
  if (info.subject != null) doc.setSubject(info.subject);
  doc.setProducer("Folio");
  return pdfBlob(await doc.save());
}

export async function reencode(b: Blob, type: string, quality = 0.92, background?: string): Promise<Blob> {
  const bmp = await loadImage(b);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  if (background || type === "image/jpeg") {
    ctx.fillStyle = background ?? "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bmp, 0, 0);
  return new Promise((r, rej) => c.toBlob((x) => (x ? r(x) : rej(new Error("This browser cannot write " + type))), type, quality));
}

export function loadImage(b: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(b);
    const img = new Image();
    img.onload = () => {
      res(img);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    img.onerror = () => rej(new Error("Could not read that image"));
    img.src = url;
  });
}
