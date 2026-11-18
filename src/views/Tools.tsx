import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Camera, Download, FilePen, FileStack, Hash, ImagePlus, Info, Library, LayoutGrid, RotateCcw, RotateCw, Scissors, Stamp, Trash2, Upload, X, Images,
} from "lucide-react";
import { useApp } from "../app";
import { create, getBlob, useItems, type Item } from "../lib/store";
import { baseName, humanSize } from "../lib/formats";
import { imagesToPdf, mergePdfs, openPdf, rebuildPdf, renderPage, setPdfInfo, splitPdf, stampPdf, pdfToHtml, type PDFDocumentProxy } from "../lib/pdf";
import { download, zipFiles } from "../lib/exporters";
import { FileBadge, Modal, Spinner, useToast } from "../ui/kit";

type ToolId = "organize" | "merge" | "split" | "scan" | "images" | "watermark" | "numbers" | "info" | "text";
const TOOLS: { id: ToolId; title: string; body: string; icon: ReactNode; color: string }[] = [
  { id: "organize", title: "Organize pages", body: "Reorder, rotate, delete or pull out pages", icon: <LayoutGrid size={20} />, color: "glow-orange" },
  { id: "merge", title: "Merge PDFs", body: "Several PDFs into one, in your order", icon: <FileStack size={20} />, color: "glow-red" },
  { id: "split", title: "Split PDF", body: "By page ranges, like 1-3, 5, 8-", icon: <Scissors size={20} />, color: "glow-orange" },
  { id: "scan", title: "Scan to PDF", body: "Photograph pages with your camera", icon: <Camera size={20} />, color: "glow-green" },
  { id: "images", title: "Pictures to PDF", body: "Photos and screenshots, one per page", icon: <ImagePlus size={20} />, color: "glow-green" },
  { id: "text", title: "PDF to editable text", body: "Pull the words out to edit them", icon: <FilePen size={20} />, color: "glow-red" },
  { id: "watermark", title: "Watermark", body: "Stamp DRAFT, CONFIDENTIAL, your name…", icon: <Stamp size={20} />, color: "glow-orange" },
  { id: "numbers", title: "Page numbers", body: "Number every page at the bottom", icon: <Hash size={20} />, color: "glow-red" },
  { id: "info", title: "Title & author", body: "Change what a PDF says about itself", icon: <Info size={20} />, color: "glow-ink" },
];

export function Tools() {
  const [tool, setTool] = useState<ToolId | null>(null);
  return (
    <>
      <div className="overline">PDF tools</div>
      <h1 className="display" style={{ marginTop: 4 }}>Fix up any PDF</h1>
      <p className="body" style={{ margin: "6px 0 26px" }}>All done on your device — fast, private, and it works offline.</p>
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t.id} className="tool" onClick={() => setTool(t.id)}>
            <span className={`ficon grain ${t.color}`}>{t.icon}</span>
            <span>
              <b className="title" style={{ fontSize: 16 }}>{t.title}</b>
              <br />
              <span className="meta">{t.body}</span>
            </span>
          </button>
        ))}
      </div>
      {tool === "organize" && <Organize onClose={() => setTool(null)} />}
      {tool === "merge" && <Merge onClose={() => setTool(null)} />}
      {(tool === "scan" || tool === "images") && <ToPdf camera={tool === "scan"} onClose={() => setTool(null)} />}
      {(tool === "split" || tool === "watermark" || tool === "numbers" || tool === "info" || tool === "text") && <OneShot tool={tool} onClose={() => setTool(null)} />}
    </>
  );
}

/* ---------- Picking a PDF: from the library or from the device ---------- */

type Src = { name: string; data: ArrayBuffer };

