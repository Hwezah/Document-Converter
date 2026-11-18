import DOMPurify from "dompurify";
import JSZip from "jszip";
import { marked } from "marked";
import { blobToDataUrl, type SheetData } from "./store";
import { extOf, familyOf } from "./formats";
import { openPdf, pdfToHtml } from "./pdf";

export type Imported =
  | { kind: "doc"; html: string }
  | { kind: "sheet"; sheets: SheetData[] }
  | { kind: "file"; ext: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function clean(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-type", "data-checked", "colspan", "rowspan", "style"],
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
  });
}

export function textToHtml(t: string) {
  return t
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function htmlToText(html: string) {
  const d = document.createElement("div");
  d.innerHTML = html;
  d.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  d.querySelectorAll("li").forEach((li) => li.prepend(li.closest("ol") ? "" : "• "));
  d.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,hr,div").forEach((b) => b.append("\n"));
  d.querySelectorAll("td,th").forEach((c) => c.append("\t"));
  return (d.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Reads any supported file. PDFs and pictures stay files (with a viewer); the rest become editable. */
export async function importFile(file: File | Blob, name = (file as File).name ?? "file"): Promise<Imported> {
  const ext = extOf(name, file.type);
  const fam = familyOf(ext);
  if (fam === "pdf" || fam === "image") return { kind: "file", ext };
  if (fam === "sheet") return { kind: "sheet", sheets: await readSheets(file, ext) };
  return { kind: "doc", html: await readAsHtml(file, ext) };
}

/** Any document's content as HTML — PDFs and images included, for conversion. */
export async function readAsHtml(file: Blob, ext: string, onProgress?: (msg: string) => void): Promise<string> {
  switch (ext) {
    case "docx": {
      const mammoth = await import("mammoth");
      const r = await mammoth.convertToHtml(
        { arrayBuffer: await file.arrayBuffer() },
        { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "r[style-name='Strong'] => strong", "highlight => mark"] },
      );
      return clean(r.value);
    }
    case "odt":
      return clean(await readOdt(file));
    case "rtf":
      return rtfToHtml(await file.text());
    case "md":
      return clean(await marked.parse(await file.text(), { gfm: true, breaks: false }));
    case "html": {
      const doc = new DOMParser().parseFromString(await file.text(), "text/html");
      return clean(doc.body.innerHTML);
    }
    case "epub":
      return clean(await readEpub(file));
    case "pptx":
      return readPptx(file);
    case "pdf": {
      const doc = await openPdf(await file.arrayBuffer());
      return pdfToHtml(doc, (n, of) => onProgress?.(`Reading page ${n} of ${of}`));
    }
    case "csv":
    case "tsv":
    case "xlsx":
    case "xls":
    case "ods":
    case "json":
      return sheetsToHtml(await readSheets(file, ext));
    default:
      if (familyOf(ext) === "image") return `<p><img src="${await blobToDataUrl(file)}" alt=""></p>`;
      return textToHtml(await file.text());
  }
}

/* ---------- Spreadsheets ---------- */

export async function readSheets(file: Blob, ext: string): Promise<SheetData[]> {
  if (ext === "json") {
    const data = JSON.parse(await file.text());
    const arr: unknown[] = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) ?? [data];
    if (arr.length && typeof arr[0] === "object" && arr[0] && !Array.isArray(arr[0])) {
      const keys = [...new Set(arr.flatMap((o) => Object.keys(o as object)))];
      return [{ name: "Sheet1", rows: [keys, ...arr.map((o) => keys.map((k) => cell((o as Record<string, unknown>)[k])))] }];
    }
    return [{ name: "Sheet1", rows: arr.map((r) => (Array.isArray(r) ? r.map(cell) : [cell(r)])) }];
  }
  const XLSX = await import("xlsx");
  const wb = ext === "csv" || ext === "tsv"
    ? XLSX.read(await file.text(), { type: "string", FS: ext === "tsv" ? "\t" : undefined, raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  return wb.SheetNames.map((n) => ({
    name: n,
    rows: (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: "", blankrows: false }) as unknown[][]).map((r) => r.map(cell)),
  }));
}
const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function sheetsToHtml(sheets: SheetData[]) {
  return sheets
    .map((s) => {
      const [head, ...rest] = s.rows;
      const th = head ? `<tr>${head.map((c) => `<th><p>${esc(c)}</p></th>`).join("")}</tr>` : "";
      const tds = rest.map((r) => `<tr>${(head ?? r).map((_, i) => `<td><p>${esc(r[i] ?? "")}</p></td>`).join("")}</tr>`).join("");
      return `${sheets.length > 1 ? `<h2>${esc(s.name)}</h2>` : ""}<table><tbody>${th}${tds}</tbody></table>`;
    })
    .join("");
}

/** Tables in a document, as sheets: a doc with tables can become a spreadsheet. */
export function htmlTablesToSheets(html: string): SheetData[] {
  const d = document.createElement("div");
  d.innerHTML = html;
  return [...d.querySelectorAll("table")].map((t, i) => ({
    name: `Table ${i + 1}`,
    rows: [...t.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("td,th")].map((c) => (c.textContent ?? "").trim())),
  }));
}

