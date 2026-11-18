import { useEffect, useMemo, useRef, useState } from "react";
import { TextLayer } from "pdfjs-dist";
import { ArrowLeft, ArrowLeftRight, Download, FilePen, LayoutGrid, Lock, Maximize, Minus, MoreVertical, Plus, Printer, RotateCw, Search, Share2, X } from "lucide-react";
import { useApp } from "../app";
import { create, getBlob, patch, type Item } from "../lib/store";
import { closePdf, openPdf, pdfToHtml, type PDFDocumentProxy } from "../lib/pdf";
import { shareOrDownload } from "../lib/exporters";
import { humanSize } from "../lib/formats";
import { ExportDialog } from "../ui/ExportDialog";
import { FileBadge, Spinner, useMenu, usePrompt, useToast } from "../ui/kit";

interface Size { w: number; h: number }

function Page({ doc, n, width, rotation, term }: { doc: PDFDocumentProxy; n: number; width: number; rotation: number; term: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const [hits, setHits] = useState<{ x: number; y: number; w: number; h: number }[]>([]);

  useEffect(() => {
    doc.getPage(n).then((p) => {
      const v = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      setSize({ w: v.width, h: v.height });
    });
  }, [doc, n, rotation]);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "800px 0px" });
    if (box.current) io.observe(box.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !size || !canvas.current) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const scale = width / size.w;
      const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const hi = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + rotation) % 360 });
      const c = canvas.current!;
      c.width = Math.floor(hi.width);
      c.height = Math.floor(hi.height);
      const r = page.render({ canvas: c, viewport: hi });
      task = r;
      try {
        await r.promise;
      } catch {
        return;
      }
      if (cancelled || !text.current) return;
      text.current.replaceChildren();
      text.current.style.setProperty("--total-scale-factor", String(scale));
      const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport: vp });
      await tl.render().catch(() => {});
      // Search hits: each matching run's box, narrowed to the matched part.
      if (term) {
        const tc = await page.getTextContent();
        const found: typeof hits = [];
        const needle = term.toLowerCase();
        for (const it of tc.items) {
          if (!("str" in it)) continue;
          const s = it.str.toLowerCase();
          for (let i = s.indexOf(needle); i >= 0; i = s.indexOf(needle, i + needle.length)) {
            const [, , , , e, f] = it.transform as number[];
            const x0 = e + (it.width * i) / s.length;
            const x1 = e + (it.width * (i + needle.length)) / s.length;
            const [a, b] = vp.convertToViewportPoint(x0, f - it.height * 0.2) as number[];
            const [cc, d] = vp.convertToViewportPoint(x1, f + it.height * 0.95) as number[];
            found.push({ x: Math.min(a, cc), y: Math.min(b, d), w: Math.abs(cc - a), h: Math.abs(d - b) });
          }
        }
        if (!cancelled) setHits(found);
      } else setHits([]);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, size, width, rotation, doc, n, term]);

  const h = size ? (width * size.h) / size.w : width * 1.294;
  return (
    <div className="pdf-page" ref={box} id={`pdfp-${n}`} data-page={n} style={{ width, height: h }}>
      <canvas ref={canvas} style={{ width, height: h }} />
      <div ref={text} className="textLayer" />
      {hits.map((r, i) => <span key={i} className="hl" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
      <span className="num">{n}</span>
    </div>
  );
}

export function PdfViewer({ item }: { item: Item }) {
  const app = useApp();
  const toast = useToast();
  const prompt = usePrompt();
  const menu = useMenu();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitW, setFitW] = useState(800);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState("");
  const [results, setResults] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const data = useRef<ArrayBuffer | null>(null);

  const load = async (password?: string) => {
    try {
      const b = await getBlob(item.id);
      if (!b) throw new Error("The file is missing");
      data.current = await b.arrayBuffer();
      const d = await openPdf(data.current, password);
      setDoc(d);
      setLocked(false);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "PasswordException") {
        setLocked(true);
        const pw = await prompt({ title: password ? "Wrong password — try again" : "This PDF is locked", placeholder: "Password", ok: "Unlock" });
        if (pw) load(pw);
      } else setError(err.message ?? "Couldn't open this PDF");
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  useEffect(() => () => closePdf(doc), [doc]);

  // Fit the page width to the window.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitW(Math.min(el.clientWidth - 32, 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  // Which page is in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const on = () => {
      const mid = el.scrollTop + el.clientHeight / 3;
      let best = 1;
      for (const p of el.querySelectorAll<HTMLElement>(".pdf-page")) if (p.offsetTop <= mid) best = Number(p.dataset.page);
      setPage(best);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [doc]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFinding(true);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(4, z + 0.25));
      } else if (mod && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.25, z - 0.25));
      } else if (mod && e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const width = Math.round(fitW * zoom);
  const goTo = (n: number) => document.getElementById(`pdfp-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const search = async () => {
    if (!doc) return;
    setApplied(term);
    if (!term.trim()) return setResults([]);
    const found: number[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      if (tc.items.map((i) => ("str" in i ? i.str : "")).join(" ").toLowerCase().includes(term.toLowerCase())) found.push(p);
    }
    setResults(found);
    if (found[0]) goTo(found[0]);
    else toast("Not found in this PDF", "info");
  };

  const toDoc = async () => {
    if (!doc) return;
    setBusy("Reading");
    try {
      const html = await pdfToHtml(doc, (n, of) => setBusy(`Reading page ${n} of ${of}`));
      const it = await create({ kind: "doc", title: item.title, html, source: `${item.title}.pdf` });
      app.open(it.id);
      toast("Now editable. The original PDF is still in your library.");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const toConvert = async () => {
    const b = await getBlob(item.id);
    if (b) app.queueConvert([new File([b], `${item.title}.pdf`, { type: "application/pdf" })]);
  };

  const print = async () => {
    const b = await getBlob(item.id);
    if (!b) return;
    const url = URL.createObjectURL(b);
    const f = Object.assign(document.createElement("iframe"), { src: url, style: "position:fixed;width:0;height:0;border:0" });
    document.body.append(f);
    f.onload = () => {
      f.contentWindow?.print();
      setTimeout(() => (f.remove(), URL.revokeObjectURL(url)), 60_000);
    };
  };

  const pages = useMemo(() => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []), [doc]);

  return (
    <div className="viewer">
      <div className="vbar glass">
        <button className="btn icon ghost" aria-label="Back" onClick={app.close}><ArrowLeft size={19} /></button>
        <FileBadge ext="pdf" size="sm" />
        <input className="ed-title" style={{ flex: 1 }} defaultValue={item.title} aria-label="Title" onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && patch(item.id, { title: e.target.value.trim() })} />
        {doc && (
          <>
            <span className="meta hide-sm" style={{ whiteSpace: "nowrap" }}>{page} / {doc.numPages}</span>
            <button className="btn sm icon ghost hide-sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}><Minus size={16} /></button>
            <button className="zoom btn sm ghost hide-sm" title="Fit width" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button className="btn sm icon ghost hide-sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><Plus size={16} /></button>
            <button className="btn sm icon ghost" aria-label="Search" onClick={() => setFinding((f) => !f)}><Search size={17} /></button>
            <button className="btn sm red" onClick={toDoc} disabled={!!busy}><FilePen size={15} /> <span className="hide-sm">Edit as document</span></button>
          </>
        )}
        <button
          className="btn sm icon ghost"
          aria-label="More"
          onClick={(e) =>
            menu.open(e, [
              { label: "Save as / convert…", icon: <Download size={16} />, run: () => setExporting(true) },
              { label: "Open in Convert", icon: <ArrowLeftRight size={16} />, run: toConvert },
              { label: "Organize pages", icon: <LayoutGrid size={16} />, run: () => app.go("tools") },
              { label: "Rotate view", icon: <RotateCw size={16} />, run: () => setRotation((r) => (r + 90) % 360) },
              { label: "Fit width", icon: <Maximize size={16} />, run: () => setZoom(1) },
              "sep",
              { label: "Share", icon: <Share2 size={16} />, run: async () => { const b = await getBlob(item.id); if (b) shareOrDownload(b, `${item.title}.pdf`); } },
              { label: "Print", icon: <Printer size={16} />, run: print },
            ])
          }
        >
          <MoreVertical size={18} />
        </button>
      </div>
      {finding && (
        <div className="findbar glass">
          <form className="row grow" onSubmit={(e) => (e.preventDefault(), search())}>
            <input className="input" autoFocus placeholder="Search this PDF" value={term} onChange={(e) => setTerm(e.target.value)} />
            <button className="btn sm orange" type="submit">Find</button>
          </form>
          <span className="meta">{applied ? (results.length ? `On ${results.length} page${results.length > 1 ? "s" : ""}` : "No match") : ""}</span>
          <button className="btn sm icon ghost" aria-label="Close search" onClick={() => (setFinding(false), setApplied(""), setResults([]))}><X size={16} /></button>
        </div>
      )}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((p) => <button key={p} className={`chip ${page === p ? "on" : ""}`} onClick={() => goTo(p)}>Page {p}</button>)}
        </div>
      )}
      <div className="pdf-pages" ref={scroller}>
        {error ? (
          <div className="empty"><h3 className="title">Couldn't open this PDF</h3><p className="body">{error}</p></div>
        ) : locked ? (
          <div className="empty">
            <div className="ficon lg orange"><Lock size={26} /></div>
            <h3 className="title">This PDF is password-protected</h3>
            <button className="btn orange mt" onClick={() => load()}>Enter password</button>
          </div>
        ) : !doc ? (
          <div className="loading"><Spinner /></div>
        ) : (
          pages.map((n) => <Page key={n} doc={doc} n={n} width={width} rotation={rotation} term={applied} />)
        )}
      </div>
      {busy && (
        <div className="toasts" style={{ bottom: 30 }}>
          <div className="toast"><Spinner /> {busy}…</div>
        </div>
      )}
      <div className="ed-status glass">
        <span>{doc ? `${doc.numPages} pages` : ""}</span>
        <span>{humanSize(item.size)}</span>
        {item.source && <span className="hide-sm clip">From {item.source}</span>}
      </div>
      {exporting && <ExportDialog item={item} onClose={() => setExporting(false)} />}
      {menu.el}
    </div>
  );
}
