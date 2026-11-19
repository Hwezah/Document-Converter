import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, FilePlus2, FolderOpen, Home as HomeIcon, Library, Plus, Settings as Gear, Sheet, StickyNote, Layers, Upload, X } from "lucide-react";
import { create, getItem, load, patch, useItems, type Item } from "./lib/store";
import { ACCEPT, baseName, extOf } from "./lib/formats";
import { importFile } from "./lib/importers";
import { fromBase64, native } from "./lib/native";
import { Spinner, useMenu, useToast } from "./ui/kit";
import { Home } from "./views/Home";
import { Files } from "./views/Files";
import { Notes } from "./views/Notes";
import { Convert } from "./views/Convert";
import { Tools } from "./views/Tools";
import { Settings } from "./views/Settings";
import { Editor } from "./views/Editor";
import { PdfViewer } from "./views/PdfViewer";
import { ImageViewer } from "./views/ImageViewer";
import { SheetView } from "./views/SheetView";

export type View = "home" | "files" | "notes" | "convert" | "tools" | "settings";

interface AppApi {
  view: View;
  go: (v: View) => void;
  open: (id: string) => void;
  close: () => void;
  /** Brings files into the library and opens the first. */
  openFiles: (files: File[], opts?: { noOpen?: boolean }) => Promise<Item[]>;
  pickFiles: () => void;
  newDoc: (p?: Partial<Item>) => Promise<Item>;
  newNote: (p?: Partial<Item>) => Promise<Item>;
  newSheet: () => Promise<Item>;
  /** Files handed to the Convert page (from a viewer, the share sheet…). */
  queueConvert: (files: File[]) => void;
  takeConvertQueue: () => File[];
  createMenu: (e: React.MouseEvent) => void;
}
const Ctx = createContext<AppApi>(null as unknown as AppApi);
export const useApp = () => useContext(Ctx);

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon size={19} /> },
  { id: "files", label: "Library", icon: <Library size={19} /> },
  { id: "notes", label: "Notes", icon: <StickyNote size={19} /> },
  { id: "convert", label: "Convert", icon: <ArrowLeftRight size={19} /> },
  { id: "tools", label: "PDF tools", icon: <Layers size={19} /> },
  { id: "settings", label: "Settings", icon: <Gear size={19} /> },
];