/* ---------- OpenDocument text ---------- */

async function readOdt(file: Blob) {
  const zip = await JSZip.loadAsync(file);
  const xml = new DOMParser().parseFromString(await zip.file("content.xml")!.async("text"), "application/xml");
  const NS = {
    text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    xlink: "http://www.w3.org/1999/xlink",
  };
  // Automatic styles say which spans are bold, italic, underlined.
  const fx: Record<string, string[]> = {};
  for (const s of [...xml.getElementsByTagNameNS(NS.style, "style")]) {
    const name = s.getAttributeNS(NS.style, "name")!;
    const tp = s.getElementsByTagNameNS(NS.style, "text-properties")[0];
    if (!tp) continue;
    const f: string[] = [];
    if (tp.getAttributeNS(NS.fo, "font-weight") === "bold") f.push("strong");
    if (tp.getAttributeNS(NS.fo, "font-style") === "italic") f.push("em");
    if ((tp.getAttributeNS(NS.style, "text-underline-style") ?? "none") !== "none") f.push("u");
    fx[name] = f;
  }
  // Which list styles number their items, per level: "L2" -> {1: true, 2: false…}.
  const numbered: Record<string, Record<number, boolean>> = {};
  for (const ls of [...xml.getElementsByTagNameNS(NS.text, "list-style")]) {
    const name = ls.getAttributeNS(NS.style, "name")!;
    numbered[name] = {};
    for (const lvl of [...ls.children]) numbered[name][Number(lvl.getAttributeNS(NS.text, "level") ?? 1)] = lvl.localName === "list-level-style-number";
  }
  const lists: { style: string; depth: number }[] = [];
  const imgs: Record<string, string> = {};
  for (const f of Object.keys(zip.files).filter((n) => n.startsWith("Pictures/"))) {
    const b = await zip.file(f)!.async("base64");
    imgs[f] = `data:image/${f.split(".").pop()?.replace("jpg", "jpeg")};base64,${b}`;
  }

  const walk = (n: Node): string => {
    if (n.nodeType === 3) return esc(n.textContent ?? "");
    if (n.nodeType !== 1) return "";
    const el = n as Element;
    const kids = () => [...el.childNodes].map(walk).join("");
    const style = el.getAttributeNS(NS.text, "style-name") ?? "";
    switch (el.namespaceURI === NS.text || el.namespaceURI === NS.table || el.namespaceURI === NS.draw ? el.localName : "") {
      case "h": {
        const l = Math.min(Number(el.getAttributeNS(NS.text, "outline-level") ?? 1), 6);
        return `<h${l}>${kids()}</h${l}>`;
      }
      case "p": return `<p>${wrap(kids(), fx[style])}</p>`;
      case "span": return wrap(kids(), fx[style]);
      case "a": return `<a href="${esc(el.getAttributeNS(NS.xlink, "href") ?? "")}">${kids()}</a>`;
      case "line-break": return "<br>";
      case "tab": return "\t";
      case "s": return " ".repeat(Number(el.getAttributeNS(NS.text, "c") ?? 1));
      case "list": {
        const parent = lists[lists.length - 1];
        const style = el.getAttributeNS(NS.text, "style-name") || parent?.style || "";
        const depth = (parent?.depth ?? 0) + 1;
        lists.push({ style, depth });
        const tag = numbered[style]?.[depth] ? "ol" : "ul";
        const html = `<${tag}>${kids()}</${tag}>`;
        lists.pop();
        return html;
      }
      case "list-item": return `<li>${kids()}</li>`;
      case "table": return `<table><tbody>${kids()}</tbody></table>`;
      case "table-row": return `<tr>${kids()}</tr>`;
      case "table-cell": return `<td>${kids()}</td>`;
      case "image": {
        const href = el.getAttributeNS(NS.xlink, "href") ?? "";
        return imgs[href] ? `<img src="${imgs[href]}">` : "";
      }
      default: return kids();
    }
  };
  const body = xml.getElementsByTagNameNS(NS.text, "body")[0] ?? xml.documentElement;
  return walk(body);
}
const wrap = (s: string, tags?: string[]) => (tags ?? []).reduce((acc, t) => `<${t}>${acc}</${t}>`, s);

/* ---------- RTF ---------- */

