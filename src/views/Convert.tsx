import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, Check, Download, FolderInput, Layers, RotateCcw, Trash2, Upload, X, AlertTriangle, Library } from "lucide-react";
import { useApp } from "../app";
import { ACCEPT, extOf, familyOf, fmt, humanSize, targetsFor } from "../lib/formats";
import { convertFile } from "../lib/convert";
import { download, zipFiles, type OutFile } from "../lib/exporters";
import { imagesToPdf, mergePdfs } from "../lib/pdf";
import { describe } from "../lib/itemio";
import { FileBadge, Spinner, useToast } from "../ui/kit";
import { pref, setPref } from "../lib/store";

interface Job {
  id: number;
  file: File;
  ext: string;
  target: string;
  state: "ready" | "working" | "done" | "failed";
  msg?: string;
  out?: OutFile[];
}

let seq = 0;

export function Convert() {
  const app = useApp();
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const [combine, setCombine] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (files: File[]) => {
    const last = pref<string>("convert.target", "pdf");
    setJobs((j) => [
      ...j,
      ...files.map((file) => {
        const ext = extOf(file.name, file.type);
        const t = targetsFor(ext);
        return { id: ++seq, file, ext, target: t.includes(last) ? last : t[0], state: "ready" as const };
      }),
    ]);
  };
  useEffect(() => {
    const q = app.takeConvertQueue();
    if (q.length) add(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTargets = useMemo(() => {
    const s = new Map<string, number>();
    for (const j of jobs) for (const t of targetsFor(j.ext)) s.set(t, (s.get(t) ?? 0) + 1);
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [jobs]);
  const setAll = (t: string) => {
    setPref("convert.target", t);
    setJobs((j) => j.map((x) => (targetsFor(x.ext).includes(t) ? { ...x, target: t, state: "ready", out: undefined } : x)));
  };
  const update = (id: number, p: Partial<Job>) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const canCombine = jobs.length > 1 && jobs.every((j) => (familyOf(j.ext) === "image" || j.ext === "pdf") && j.target === "pdf");
  const done = jobs.filter((j) => j.state === "done").flatMap((j) => j.out ?? []);

  const run = async () => {
    setRunning(true);
    try {
      if (canCombine && combine) {
        const ids = jobs.map((j) => j.id);
        setJobs((j) => j.map((x) => ({ ...x, state: "working", msg: "Combining" })));
        // Pictures become one PDF each, then everything is merged in order.
        const parts: ArrayBuffer[] = [];
        for (const j of jobs) parts.push(j.ext === "pdf" ? await j.file.arrayBuffer() : await (await imagesToPdf([j.file], "a4", 24)).arrayBuffer());
        const blob = await mergePdfs(parts);
        const out = [{ name: `Combined ${new Date().toISOString().slice(0, 10)}.pdf`, blob }];
        setJobs((j) => j.map((x) => (x.id === ids[0] ? { ...x, state: "done", out, msg: undefined } : { ...x, state: "done", out: [], msg: "In the combined PDF" })));
        download(blob, out[0].name);
        toast("Combined into one PDF");
        return;
      }
      let ok = 0;
      for (const j of jobs) {
        if (j.state === "done") continue;
        update(j.id, { state: "working", msg: "Starting" });
        try {
          const out = await convertFile(j.file, j.file.name, j.target, (msg) => update(j.id, { msg }));
          update(j.id, { state: "done", out, msg: undefined });
          ok++;
        } catch (e) {
          console.error(e);
          update(j.id, { state: "failed", msg: (e as Error).message || "Failed" });
        }
      }
      if (ok) toast(`Converted ${ok} file${ok > 1 ? "s" : ""}`);
    } finally {
      setRunning(false);
    }
  };

  const downloadAll = async () => {
    if (done.length === 1) return download(done[0].blob, done[0].name);
    download(await zipFiles(done), `Converted ${new Date().toISOString().slice(0, 10)}.zip`);
  };
  const toLibrary = async () => {
    const files = done.map((o) => new File([o.blob], o.name, { type: o.blob.type || fmt(extOf(o.name)).mime }));
    const made = await app.openFiles(files, { noOpen: true });
    toast(`Added ${made.length} to your library`, "good", { label: "Open", run: () => made[0] && app.open(made[0].id) });
  };

  return (
    <>
      <div className="row between wrap">
        <div>
          <div className="overline">Convert</div>
          <h1 className="display" style={{ marginTop: 4 }}>Any format to any format</h1>
          <p className="body" style={{ margin: "6px 0 0" }}>Converted right here on your device. Nothing is uploaded.</p>
        </div>
      </div>

      <div
        className={`drop mt-lg ${over ? "over" : ""}`}
        data-dropzone
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
      >
        <div className="ficon lg orange"><ArrowLeftRight size={26} /></div>
        <h3 className="title">Drop files to convert</h3>
        <p className="body" style={{ margin: "6px 0 14px" }}>Or pick several at once from your Downloads.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn orange" onClick={() => input.current?.click()}><Upload size={17} /> Choose files</button>
        </div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (add([...(e.target.files ?? [])]), (e.target.value = ""))} />
      </div>

      {jobs.length > 0 && (
        <>
          <div className="section-head">
            <h2 className="title">Convert {jobs.length > 1 ? "all " : ""}to</h2>
            <button className="btn sm ghost" onClick={() => setJobs([])}><X size={15} /> Clear</button>
          </div>
          <div className="formats">
            {allTargets.map((t) => {
              const d = describe(t);
              const on = jobs.every((j) => j.target === t || !targetsFor(j.ext).includes(t));
              return (
                <button key={t} className={`fmt ${on ? "on" : ""}`} onClick={() => setAll(t)}>
                  <span className="badge" style={{ background: `color-mix(in srgb, ${d.color} 18%, transparent)`, color: d.color }}>.{t}</span>
                  <span><b>{d.label}</b><br /><small>{d.note}</small></span>
                </button>
              );
            })}
          </div>

          {canCombine && (
            <label className="row card mt" style={{ padding: "12px 14px", cursor: "pointer" }}>
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} style={{ accentColor: "var(--orange)", width: 18, height: 18 }} />
              <Layers size={18} style={{ color: "var(--orange)" }} />
              <span className="grow"><b>Combine into one PDF</b><br /><span className="meta">In the order below</span></span>
            </label>
          )}

          <div className="list card mt queue">
            {jobs.map((j, idx) => (
              <div key={j.id} className="li" style={{ flexWrap: "wrap" }}>
                <FileBadge ext={j.ext} />
                <div className="grow" style={{ minWidth: 140 }}>
                  <div className="clip" style={{ fontWeight: 600 }}>{j.file.name}</div>
                  <div className="meta">
                    {fmt(j.ext).label} · {humanSize(j.file.size)}
                    {j.state === "working" && <> · {j.msg}…</>}
                    {j.state === "failed" && <span style={{ color: "var(--danger)" }}> · {j.msg}</span>}
                    {j.state === "done" && j.msg && <> · {j.msg}</>}
                  </div>
                  {j.state === "working" && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: "60%" }} /></div>}
                </div>
                <ArrowRight size={16} className="faint" />
                <select className="select" style={{ width: 110, height: 36 }} value={j.target} disabled={running} aria-label="Convert to" onChange={(e) => update(j.id, { target: e.target.value, state: "ready", out: undefined })}>
                  {targetsFor(j.ext).map((t) => <option key={t} value={t}>.{t}</option>)}
                </select>
                {j.state === "working" && <Spinner />}
                {j.state === "done" && (j.out?.length ? (
                  <button className="btn sm green" onClick={async () => (j.out!.length === 1 ? download(j.out![0].blob, j.out![0].name) : download(await zipFiles(j.out!), j.file.name.replace(/\.[^.]+$/, "") + ` (${j.target}).zip`))}>
                    <Download size={15} /> {j.out.length > 1 ? `${j.out.length} files` : "Save"}
                  </button>
                ) : <Check size={18} style={{ color: "var(--green)" }} />)}
                {j.state === "failed" && <AlertTriangle size={18} style={{ color: "var(--danger)" }} />}
                <div className="row" style={{ gap: 2 }}>
                  {idx > 0 && !running && (
                    <button className="btn sm icon ghost" aria-label="Move up" title="Move up" onClick={() => setJobs((l) => { const n = [...l]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n; })}>↑</button>
                  )}
                  {j.state === "failed" && <button className="btn sm icon ghost" aria-label="Retry" onClick={() => update(j.id, { state: "ready", msg: undefined })}><RotateCcw size={15} /></button>}
                  <button className="btn sm icon ghost" aria-label="Remove" disabled={running} onClick={() => setJobs((l) => l.filter((x) => x.id !== j.id))}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="row wrap mt" style={{ justifyContent: "flex-end" }}>
            {done.length > 0 && (
              <>
                <button className="btn" onClick={toLibrary}><Library size={16} /> Keep in library</button>
                <button className="btn green" onClick={downloadAll}><FolderInput size={16} /> Download {done.length > 1 ? `all (${done.length}) as ZIP` : "result"}</button>
              </>
            )}
            <button className="btn orange" disabled={running || jobs.every((j) => j.state === "done")} onClick={run}>
              {running ? <Spinner /> : <ArrowLeftRight size={17} />} {running ? "Converting" : canCombine && combine ? "Combine" : `Convert ${jobs.filter((j) => j.state !== "done").length}`}
            </button>
          </div>
        </>
      )}

      <div className="section-head"><h2 className="title">What converts to what</h2></div>
      <div className="fmap">
        {[
          ["Documents", "Word, OpenDocument, RTF, Markdown, text, web pages, eBooks", "docx"],
          ["PDF", "Any PDF, text rebuilt as editable", "pdf"],
          ["Slides", "PowerPoint (text only)", "pptx"],
          ["Spreadsheets", "Excel, Calc, CSV, TSV, JSON", "xlsx"],
          ["Pictures", "PNG, JPEG, WebP, GIF, BMP, SVG", "bmp"],
        ].map(([name, from, ext]) => (
          <div key={ext} className="card fmap-group">
            <div className="fmap-name">{name}</div>
            <div className="fmap-from">{from}</div>
            <div className="fmap-to">
              {(ext === "docx" ? ["docx", ...targetsFor(ext)] : targetsFor(ext)).map((t) => <span key={t} className="badge">.{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