export function App() {
  const items = useItems();
  const toast = useToast();
  const menu = useMenu();
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get("view") as View) || "home");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [update, setUpdate] = useState<{ state: "downloading" | "ready"; name: string; summary: string } | null>(null);
  const [hideUpdate, setHideUpdate] = useState(false);
  const convertQueue = useRef<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  // Back on Android (and the browser's back button) closes what's open, then returns Home.
  const go = useCallback((v: View) => {
    setOpenId(null);
    setView(v);
    history.pushState({ v }, "");
  }, []);
  const open = useCallback((id: string) => {
    setOpenId(id);
    history.pushState({ open: id }, "");
    patch(id, { opened: Date.now() }, false);
  }, []);
  const close = useCallback(() => {
    if (history.state?.open) history.back();
    else setOpenId(null);
  }, []);
  useEffect(() => {
    history.replaceState({ v: view }, "");
    const pop = (e: PopStateEvent) => {
      if (e.state?.open) setOpenId(e.state.open);
      else {
        setOpenId(null);
        if (e.state?.v) setView(e.state.v);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newDoc = useCallback(async (p: Partial<Item> = {}) => {
    const it = await create({ kind: "doc", title: "Untitled document", html: "", ...p });
    open(it.id);
    return it;
  }, [open]);
  const newNote = useCallback(async (p: Partial<Item> = {}) => {
    const it = await create({ kind: "note", title: "", html: "", ...p });
    if (view !== "notes") go("notes");
    setTimeout(() => window.dispatchEvent(new CustomEvent("folio:edit-note", { detail: it.id })), 30);
    return it;
  }, [go, view]);
  const newSheet = useCallback(async () => {
    const rows = Array.from({ length: 30 }, () => Array(8).fill(""));
    const it = await create({ kind: "sheet", title: "Untitled sheet", sheets: [{ name: "Sheet1", rows }] });
    open(it.id);
    return it;
  }, [open]);

  const openFiles = useCallback(async (files: File[], opts: { noOpen?: boolean } = {}) => {
    const made: Item[] = [];
    for (const f of files) {
      try {
        const r = await importFile(f, f.name);
        const common = { title: baseName(f.name), source: f.name, size: f.size, mime: f.type };
        const it =
          r.kind === "doc" ? await create({ kind: "doc", html: r.html, ...common, ext: extOf(f.name, f.type) }, f) :
          r.kind === "sheet" ? await create({ kind: "sheet", sheets: r.sheets, ...common, ext: extOf(f.name, f.type) }, f) :
          await create({ kind: "file", ext: r.ext, ...common }, f);
        made.push(it);
      } catch (e) {
        console.error(e);
        toast(`Couldn't open ${f.name}: ${(e as Error).message}`, "bad");
      }
    }
    if (made.length && !opts.noOpen) {
      if (made.length > 1) toast(`Added ${made.length} files to your library`);
      open(made[0].id);
    }
    return made;
  }, [open, toast]);

  const pickFiles = useCallback(() => picker.current?.click(), []);
  const queueConvert = useCallback((f: File[]) => {
    convertQueue.current.push(...f);
    go("convert");
  }, [go]);
  const takeConvertQueue = useCallback(() => convertQueue.current.splice(0), []);

  const createMenu = useCallback((e: React.MouseEvent) => menu.open(e, [
    { label: "New document", icon: <FilePlus2 size={17} />, run: () => newDoc() },
    { label: "Quick note", icon: <StickyNote size={17} />, run: () => newNote() },
    { label: "New spreadsheet", icon: <Sheet size={17} />, run: () => newSheet() },
    "sep",
    { label: "Open a file…", icon: <FolderOpen size={17} />, run: pickFiles },
    { label: "Convert files…", icon: <ArrowLeftRight size={17} />, run: () => go("convert") },
  ]), [menu, newDoc, newNote, newSheet, pickFiles, go]);

  // First load; then whatever the OS handed us: "Open with" (launchQueue), the share sheet (?share=n), shortcuts (?new=).
  useEffect(() => {
    load().then(async () => {
      setLoaded(true);
      const q = new URLSearchParams(location.search);
      const shared = Number(q.get("share") ?? 0);
      if (shared || q.get("text")) {
        const cache = await caches.open("folio-share");
        const files: File[] = [];
        for (let i = 0; i < shared; i++) {
          const r = await cache.match(new URL(`shared/${i}`, location.href).href);
          if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get("x-name") ?? `shared-${i}`), { type: r.headers.get("content-type") ?? "" }));
        }
        const t = await cache.match(new URL("shared/text", location.href).href);
        if (t) {
          const text = await t.text();
          const it = await create({ kind: "note", title: "Shared", html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`, tint: "orange" });
          toast("Saved what you shared as a note");
          if (!files.length) {
            setView("notes");
            setTimeout(() => window.dispatchEvent(new CustomEvent("folio:edit-note", { detail: it.id })), 50);
          }
        }
        for (const k of await cache.keys()) await cache.delete(k);
        if (files.length) await openFiles(files);
      }
      // Inside the Android app: files from "Open with" / "Share to Folio" arrive through these.
      if (native) {
        const w = window as unknown as { folioReceive?: unknown; folioReceiveText?: unknown; folioUpdate?: unknown };
        // The app found a new build: show the strip (and again if it was hidden for an older one).
        w.folioUpdate = (u: { state: string; name: string; summary: string }) => {
          if (u.state === "none") return setUpdate(null);
          setUpdate((prev) => {
            if (prev?.name !== u.name || u.state === "ready") setHideUpdate(false);
            return u as { state: "downloading" | "ready"; name: string; summary: string };
          });
        };
        w.folioReceive = (list: { name: string; type: string; data: string }[]) => openFiles(list.map((f) => fromBase64(f.data, f.name, f.type)));
        w.folioReceiveText = async (text: string) => {
          const it = await create({ kind: "note", title: "Shared", html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`, tint: "orange" });
          setView("notes");
          setTimeout(() => window.dispatchEvent(new CustomEvent("folio:edit-note", { detail: it.id })), 50);
        };
        native.ready();
      }
      const n = q.get("new");
      if (n === "doc") newDoc();
      else if (n === "note") newNote();
      else if (n === "sheet") newSheet();
      if (q.toString()) history.replaceState(history.state, "", location.pathname);
    });
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      await load();
      openFiles(files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop files anywhere. Paste files (or a screenshot) anywhere outside a text field.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => hasFiles(e) && (depth++, setDragging(true));
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && (depth = 0, setDragging(false));
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = 0;
      setDragging(false);
      if ((e.target as Element).closest?.("[data-dropzone]")) return; // a page's own drop zone takes it
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) openFiles(files);
    };
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        openFiles(files.map((f, i) => (f.name === "image.png" ? new File([f], `Pasted ${new Date().toLocaleString().replace(/[/:]/g, "-")}${i ? ` ${i}` : ""}.png`, { type: f.type }) : f)));
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [openFiles]);

  // Keyboard: Ctrl+O open, Ctrl+Alt+N new doc, Ctrl+Alt+M note.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickFiles();
      } else if (mod && e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newDoc();
      } else if (mod && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        newNote();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [pickFiles, newDoc, newNote]);

  const api = useMemo<AppApi>(
    () => ({ view, go, open, close, openFiles, pickFiles, newDoc, newNote, newSheet, queueConvert, takeConvertQueue, createMenu }),
    [view, go, open, close, openFiles, pickFiles, newDoc, newNote, newSheet, queueConvert, takeConvertQueue, createMenu],
  );

  const openItem = openId ? getItem(openId) ?? items.find((i) => i.id === openId) : undefined;
  const live = items.filter((i) => !i.trashed);
  const counts: Partial<Record<View, number>> = { files: live.filter((i) => i.kind !== "note").length, notes: live.filter((i) => i.kind === "note").length };

  let content: ReactNode;
  if (openItem) {
    content =
      openItem.kind === "doc" ? <Editor key={openItem.id} item={openItem} /> :
      openItem.kind === "sheet" ? <SheetView key={openItem.id} item={openItem} /> :
      openItem.ext === "pdf" ? <PdfViewer key={openItem.id} item={openItem} /> :
      <ImageViewer key={openItem.id} item={openItem} />;
  } else {
    const V = { home: Home, files: Files, notes: Notes, convert: Convert, tools: Tools, settings: Settings }[view] ?? Home;
    content = (
      <div className="page" key={view}>
        <div className="page-inner enter">{loaded ? <V /> : null}</div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={api}>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div>
            <div className="brand">
              <img src="./icons/icon.svg" alt="" />
              <b>Folio</b>
            </div>
            <button className="btn red wide newbtn" onClick={createMenu}>
              <Plus size={18} /> New
            </button>
            {NAV.map((n) => (
              <button key={n.id} className={`navbtn ${view === n.id && !openItem ? "on" : ""}`} onClick={() => go(n.id)} aria-current={view === n.id && !openItem ? "page" : undefined}>
                {n.icon}
                {n.label}
                {counts[n.id] ? <span className="count">{counts[n.id]}</span> : null}
                {view === n.id && !openItem && <span className="dot" />}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button className="navbtn" onClick={pickFiles}>
            <Upload size={19} /> Open a file
          </button>
          <p className="meta faint" style={{ padding: "8px 12px 0", fontSize: 11.5 }}>
            Everything stays on this device. <span className="kbd">Ctrl</span> <span className="kbd">O</span> opens a file.
          </p>
        </nav>

        <main className="main">
          {update && !hideUpdate && (
            <div className="update-strip glass" role="status">
              {update.state === "downloading" ? <Spinner /> : <span className="udot" />}
              <span className="grow clip">
                <b>{update.state === "ready" ? "Update ready" : "Downloading update…"}</b>
                <span className="meta"> · {update.name}{update.summary ? ` — ${update.summary}` : ""}</span>
              </span>
              {update.state === "ready" && <button className="btn sm red" onClick={() => native?.installUpdate()}>Install</button>}
              <button className="btn sm icon ghost" aria-label="Hide" onClick={() => setHideUpdate(true)}><X size={16} /></button>
            </div>
          )}
          {content}
        </main>

        {!openItem && (
          <nav className="tabbar glass" aria-label="Main">
            {/* Top row: the places. Bottom row: making, opening, tools and settings. */}
            {[NAV.filter((n) => ["home", "files", "notes", "convert"].includes(n.id)), null].map((row, r) => (
              <div className="tabrow" key={r}>
                {row ? (
                  row.map((n) => (
                    <button key={n.id} className={view === n.id ? "on" : ""} aria-label={n.label} title={n.label} aria-current={view === n.id ? "page" : undefined} onClick={() => go(n.id)}>
                      {n.icon}
                    </button>
                  ))
                ) : (
                  <>
                    <button aria-label="New" title="New" onClick={createMenu}><FilePlus2 /></button>
                    <button aria-label="Open a file" title="Open a file" onClick={pickFiles}><FolderOpen /></button>
                    <button className={view === "tools" ? "on" : ""} aria-label="PDF tools" title="PDF tools" aria-current={view === "tools" ? "page" : undefined} onClick={() => go("tools")}><Layers /></button>
                    <button className={view === "settings" ? "on" : ""} aria-label="Settings" title="Settings" aria-current={view === "settings" ? "page" : undefined} onClick={() => go("settings")}><Gear /></button>
                  </>
                )}
              </div>
            ))}
          </nav>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = "";
          if (f.length) openFiles(f);
        }}
      />
      {dragging && (
        <div className="dragover-all">
          <div className="box">
            <div className="ficon lg red">
              <Upload size={28} />
            </div>
            <h2 className="title">Drop to open</h2>
            <p className="meta">PDF, Word, OpenDocument, Markdown, text, eBooks, spreadsheets, pictures</p>
          </div>
        </div>
      )}
      {menu.el}
    </Ctx.Provider>
  );
}