function PickPdf({ onPick, multiple }: { onPick: (s: Src[]) => void; multiple?: boolean }) {
  const pdfs = useItems().filter((i) => i.ext === "pdf" && i.kind === "file" && !i.trashed);
  const input = useRef<HTMLInputElement>(null);
  const fromLib = async (i: Item) => {
    const b = await getBlob(i.id);
    if (b) onPick([{ name: i.title, data: await b.arrayBuffer() }]);
  };
  return (
    <>
      <button className="btn orange grain wide" onClick={() => input.current?.click()}><Upload size={17} /> Choose {multiple ? "PDFs" : "a PDF"} from this device</button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          onPick(await Promise.all(files.map(async (f) => ({ name: baseName(f.name), data: await f.arrayBuffer() }))));
        }}
      />
      {pdfs.length > 0 && (
        <>
          <div className="overline" style={{ margin: "18px 0 8px" }}>Or from your library</div>
          <div className="list card" style={{ maxHeight: 280, overflowY: "auto" }}>
            {pdfs.map((p) => (
              <button key={p.id} className="li" onClick={() => fromLib(p)}>
                <FileBadge ext="pdf" size="sm" />
                <span className="grow clip">{p.title}</span>
                <span className="meta">{humanSize(p.size)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** What to do with a finished PDF: download it or keep it in the library. */
function Result({ files, onDone }: { files: { name: string; blob: Blob }[]; onDone: () => void }) {
  const app = useApp();
  const toast = useToast();
  return (
    <div className="col" style={{ alignItems: "stretch" }}>
      <div className="list card">
        {files.map((f) => (
          <div key={f.name} className="li">
            <FileBadge ext={f.name.split(".").pop()!} size="sm" />
            <span className="grow clip">{f.name}</span>
            <span className="meta">{humanSize(f.blob.size)}</span>
            <button className="btn sm icon ghost" aria-label="Download" onClick={() => download(f.blob, f.name)}><Download size={16} /></button>
          </div>
        ))}
      </div>
      <div className="row mt" style={{ justifyContent: "flex-end" }}>
        <button
          className="btn"
          onClick={async () => {
            const made = await app.openFiles(files.map((f) => new File([f.blob], f.name, { type: f.blob.type })), { noOpen: true });
            toast(`Kept ${made.length} in your library`, "good", { label: "Open", run: () => made[0] && app.open(made[0].id) });
            onDone();
          }}
        >
          <Library size={16} /> Keep in library
        </button>
        <button
          className="btn green grain"
          onClick={async () => {
            if (files.length === 1) download(files[0].blob, files[0].name);
            else download(await zipFiles(files), "PDFs.zip");
            onDone();
          }}
        >
          <Download size={16} /> Download{files.length > 1 ? " all" : ""}
        </button>
      </div>
    </div>
  );
}

/* ---------- Organize ---------- */

interface Pg { index: number; rotate: number; deleted: boolean; selected: boolean }

function PageThumb({ doc, pg, n, onChange, onMove, count }: { doc: PDFDocumentProxy; pg: Pg; n: number; count: number; onChange: (p: Partial<Pg>) => void; onMove: (d: -1 | 1) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let gone = false;
    doc.getPage(pg.index + 1).then((p) => {
      if (!gone && ref.current) renderPage(p, ref.current, 120);
    });
    return () => {
      gone = true;
    };
  }, [doc, pg.index]);
  return (
    <div className={`pg ${pg.selected ? "sel" : ""} ${pg.deleted ? "del" : ""}`} onClick={() => onChange({ selected: !pg.selected })}>
      <span className="n">{n}</span>
      <div className="canvas-box"><canvas ref={ref} style={{ transform: `rotate(${pg.rotate}deg)` }} /></div>
      <div className="acts" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm icon ghost" aria-label="Move left" disabled={n === 1} onClick={() => onMove(-1)}><ArrowLeft size={14} /></button>
        <button className="btn sm icon ghost" aria-label="Rotate left" onClick={() => onChange({ rotate: (pg.rotate + 270) % 360 })}><RotateCcw size={14} /></button>
        <button className="btn sm icon ghost" aria-label="Rotate right" onClick={() => onChange({ rotate: (pg.rotate + 90) % 360 })}><RotateCw size={14} /></button>
        <button className={`btn sm icon ghost ${pg.deleted ? "danger" : ""}`} aria-label={pg.deleted ? "Keep page" : "Delete page"} onClick={() => onChange({ deleted: !pg.deleted })}><Trash2 size={14} /></button>
        <button className="btn sm icon ghost" aria-label="Move right" disabled={n === count} onClick={() => onMove(1)}><ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

function Organize({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<Src | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<Pg[]>([]);
  const [out, setOut] = useState<{ name: string; blob: Blob }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pick = async ([s]: Src[]) => {
    if (!s) return;
    try {
      const d = await openPdf(s.data);
      setSrc(s);
      setDoc(d);
      setPages(Array.from({ length: d.numPages }, (_, i) => ({ index: i, rotate: 0, deleted: false, selected: false })));
    } catch (e) {
      toast(`Couldn't open that PDF: ${(e as Error).message}`, "bad");
    }
  };
  const save = async (only?: "selected") => {
    if (!src) return;
    setBusy(true);
    try {
      const keep = pages.filter((p) => (only ? p.selected : !p.deleted));
      if (!keep.length) return toast("No pages left to save", "bad");
      const blob = await rebuildPdf(src.data, keep);
      setOut([{ name: `${src.name}${only ? " (extract)" : " (edited)"}.pdf`, blob }]);
    } finally {
      setBusy(false);
    }
  };
  const sel = pages.filter((p) => p.selected).length;

  return (
    <Modal label="Organize pages" onClose={onClose} wide>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h2 className="title">Organize pages{src ? ` · ${src.name}` : ""}</h2>
        <button className="btn sm icon ghost" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {out ? (
        <Result files={out} onDone={onClose} />
      ) : !doc ? (
        <PickPdf onPick={pick} />
      ) : (
        <>
          <p className="meta" style={{ marginTop: 0 }}>Tap pages to select them. Use the buttons under each page to move, rotate or delete it.</p>
          <div className="row wrap" style={{ marginBottom: 14 }}>
            <button className="btn sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, rotate: x.selected || !sel ? (x.rotate + 90) % 360 : x.rotate })))}><RotateCw size={14} /> Rotate {sel ? "selected" : "all"}</button>
            <button className="btn sm" disabled={!sel} onClick={() => setPages((p) => p.map((x) => (x.selected ? { ...x, deleted: true, selected: false } : x)))}><Trash2 size={14} /> Delete selected</button>
            <button className="btn sm" onClick={() => setPages((p) => [...p].reverse())}>Reverse order</button>
            <button className="btn sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, selected: !sel })))}>{sel ? "Select none" : "Select all"}</button>
          </div>
          <div className="pages-grid" style={{ maxHeight: "52vh", overflowY: "auto", padding: 4 }}>
            {pages.map((pg, i) => (
              <PageThumb
                key={pg.index}
                doc={doc}
                pg={pg}
                n={i + 1}
                count={pages.length}
                onChange={(p) => setPages((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                onMove={(d) => setPages((l) => {
                  const n = [...l];
                  [n[i], n[i + d]] = [n[i + d], n[i]];
                  return n;
                })}
              />
            ))}
          </div>
          <div className="row mt" style={{ justifyContent: "flex-end" }}>
            {busy && <Spinner />}
            <button className="btn" disabled={!sel || busy} onClick={() => save("selected")}>Extract {sel || ""} selected</button>
            <button className="btn orange grain" disabled={busy} onClick={() => save()}>Save {pages.filter((p) => !p.deleted).length} pages</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- Merge ---------- */

function Merge({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Src[]>([]);
  const [out, setOut] = useState<{ name: string; blob: Blob }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(true);
  const toast = useToast();
  return (
    <Modal label="Merge PDFs" onClose={onClose}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h2 className="title">Merge PDFs</h2>
        <button className="btn sm icon ghost" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {out ? (
        <Result files={out} onDone={onClose} />
      ) : (
        <>
          {list.length > 0 && (
            <div className="list card" style={{ marginBottom: 14 }}>
              {list.map((s, i) => (
                <div key={i} className="li">
                  <span className="badge">{i + 1}</span>
                  <span className="grow clip">{s.name}</span>
                  <button className="btn sm icon ghost" aria-label="Move up" disabled={!i} onClick={() => setList((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                  <button className="btn sm icon ghost" aria-label="Remove" onClick={() => setList((l) => l.filter((_, j) => j !== i))}><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
          {adding ? (
            <PickPdf multiple onPick={(s) => (setList((l) => [...l, ...s]), setAdding(false))} />
          ) : (
            <button className="btn wide" onClick={() => setAdding(true)}><Upload size={16} /> Add more</button>
          )}
          <div className="row mt" style={{ justifyContent: "flex-end" }}>
            {busy && <Spinner />}
            <button
              className="btn red grain"
              disabled={list.length < 2 || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setOut([{ name: `${list[0].name} + ${list.length - 1} more.pdf`, blob: await mergePdfs(list.map((l) => l.data)) }]);
                } catch (e) {
                  toast(`Couldn't merge: ${(e as Error).message}`, "bad");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FileStack size={16} /> Merge {list.length || ""}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- Pictures / camera to PDF ---------- */

function ToPdf({ camera, onClose }: { camera: boolean; onClose: () => void }) {
  const [imgs, setImgs] = useState<{ file: File; url: string }[]>([]);
  const [size, setSize] = useState<"a4" | "letter" | "fit">("a4");
  const [out, setOut] = useState<{ name: string; blob: Blob }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => imgs.forEach((i) => URL.revokeObjectURL(i.url)), [imgs]);
  const add = (files: File[]) => setImgs((l) => [...l, ...files.filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  return (
    <Modal label={camera ? "Scan to PDF" : "Pictures to PDF"} onClose={onClose} wide>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h2 className="title">{camera ? "Scan to PDF" : "Pictures to PDF"}</h2>
        <button className="btn sm icon ghost" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {out ? (
        <Result files={out} onDone={onClose} />
      ) : (
        <>
          {camera && <p className="meta" style={{ marginTop: 0 }}>Take one photo per page. Each new photo is added to the end.</p>}
          <div className="pages-grid" style={{ marginBottom: 14 }}>
            {imgs.map((im, i) => (
              <div key={im.url} className="pg">
                <span className="n">{i + 1}</span>
                <div className="canvas-box"><img src={im.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 4 }} /></div>
                <div className="acts">
                  <button className="btn sm icon ghost" aria-label="Move left" disabled={!i} onClick={() => setImgs((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><ArrowLeft size={14} /></button>
                  <button className="btn sm icon ghost" aria-label="Remove" onClick={() => setImgs((l) => l.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            <button className="pg" style={{ display: "grid", placeItems: "center", minHeight: 160, border: "1.5px dashed var(--stroke)", background: "none" }} onClick={() => input.current?.click()}>
              <span className="col" style={{ alignItems: "center", color: "var(--muted)" }}>
                {camera ? <Camera size={26} /> : <Images size={26} />}
                <b>{camera ? (imgs.length ? "Next page" : "Take a photo") : "Add pictures"}</b>
              </span>
            </button>
          </div>
          <input ref={input} type="file" accept="image/*" multiple={!camera} capture={camera ? "environment" : undefined} hidden onChange={(e) => (add([...(e.target.files ?? [])]), (e.target.value = ""))} />
          <div className="row wrap" style={{ justifyContent: "flex-end" }}>
            <span className="meta">Page size</span>
            <div className="seg">
              {(["a4", "letter", "fit"] as const).map((s) => <button key={s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s === "fit" ? "Fit picture" : s.toUpperCase()}</button>)}
            </div>
            <span className="grow" />
            {busy && <Spinner />}
            <button
              className="btn green grain"
              disabled={!imgs.length || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const name = camera ? `Scan ${new Date().toLocaleString().replace(/[/:,]/g, "-")}` : baseName(imgs[0].file.name);
                  setOut([{ name: `${name}.pdf`, blob: await imagesToPdf(imgs.map((i) => i.file), size, size === "fit" ? 0 : 24) }]);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Make PDF ({imgs.length} page{imgs.length === 1 ? "" : "s"})
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- Split, stamp, info, text: pick a PDF, set a few options, go ---------- */

function OneShot({ tool, onClose }: { tool: "split" | "watermark" | "numbers" | "info" | "text"; onClose: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [src, setSrc] = useState<Src | null>(null);
  const [pages, setPages] = useState(0);
  const [out, setOut] = useState<{ name: string; blob: Blob }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ranges, setRanges] = useState("");
  const [mark, setMark] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.18);
  const [numFmt, setNumFmt] = useState("{n} / {total}");
  const [info, setInfo] = useState({ title: "", author: "", subject: "" });
  const meta = TOOLS.find((t) => t.id === tool)!;

  const pick = async ([s]: Src[]) => {
    if (!s) return;
    const d = await openPdf(s.data);
    setPages(d.numPages);
    const m = (await d.getMetadata()).info as { Title?: string; Author?: string; Subject?: string };
    setInfo({ title: m.Title ?? s.name, author: m.Author ?? "", subject: m.Subject ?? "" });
    setRanges(d.numPages > 1 ? `1-${Math.ceil(d.numPages / 2)}, ${Math.ceil(d.numPages / 2) + 1}-` : "1");
    setSrc(s);
    if (tool === "text") {
      setBusy("Reading");
      const html = await pdfToHtml(d, (n, of) => setBusy(`Reading page ${n} of ${of}`));
      const it = await create({ kind: "doc", title: s.name, html, source: `${s.name}.pdf` });
      setBusy(null);
      onClose();
      app.open(it.id);
      toast("Text pulled out — edit away");
    }
  };

  const go = async () => {
    if (!src) return;
    setBusy("Working");
    try {
      if (tool === "split") {
        const parts = await splitPdf(src.data, ranges);
        if (!parts.length) return toast("Those ranges don't match any pages", "bad");
        setOut(parts.map((p) => ({ name: `${src.name} (${p.name}).pdf`, blob: p.blob })));
      } else if (tool === "watermark") setOut([{ name: `${src.name} (watermarked).pdf`, blob: await stampPdf(src.data, { watermark: mark, opacity }) }]);
      else if (tool === "numbers") setOut([{ name: `${src.name} (numbered).pdf`, blob: await stampPdf(src.data, { numbers: true, numberFormat: numFmt }) }]);
      else if (tool === "info") setOut([{ name: `${info.title || src.name}.pdf`, blob: await setPdfInfo(src.data, info) }]);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal label={meta.title} onClose={onClose}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h2 className="title">{meta.title}</h2>
        <button className="btn sm icon ghost" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {out ? (
        <Result files={out} onDone={onClose} />
      ) : !src ? (
        busy ? <div className="row"><Spinner /> {busy}…</div> : <PickPdf onPick={pick} />
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <div className="row card" style={{ padding: 12 }}>
            <FileBadge ext="pdf" size="sm" />
            <span className="grow clip"><b>{src.name}</b></span>
            <span className="meta">{pages} pages</span>
          </div>
          {tool === "split" && (
            <label className="col" style={{ gap: 6 }}>
              <span className="meta">Page ranges — each becomes its own PDF</span>
              <input className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 5, 8-" />
              <span className="chips">
                <button className="chip" onClick={() => setRanges(Array.from({ length: pages }, (_, i) => i + 1).join(", "))}>Every page</button>
                <button className="chip" onClick={() => setRanges(`1-${Math.ceil(pages / 2)}, ${Math.ceil(pages / 2) + 1}-`)}>In half</button>
                <button className="chip" onClick={() => setRanges(Array.from({ length: Math.ceil(pages / 2) }, (_, i) => `${i * 2 + 1}-${Math.min(i * 2 + 2, pages)}`).join(", "))}>Every 2 pages</button>
              </span>
            </label>
          )}
          {tool === "watermark" && (
            <>
              <input className="input" value={mark} onChange={(e) => setMark(e.target.value)} aria-label="Watermark text" />
              <span className="chips">{["DRAFT", "CONFIDENTIAL", "COPY", "SAMPLE", "PAID"].map((m) => <button key={m} className={`chip ${mark === m ? "on" : ""}`} onClick={() => setMark(m)}>{m}</button>)}</span>
              <label className="row"><span className="meta" style={{ width: 70 }}>Strength</span><input type="range" min={0.05} max={0.6} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--orange)" }} /></label>
            </>
          )}
          {tool === "numbers" && (
            <>
              <span className="chips">{["{n} / {total}", "{n}", "Page {n}", "Page {n} of {total}", "– {n} –"].map((f) => <button key={f} className={`chip ${numFmt === f ? "on" : ""}`} onClick={() => setNumFmt(f)}>{f.replace("{n}", "3").replace("{total}", String(pages || 9))}</button>)}</span>
            </>
          )}
          {tool === "info" && (
            <>
              <input className="input" placeholder="Title" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} />
              <input className="input" placeholder="Author" value={info.author} onChange={(e) => setInfo({ ...info, author: e.target.value })} />
              <input className="input" placeholder="Subject" value={info.subject} onChange={(e) => setInfo({ ...info, subject: e.target.value })} />
            </>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {busy && <Spinner />}
            <button className="btn orange grain" disabled={!!busy} onClick={go}>{meta.icon} {meta.title}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