/** A small RTF reader: paragraphs, bold, italic, underline, unicode and hex escapes; skips fonts, colours, pictures. */
export function rtfToHtml(rtf: string): string {
  const paras: string[] = [];
  let cur = "";
  const state = { b: false, i: false, u: false, skip: false };
  const stack: (typeof state)[] = [];
  let open = { b: false, i: false, u: false };
  const sync = () => {
    let s = "";
    for (const k of ["u", "i", "b"] as const) if (open[k] && !state[k]) s += `</${k === "b" ? "strong" : k === "i" ? "em" : "u"}>`;
    for (const k of ["b", "i", "u"] as const) if (!open[k] && state[k]) s += `<${k === "b" ? "strong" : k === "i" ? "em" : "u"}>`;
    open = { b: state.b, i: state.i, u: state.u };
    cur += s;
  };
  const closeAll = () => {
    const s = { ...state };
    state.b = state.i = state.u = false;
    sync();
    Object.assign(state, { b: s.b, i: s.i, u: s.u });
  };
  const emit = (t: string) => {
    if (state.skip) return;
    sync();
    cur += esc(t);
  };
  let uc = 1;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ ...state });
      // Destinations we don't show: font and colour tables, stylesheets, pictures, info, "\*" anything.
      const ahead = rtf.slice(i + 1, i + 14);
      if (/^\\(\*|fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|generator|themedata|latentstyles)/.test(ahead)) state.skip = true;
    } else if (c === "}") {
      Object.assign(state, stack.pop() ?? state);
    } else if (c === "\\") {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\([^a-z])/i.exec(rtf.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      if (m[3]) emit(String.fromCharCode(parseInt(m[3], 16)));
      else if (m[4]) emit(m[4] === "~" ? " " : m[4] === "\n" || m[4] === "\r" ? "" : "\\{}".includes(m[4]) ? m[4] : "");
      else {
        const w = m[1];
        const n = m[2] == null ? undefined : Number(m[2]);
        if (w === "par" || w === "line") {
          if (!state.skip) {
            closeAll();
            paras.push(cur);
            cur = "";
          }
        } else if (w === "tab") emit("\t");
        else if (w === "b") state.b = n !== 0;
        else if (w === "i") state.i = n !== 0;
        else if (w === "ul") state.u = n !== 0;
        else if (w === "ulnone") state.u = false;
        else if (w === "plain") state.b = state.i = state.u = false;
        else if (w === "uc") uc = n ?? 1;
        else if (w === "u" && n != null) {
          emit(String.fromCharCode(n < 0 ? n + 65536 : n));
          i += uc; // skip the ANSI fallback character(s)
        } else if (w === "emdash") emit("—");
        else if (w === "endash") emit("–");
        else if (w === "bullet") emit("•");
        else if (w === "lquote") emit("‘");
        else if (w === "rquote") emit("’");
        else if (w === "ldblquote") emit("“");
        else if (w === "rdblquote") emit("”");
      }
    } else if (c !== "\r" && c !== "\n") emit(c);
  }
  closeAll();
  if (cur.trim()) paras.push(cur);
  return paras.map((p) => `<p>${p || "<br>"}</p>`).join("") || "<p></p>";
}

/* ---------- EPUB ---------- */

async function readEpub(file: Blob) {
  const zip = await JSZip.loadAsync(file);
  const container = new DOMParser().parseFromString(await zip.file("META-INF/container.xml")!.async("text"), "application/xml");
  const opfPath = container.querySelector("rootfile")!.getAttribute("full-path")!;
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = new DOMParser().parseFromString(await zip.file(opfPath)!.async("text"), "application/xml");
  const manifest = new Map([...opf.querySelectorAll("manifest > item")].map((i) => [i.getAttribute("id")!, i.getAttribute("href")!]));
  const resolve = (base: string, rel: string) => {
    const parts = (base.slice(0, base.lastIndexOf("/") + 1) + decodeURIComponent(rel)).split("/");
    const out: string[] = [];
    for (const p of parts) p === ".." ? out.pop() : p !== "." && out.push(p);
    return out.join("/");
  };
  const chapters: string[] = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const href = manifest.get(ref.getAttribute("idref")!);
    if (!href) continue;
    const path = dir + href;
    const f = zip.file(path);
    if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async("text"), "application/xhtml+xml");
    for (const img of doc.querySelectorAll("img, image")) {
      const src = img.getAttribute("src") ?? img.getAttribute("xlink:href") ?? img.getAttribute("href");
      const imgFile = src ? zip.file(resolve(path, src)) : null;
      if (imgFile) {
        const ext = src!.split(".").pop()!.toLowerCase().replace("jpg", "jpeg").replace("svg", "svg+xml");
        const el = doc.createElement("img");
        el.setAttribute("src", `data:image/${ext};base64,${await imgFile.async("base64")}`);
        img.replaceWith(el);
      }
    }
    const body = doc.querySelector("body");
    if (body) chapters.push(body.innerHTML);
  }
  return chapters.join("<hr>");
}

/* ---------- PowerPoint ---------- */

async function readPptx(file: Blob) {
  const zip = await JSZip.loadAsync(file);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    const xml = new DOMParser().parseFromString(await zip.file(s)!.async("text"), "application/xml");
    const paras = [...xml.getElementsByTagName("a:p")]
      .map((p) => [...p.getElementsByTagName("a:t")].map((t) => t.textContent).join(""))
      .filter((t) => t.trim());
    out.push(`<h2>Slide ${i + 1}${paras[0] ? ": " + esc(paras[0]) : ""}</h2>`);
    if (paras.length > 1) out.push(`<ul>${paras.slice(1).map((p) => `<li><p>${esc(p)}</p></li>`).join("")}</ul>`);
  }
  return out.join("") || "<p>No text in this presentation.</p>";
}
