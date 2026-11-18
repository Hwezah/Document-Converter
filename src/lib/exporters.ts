import JSZip from "jszip";
import type { SheetData } from "./store";
import { fmt } from "./formats";
import { htmlToText, sheetsToHtml } from "./importers";
import { loadImage, reencode } from "./pdf";
import { native, toBase64 } from "./native";

export interface OutFile {
  name: string;
  blob: Blob;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const parse = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

/** A document (as HTML) in any of the formats Folio writes. */
export async function exportHtml(html: string, title: string, ext: string): Promise<Blob> {
  const type = fmt(ext).mime;
  switch (ext) {
    case "html":
      return new Blob([standaloneHtml(html, title)], { type });
    case "md":
      return new Blob([await toMarkdown(html)], { type });
    case "txt":
      return new Blob([htmlToText(html)], { type });
    case "docx":
      return toDocx(html, title);
    case "pdf":
      return toPdf(html, title);
    case "odt":
      return toOdt(html, title);
    case "rtf":
      return new Blob([toRtf(html)], { type });
    case "epub":
      return toEpub(html, title);
    default:
      throw new Error(`Folio can't write .${ext} from a document`);
  }
}

export async function exportSheets(sheets: SheetData[], title: string, ext: string): Promise<Blob> {
  const XLSX = await import("xlsx");
  if (ext === "json") {
    const [head, ...rows] = sheets[0]?.rows ?? [];
    const objs = rows.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h || `col${i + 1}`, numberish(r[i] ?? "")])));
    return new Blob([JSON.stringify(objs, null, 2)], { type: "application/json" });
  }
  if (ext === "html") return new Blob([standaloneHtml(sheetsToHtml(sheets), title)], { type: "text/html" });
  if (ext === "md") return new Blob([await toMarkdown(sheetsToHtml(sheets))], { type: "text/markdown" });
  if (ext === "pdf") return toPdf(sheetsToHtml(sheets), title, true);
  if (ext === "csv" || ext === "tsv") {
    // Cells exactly as written: "1.20" stays "1.20", "007" stays "007".
    const sep = ext === "tsv" ? "\t" : ",";
    const q = (c: string) => (/[",\n\r\t]/.test(c) || (sep === "," && c.includes(",")) ? `"${c.replace(/"/g, '""')}"` : c);
    return new Blob(["\ufeff" + (sheets[0]?.rows ?? []).map((r) => r.map(q).join(sep)).join("\r\n")], { type: fmt(ext).mime });
  }
  if (ext === "txt") return new Blob([sheets.map((s) => s.rows.map((r) => r.join("\t")).join("\n")).join("\n\n")], { type: "text/plain" });
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map(numberish))), s.name.slice(0, 31) || "Sheet");
  const buf = XLSX.write(wb, { type: "array", bookType: ext as "xlsx" | "ods" | "xls" });
  return new Blob([buf], { type: fmt(ext).mime });
}
/** "42" and "3.5" become numbers so spreadsheets can sum them; "007" and "1e5" stay text. */
const numberish = (v: string) => (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.trim()) && v.trim().length < 16 ? Number(v) : v);

/* ---------- HTML ---------- */

export function standaloneHtml(body: string, title: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{max-width:760px;margin:48px auto;padding:0 20px;font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}
h1,h2,h3{line-height:1.25;letter-spacing:-.02em}h1{font-size:2.1em}a{color:#b81d24}
blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #b81d24;color:#555;font-style:italic}
code{background:#f3eeea;padding:.1em .35em;border-radius:4px}pre{background:#111;color:#eee;padding:14px;border-radius:8px;overflow:auto}pre code{background:none}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd5ce;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f6f2ee}
img{max-width:100%}mark{background:#ffe066}ul[data-type=taskList]{list-style:none;padding-left:0}ul[data-type=taskList] li{display:flex;gap:.5em}
p{margin:0 0 .75em}td p,th p,li p{margin:0}
</style></head><body>
${body}
</body></html>`;
}

/* ---------- Markdown ---------- */

export async function toMarkdown(html: string) {
  const [{ default: TurndownService }, gfm] = await Promise.all([import("turndown"), import("turndown-plugin-gfm")]);
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm.gfm);
  td.addRule("taskItem", {
    filter: (n) => n.nodeName === "LI" && (n as HTMLElement).dataset.checked != null,
    replacement: (content, n) => `- [${(n as HTMLElement).dataset.checked === "true" ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`,
  });
  td.addRule("mark", { filter: ["mark"], replacement: (c) => `==${c}==` });
  // GFM tables need plain cells: unwrap the <p> TipTap puts in each one.
  const d = parse(html);
  d.querySelectorAll("td > p, th > p, li > p").forEach((p) => p.replaceWith(...p.childNodes, " "));
  d.querySelectorAll("table").forEach((t) => {
    const first = t.querySelector("tr");
    if (first && !first.querySelector("th")) first.querySelectorAll("td").forEach((c) => {
      const th = document.createElement("th");
      th.innerHTML = c.innerHTML;
      c.replaceWith(th);
    });
  });
  d.querySelectorAll("label").forEach((l) => l.remove());
  return td.turndown(d.innerHTML).replace(/\n{3,}/g, "\n\n") + "\n";
}

/* ---------- Images: sized, and in a format the writers accept ---------- */

async function prepImage(src: string, maxW: number): Promise<{ data: string; bytes: Uint8Array; type: "png" | "jpg"; w: number; h: number } | null> {
  try {
    let blob = await (await fetch(src)).blob();
    if (!/image\/(png|jpe?g)/.test(blob.type)) blob = await reencode(blob, "image/png");
    const img = await loadImage(blob);
    const s = Math.min(1, maxW / img.width);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: `data:${blob.type};base64,${btoa(bin)}`, bytes, type: blob.type === "image/png" ? "png" : "jpg", w: Math.round(img.width * s), h: Math.round(img.height * s) };
  } catch {
    return null;
  }
}

/* ---------- PDF (real text, selectable and searchable) ---------- */

export async function toPdf(html: string, title: string, landscape = false): Promise<Blob> {
  const [{ default: pdfMake }, { default: fonts }, { default: htmlToPdfmake }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    import("html-to-pdfmake"),
  ]);
  const pm = pdfMake as unknown as {
    addVirtualFileSystem(v: unknown): void;
    createPdf(dd: unknown): { getBlob(): Promise<Blob> };
  };
  pm.addVirtualFileSystem(fonts);

  const d = parse(html);
  const contentW = landscape ? 762 : 515;
  for (const img of [...d.querySelectorAll("img")]) {
    const p = await prepImage(img.getAttribute("src") ?? "", contentW);
    if (!p) {
      img.remove();
      continue;
    }
    img.setAttribute("src", p.data);
    img.setAttribute("width", String(p.w));
    img.removeAttribute("height");
  }
  d.querySelectorAll("li[data-checked]").forEach((li) => li.prepend(li.getAttribute("data-checked") === "true" ? "☑ " : "☐ "));
  d.querySelectorAll("label, input").forEach((e) => e.remove());
  d.querySelectorAll("td > p, th > p, li > p").forEach((p) => {
    const span = document.createElement("span");
    span.innerHTML = p.innerHTML;
    p.replaceWith(span, document.createElement("br"));
  });
  d.querySelectorAll("td > br:last-child, th > br:last-child, li > br:last-child").forEach((b) => b.remove());
  d.querySelectorAll("table").forEach((t) => {
    const cols = Math.max(...[...t.querySelectorAll("tr")].map((r) => r.children.length));
    t.setAttribute("data-pdfmake", JSON.stringify({ widths: Array(cols).fill("*"), headerRows: t.querySelector("th") ? 1 : 0 }));
  });

  const content = htmlToPdfmake(d.innerHTML, {
    window,
    tableAutoSize: false,
    defaultStyles: {
      h1: { fontSize: 24, bold: true, marginBottom: 8, marginTop: 10 },
      h2: { fontSize: 18, bold: true, marginBottom: 6, marginTop: 10 },
      h3: { fontSize: 14, bold: true, marginBottom: 5, marginTop: 8 },
      p: { margin: [0, 0, 0, 7], lineHeight: 1.25 },
      a: { color: "#b81d24", decoration: "underline" },
      blockquote: { italics: true, color: "#555555", margin: [12, 4, 0, 8] },
      th: { bold: true, fillColor: "#f6f2ee" },
      pre: { font: "Roboto", fontSize: 9, background: "#f3eeea", margin: [0, 4, 0, 8] },
      code: { background: "#f3eeea", fontSize: 10 },
      ul: { marginBottom: 7 },
      ol: { marginBottom: 7 },
      mark: { background: "#ffe066" },
    },
  });
  const dd = {
    info: { title, creator: "Folio", producer: "Folio" },
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [40, 50, 40, 50],
    content,
    defaultStyle: { font: "Roboto", fontSize: 11, color: "#1a1a1a" },
    footer: (page: number, pages: number) => (pages > 1 ? { text: `${page} / ${pages}`, alignment: "center", fontSize: 8, color: "#8a8a8a", margin: [0, 20, 0, 0] } : null),
  };
  return pm.createPdf(dd).getBlob();
}

/* ---------- Word (.docx) ---------- */

type Fmt = { bold?: boolean; italics?: boolean; underline?: object; strike?: boolean; color?: string; highlight?: string; font?: string; size?: number; superScript?: boolean; subScript?: boolean; link?: string };

function cssColor(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("");
  const h = /#([0-9a-f]{3,6})/i.exec(c);
  if (!h) return undefined;
  return h[1].length === 3 ? h[1].split("").map((x) => x + x).join("") : h[1];
}

export async function toDocx(html: string, title: string): Promise<Blob> {
  const D = await import("docx");
  const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink, AlignmentType, BorderStyle, ShadingType, LevelFormat } = D;
  const root = parse(html);
  const H = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED, left: AlignmentType.LEFT };
  let olInstance = 0;

  type Run = InstanceType<typeof TextRun> | InstanceType<typeof ImageRun> | InstanceType<typeof ExternalHyperlink>;
  const inline = async (node: Node, f: Fmt): Promise<Run[]> => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (!text) return [];
      const run = new TextRun({
        text,
        bold: f.bold, italics: f.italics, strike: f.strike, color: f.color ?? (f.link ? "B81D24" : undefined),
        underline: f.underline ?? (f.link ? {} : undefined), highlight: f.highlight as "yellow" | undefined,
        font: f.font, size: f.size, superScript: f.superScript, subScript: f.subScript,
      });
      return [run];
    }
    if (node.nodeType !== 1) return [];
    const el = node as HTMLElement;
    const t = el.tagName.toLowerCase();
    const g: Fmt = { ...f };
    if (t === "strong" || t === "b") g.bold = true;
    if (t === "em" || t === "i") g.italics = true;
    if (t === "u") g.underline = {};
    if (t === "s" || t === "del" || t === "strike") g.strike = true;
    if (t === "mark") g.highlight = "yellow";
    if (t === "code") g.font = "Consolas";
    if (t === "sup") g.superScript = true;
    if (t === "sub") g.subScript = true;
    if (el.style?.color) g.color = cssColor(el.style.color);
    if (el.style?.fontWeight === "bold" || Number(el.style?.fontWeight) >= 600) g.bold = true;
    if (el.style?.fontStyle === "italic") g.italics = true;
    if (t === "br") return [new TextRun({ text: "", break: 1 })];
    if (t === "img") {
      const p = await prepImage(el.getAttribute("src") ?? "", 600);
      return p ? [new ImageRun({ type: p.type, data: p.bytes, transformation: { width: p.w, height: p.h } })] : [];
    }
    if (t === "a" && el.getAttribute("href")) {
      g.link = el.getAttribute("href")!;
      const kids = (await Promise.all([...el.childNodes].map((c) => inline(c, g)))).flat() as InstanceType<typeof TextRun>[];
      return [new ExternalHyperlink({ link: g.link, children: kids })];
    }
    return (await Promise.all([...el.childNodes].map((c) => inline(c, g)))).flat();
  };

  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;
  const isBlock = (n: Node) => n.nodeType === 1 && /^(P|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|HR|DIV|SECTION|ARTICLE|FIGURE|HEADER|FOOTER)$/.test((n as Element).tagName);

  const blocks = async (parent: Element, ctx: { quote?: boolean; list?: { ref: string; level: number; instance?: number } } = {}): Promise<Block[]> => {
    const out: Block[] = [];
    let loose: Node[] = [];
    const flushLoose = async () => {
      if (!loose.length) return;
      const runs = (await Promise.all(loose.map((n) => inline(n, {})))).flat();
      loose = [];
      if (runs.length) out.push(new Paragraph({ children: runs }));
    };
    for (const node of [...parent.childNodes]) {
      if (!isBlock(node)) {
        if (node.nodeType === 3 && !node.textContent?.trim() && !loose.length) continue;
        loose.push(node);
        continue;
      }
      await flushLoose();
      const el = node as HTMLElement;
      const t = el.tagName.toLowerCase();
      const align = ALIGN[el.style?.textAlign ?? ""];
      if (/^h[1-6]$/.test(t)) {
        out.push(new Paragraph({ heading: H[Number(t[1]) - 1], alignment: align, children: await inline(el, {}) }));
      } else if (t === "p") {
        out.push(new Paragraph({
          alignment: align,
          children: await inline(el, ctx.quote ? { italics: true, color: "555555" } : {}),
          indent: ctx.quote ? { left: 480 } : undefined,
          border: ctx.quote ? { left: { style: BorderStyle.SINGLE, size: 18, color: "B81D24", space: 12 } } : undefined,
          spacing: { after: 140 },
        }));
      } else if (t === "ul" || t === "ol") {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        const ref = t === "ol" ? "numbers" : "bullets";
        const instance = t === "ol" && !ctx.list ? ++olInstance : ctx.list?.instance;
        for (const li of [...el.children].filter((c) => c.tagName === "LI")) {
          const checked = (li as HTMLElement).dataset.checked;
          const content = li.querySelector(":scope > div") ?? li;
          const firstKids: Node[] = [];
          const nested: Element[] = [];
          for (const c of [...content.childNodes]) {
            if (c.nodeType === 1 && /^(UL|OL)$/.test((c as Element).tagName)) nested.push(c as Element);
            else if (c.nodeType === 1 && (c as Element).tagName === "LABEL") continue;
            else firstKids.push(c);
          }
          const runs: Run[] = [];
          if (checked != null) runs.push(new TextRun({ text: checked === "true" ? "☑ " : "☐ " }));
          for (const k of firstKids) runs.push(...(isBlock(k) ? await inline(k, {}) : await inline(k, {})));
          out.push(new Paragraph({
            children: runs,
            numbering: checked != null ? undefined : { reference: ref, level: Math.min(level, 5), instance },
            indent: checked != null ? { left: 360 * (level + 1) } : undefined,
          }));
          for (const n of nested) out.push(...(await blocks(Object.assign(document.createElement("div"), { innerHTML: n.outerHTML }), { list: { ref, level, instance } })));
        }
      } else if (t === "blockquote") {
        out.push(...(await blocks(el, { ...ctx, quote: true })));
      } else if (t === "pre") {
        const lines = (el.textContent ?? "").replace(/\n$/, "").split("\n");
        for (const l of lines)
          out.push(new Paragraph({ children: [new TextRun({ text: l || " ", font: "Consolas", size: 19 })], shading: { type: ShadingType.CLEAR, fill: "F3EEEA", color: "auto" }, spacing: { after: 0 } }));
        out.push(new Paragraph({ children: [] }));
      } else if (t === "hr") {
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "DDD5CE", space: 1 } } }));
      } else if (t === "table") {
        const rows = [...el.querySelectorAll("tr")].filter((r) => r.closest("table") === el);
        const cols = Math.max(1, ...rows.map((r) => r.children.length));
        const tRows = [];
        for (const r of rows) {
          const cells = [];
          for (const c of [...r.children] as HTMLElement[]) {
            const kids = await blocks(c);
            cells.push(new TableCell({
              children: kids.length ? kids : [new Paragraph({ children: [] })],
              columnSpan: Number(c.getAttribute("colspan") ?? 1),
              rowSpan: Number(c.getAttribute("rowspan") ?? 1),
              shading: c.tagName === "TH" ? { type: ShadingType.CLEAR, fill: "F6F2EE", color: "auto" } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            }));
          }
          tRows.push(new TableRow({ children: cells, tableHeader: r.querySelector("th") != null }));
        }
        if (tRows.length) out.push(new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: Array(cols).fill(Math.floor(9000 / cols)) }));
        out.push(new Paragraph({ children: [] }));
      } else {
        out.push(...(await blocks(el, ctx)));
      }
    }
    await flushLoose();
    return out;
  };

  const children = await blocks(root);
  const bulletChars = ["•", "◦", "▪", "•", "◦", "▪"];
  const doc = new D.Document({
    creator: "Folio",
    title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 40, bold: true, color: "141414" }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: "141414" }, paragraph: { spacing: { before: 220, after: 100 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { size: 25, bold: true, color: "333333" }, paragraph: { spacing: { before: 200, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: bulletChars.map((text, level) => ({ level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) },
        { reference: "numbers", levels: [0, 1, 2, 3, 4, 5].map((level) => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3], text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return D.Packer.toBlob(doc);
}

/* ---------- OpenDocument text (.odt) ---------- */

export async function toOdt(html: string, title: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  const pics: string[] = [];
  const inl = async (n: Node): Promise<string> => {
    if (n.nodeType === 3) return esc((n.textContent ?? "").replace(/\s+/g, " "));
    if (n.nodeType !== 1) return "";
    const el = n as HTMLElement;
    const t = el.tagName.toLowerCase();
    const kids = (await Promise.all([...el.childNodes].map(inl))).join("");
    if (t === "strong" || t === "b") return `<text:span text:style-name="B">${kids}</text:span>`;
    if (t === "em" || t === "i") return `<text:span text:style-name="I">${kids}</text:span>`;
    if (t === "u") return `<text:span text:style-name="U">${kids}</text:span>`;
    if (t === "s") return `<text:span text:style-name="S">${kids}</text:span>`;
    if (t === "mark") return `<text:span text:style-name="M">${kids}</text:span>`;
    if (t === "code") return `<text:span text:style-name="C">${kids}</text:span>`;
    if (t === "br") return "<text:line-break/>";
    if (t === "a") return `<text:a xlink:type="simple" xlink:href="${esc(el.getAttribute("href") ?? "")}">${kids}</text:a>`;
    if (t === "img") {
      const p = await prepImage(el.getAttribute("src") ?? "", 600);
      if (!p) return "";
      const name = `Pictures/img${pics.length}.${p.type === "png" ? "png" : "jpg"}`;
      pics.push(name);
      zip.file(name, p.bytes);
      return `<draw:frame draw:name="img${pics.length}" text:anchor-type="as-char" svg:width="${(p.w * 0.0264583).toFixed(2)}cm" svg:height="${(p.h * 0.0264583).toFixed(2)}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
    }
    return kids;
  };
  const blk = async (parent: Element): Promise<string> => {
    let out = "";
    for (const n of [...parent.childNodes]) {
      if (n.nodeType !== 1) {
        if (n.textContent?.trim()) out += `<text:p>${esc(n.textContent)}</text:p>`;
        continue;
      }
      const el = n as HTMLElement;
      const t = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) out += `<text:h text:style-name="Heading_20_${t[1]}" text:outline-level="${t[1]}">${await inl(el)}</text:h>`;
      else if (t === "p") out += `<text:p text:style-name="${el.closest("blockquote") ? "Quote" : "Standard"}">${await inl(el)}</text:p>`;
      else if (t === "ul" || t === "ol") {
        out += `<text:list text:style-name="${t === "ol" ? "LN" : "LB"}">`;
        for (const li of [...el.children]) {
          const c = (li as HTMLElement).dataset.checked;
          const inner = li.querySelector(":scope > div") ?? li;
          const hasBlock = inner.querySelector(":scope > p, :scope > ul, :scope > ol");
          const prefix = c != null ? (c === "true" ? "☑ " : "☐ ") : "";
          out += `<text:list-item>${hasBlock ? (await blk(inner)).replace("<text:p text:style-name=\"Standard\">", `<text:p text:style-name="Standard">${prefix}`) : `<text:p>${prefix}${await inl(inner)}</text:p>`}</text:list-item>`;
        }
        out += "</text:list>";
      } else if (t === "table") {
        const rows = [...el.querySelectorAll("tr")];
        const cols = Math.max(1, ...rows.map((r) => r.children.length));
        out += `<table:table table:style-name="T"><table:table-column table:number-columns-repeated="${cols}"/>`;
        for (const r of rows) {
          out += "<table:table-row>";
          for (const c of [...r.children]) {
            const inner = c.querySelector("p") ? await blk(c) : `<text:p>${await inl(c)}</text:p>`;
            out += `<table:table-cell table:style-name="TC" office:value-type="string">${inner}</table:table-cell>`;
          }
          out += "</table:table-row>";
        }
        out += "</table:table>";
      } else if (t === "pre") {
        for (const l of (el.textContent ?? "").split("\n")) out += `<text:p text:style-name="Code">${esc(l).replace(/ {2}/g, " <text:s/>")}</text:p>`;
      } else if (t === "hr") out += `<text:p text:style-name="HR"/>`;
      else out += await blk(el);
    }
    return out;
  };
  const body = await blk(parse(html));
  const NS = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"`;
  zip.file("content.xml", `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3"><office:automatic-styles>
<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="U" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
<style:style style:name="S" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>
<style:style style:name="M" style:family="text"><style:text-properties fo:background-color="#ffe066"/></style:style>
<style:style style:name="C" style:family="text"><style:text-properties style:font-name="Courier New" fo:font-family="'Courier New'"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.8cm" fo:border-left="0.08cm solid #b81d24" fo:padding-left="0.3cm"/><style:text-properties fo:font-style="italic" fo:color="#555555"/></style:style>
<style:style style:name="Code" style:family="paragraph"><style:paragraph-properties fo:background-color="#f3eeea"/><style:text-properties fo:font-family="'Courier New'" fo:font-size="9.5pt"/></style:style>
<style:style style:name="HR" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.03cm solid #ddd5ce" fo:padding-bottom="0.1cm"/></style:style>
<style:style style:name="T" style:family="table"><style:table-properties style:width="17cm" table:align="margins"/></style:style>
<style:style style:name="TC" style:family="table-cell"><style:table-cell-properties fo:border="0.03cm solid #ddd5ce" fo:padding="0.1cm"/></style:style>
<text:list-style style:name="LB">${[1, 2, 3, 4, 5, 6].map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="${"•◦▪"[(l - 1) % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.6cm" fo:margin-left="${(1.2 * l).toFixed(1)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join("")}</text:list-style>
<text:list-style style:name="LN">${[1, 2, 3, 4, 5, 6].map((l) => `<text:list-level-style-number text:level="${l}" style:num-format="${["1", "a", "i"][(l - 1) % 3]}" style:num-suffix="."><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.6cm" fo:margin-left="${(1.2 * l).toFixed(1)}cm"/></style:list-level-properties></text:list-level-style-number>`).join("")}</text:list-style>
</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`);
  zip.file("styles.xml", `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3"><office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="11pt" style:font-name="Liberation Sans" fo:font-family="'Liberation Sans', Arial"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
${[1, 2, 3, 4, 5, 6].map((l) => `<style:style style:name="Heading_20_${l}" style:display-name="Heading ${l}" style:family="paragraph" style:default-outline-level="${l}"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="${[22, 17, 14, 12, 11, 11][l - 1]}pt" fo:font-weight="bold"/></style:style>`).join("")}
</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`);
  zip.file("meta.xml", `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${esc(title)}</dc:title><meta:generator>Folio</meta:generator></office:meta></office:document-meta>`);
  zip.file("META-INF/manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
${pics.map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="image/${p.endsWith("png") ? "png" : "jpeg"}"/>`).join("\n")}
</manifest:manifest>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.oasis.opendocument.text" });
}

/* ---------- RTF ---------- */

export function toRtf(html: string): string {
  const enc = (s: string) =>
    [...s.replace(/\s+/g, " ")].map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === "\\" || ch === "{" || ch === "}") return "\\" + ch;
      if (c < 128) return ch;
      if (c > 0xffff) return "?";
      return `\\u${c > 32767 ? c - 65536 : c}?`;
    }).join("");
  const inl = (n: Node): string => {
    if (n.nodeType === 3) return enc(n.textContent ?? "");
    if (n.nodeType !== 1) return "";
    const el = n as HTMLElement;
    const t = el.tagName.toLowerCase();
    const k = [...el.childNodes].map(inl).join("");
    if (t === "strong" || t === "b") return `{\\b ${k}}`;
    if (t === "em" || t === "i") return `{\\i ${k}}`;
    if (t === "u") return `{\\ul ${k}}`;
    if (t === "s") return `{\\strike ${k}}`;
    if (t === "code") return `{\\f1 ${k}}`;
    if (t === "mark") return `{\\highlight7 ${k}}`;
    if (t === "br") return "\\line ";
    if (t === "a") return `{\\field{\\*\\fldinst HYPERLINK "${el.getAttribute("href")}"}{\\fldrslt {\\cf2\\ul ${k}}}}`;
    return k;
  };
  const blk = (parent: Element, indent = 0): string => {
    let o = "";
    for (const n of [...parent.childNodes]) {
      if (n.nodeType !== 1) continue;
      const el = n as HTMLElement;
      const t = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) o += `{\\pard\\sb240\\sa120\\b\\fs${[44, 34, 28, 24, 22, 22][Number(t[1]) - 1]} ${inl(el)}\\par}\n`;
      else if (t === "p") o += `{\\pard\\sa160${indent ? `\\li${indent}` : ""}${el.closest("blockquote") ? "\\li600\\i" : ""} ${inl(el)}\\par}\n`;
      else if (t === "ul" || t === "ol") [...el.children].forEach((li, i) => {
        const c = (li as HTMLElement).dataset.checked;
        const mark = c != null ? (c === "true" ? "\\u9745?" : "\\u9744?") : t === "ol" ? `${i + 1}.` : "\\bullet";
        const inner = li.querySelector(":scope > div") ?? li;
        const first = [...inner.childNodes].filter((x) => !(x.nodeType === 1 && /^(UL|OL|LABEL)$/.test((x as Element).tagName)));
        o += `{\\pard\\sa60\\fi-300\\li${indent + 600} ${mark}\\tab ${first.map(inl).join("")}\\par}\n`;
        inner.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => (o += blk(Object.assign(document.createElement("div"), { innerHTML: sub.outerHTML }), indent + 400)));
      });
      else if (t === "table") {
        for (const r of el.querySelectorAll("tr")) {
          const cells = [...r.children];
          o += "\\trowd\\trgaph100" + cells.map((_, i) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${Math.round(((i + 1) * 9000) / cells.length)}`).join("");
          o += cells.map((c) => `\\pard\\intbl ${c.tagName === "TH" ? "\\b " : ""}${inl(c)}${c.tagName === "TH" ? "\\b0" : ""}\\cell`).join("") + "\\row\n";
        }
        o += "\\pard\\par\n";
      } else if (t === "pre") o += (el.textContent ?? "").split("\n").map((l) => `{\\pard\\f1\\fs19 ${enc(l)}\\par}`).join("\n") + "\n";
      else if (t === "hr") o += "{\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par}\n";
      else o += blk(el, indent);
    }
    return o;
  };
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Calibri;}{\\f1\\fmodern Consolas;}}{\\colortbl;\\red20\\green20\\blue20;\\red184\\green29\\blue36;}\\fs22\n${blk(parse(html))}}`;
}

/* ---------- EPUB ---------- */

export async function toEpub(html: string, title: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  // One chapter per top heading.
  const root = parse(html);
  const images: { name: string; type: string }[] = [];
  for (const img of [...root.querySelectorAll("img")]) {
    const p = await prepImage(img.getAttribute("src") ?? "", 1200);
    if (!p) {
      img.remove();
      continue;
    }
    const name = `img${images.length}.${p.type}`;
    zip.file(`OEBPS/${name}`, p.bytes);
    images.push({ name, type: p.type === "png" ? "image/png" : "image/jpeg" });
    img.setAttribute("src", name);
  }
  root.querySelectorAll("label, input").forEach((e) => e.remove());
  const chapters: { title: string; nodes: string[] }[] = [{ title, nodes: [] }];
  for (const n of [...root.children]) {
    if (n.tagName === "H1" && chapters[chapters.length - 1].nodes.length) chapters.push({ title: n.textContent || title, nodes: [] });
    else if (n.tagName === "H1") chapters[chapters.length - 1].title = n.textContent || title;
    chapters[chapters.length - 1].nodes.push(new XMLSerializer().serializeToString(n).replace(/ xmlns="[^"]*"/g, ""));
  }
  const css = "body{font-family:serif;line-height:1.6}h1,h2,h3{font-family:sans-serif}blockquote{border-left:3px solid #b81d24;padding-left:1em;font-style:italic}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px}img{max-width:100%}";
  zip.file("OEBPS/style.css", css);
  chapters.forEach((c, i) =>
    zip.file(`OEBPS/ch${i}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(c.title)}</title><link rel="stylesheet" href="style.css"/></head><body>${c.nodes.join("\n")}</body></html>`),
  );
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="ch${i}.xhtml">${esc(c.title)}</a></li>`).join("")}</ol></nav></body></html>`);
  const id = "urn:uuid:" + crypto.randomUUID();
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chapters.map((_, i) => `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${images.map((im, i) => `<item id="im${i}" href="${im.name}" media-type="${im.type}"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join("")}</spine></package>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
}

/* ---------- Saving files ---------- */

export function download(blob: Blob, name: string) {
  if (native) {
    toBase64(blob).then((b) => native!.save(name, blob.type, b));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Share on phones (to Drive, mail, chat…), download elsewhere. */
export async function shareOrDownload(blob: Blob, name: string) {
  if (native) {
    native.share(name, blob.type, await toBase64(blob));
    return "shared";
  }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  download(blob, name);
  return "downloaded";
}

export async function zipFiles(files: OutFile[]) {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let n = f.name;
    for (let i = 2; used.has(n); i++) n = f.name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    used.add(n);
    zip.file(n, f.blob);
  }
  return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

/** For the image size of a picture we only have as a URL. */
export const imageSize = async (src: string) => {
  const img = await loadImage(await (await fetch(src)).blob());
  return { w: img.width, h: img.height };
};
