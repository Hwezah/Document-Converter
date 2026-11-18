import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import {
  ArrowLeft, CaseSensitive, ChevronDown, ChevronUp, Copy, Download, Eye, FileText, ListTree, Maximize2, MoreVertical, Pin, Printer,
  Search, Share2, Trash2, X, Calendar, BookOpen,
} from "lucide-react";
import { useApp } from "../app";
import { duplicate, patch, remove, restore, type Item } from "../lib/store";
import { pref, setPref } from "../lib/store";
import { ago } from "../lib/formats";
import { exportItem } from "../lib/itemio";
import { shareOrDownload } from "../lib/exporters";
import { ExportDialog } from "../ui/ExportDialog";
import { replaceHits, setFind, TEMPLATES, Toolbar, useRichEditor, findKey } from "../ui/rich";
import { useMenu, useToast } from "../ui/kit";

export function Editor({ item }: { item: Item }) {
  const app = useApp();
  const toast = useToast();
  const menu = useMenu();
  const [title, setTitle] = useState(item.title);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(item.updated);
  const [exporting, setExporting] = useState(false);
  const [paper, setPaper] = useState<boolean>(() => pref("editor.paper", true));
  const [focus, setFocus] = useState(false);
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState("");
  const [rep, setRep] = useState("");
  const [cs, setCs] = useState(false);
  const [empty, setEmpty] = useState(!item.html || item.html === "<p></p>");
  const pending = useRef<{ html: string; text: string } | null>(null);
  const timer = useRef<number>(0);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    await patch(item.id, { html: p.html, text: p.text.slice(0, 400) });
    setDirty(false);
    setSavedAt(Date.now());
  }, [item.id]);

  const editor = useRichEditor({
    html: item.html ?? "",
    placeholder: "Start writing, or paste anything…",
    autofocus: !item.html,
    onChange: (html, text) => {
      pending.current = { html, text };
      setDirty(true);
      setEmpty(!text.trim() && !/<(img|table|hr)/.test(html));
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
  });

  // Save on the way out, and when the tab is hidden (phones kill background tabs).
  useEffect(() => {
    const vis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      flush();
    };
  }, [flush]);

  const saveTitle = () => title.trim() !== item.title && patch(item.id, { title: title.trim() || "Untitled document" });

  const runFind = (p: { term?: string; cur?: number; caseSensitive?: boolean }) => editor && setFind(editor, p);
  const st = editor ? findKey.getState(editor.state) : undefined;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFinding(true);
        setTimeout(() => document.getElementById("find-input")?.focus());
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flush().then(() => toast("Saved"));
        if (e.shiftKey) setExporting(true);
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.querySelector('[title="Link (Ctrl+K)"]') as HTMLButtonElement)?.click();
      } else if (e.key === "Escape" && finding) {
        setFinding(false);
        runFind({ term: "" });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, finding, editor]);

  if (!editor) return null;
  const words = editor.storage.characterCount.words() as number;
  const chars = editor.storage.characterCount.characters() as number;

  const insertToc = () => {
    const heads: { level: number; text: string }[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "heading" && n.textContent.trim()) heads.push({ level: n.attrs.level, text: n.textContent });
    });
    if (!heads.length) return toast("Add some headings first", "info");
    const min = Math.min(...heads.map((h) => h.level));
    const html = `<h2>Contents</h2><ul>${heads.map((h) => `<li><p>${" ".repeat(h.level - min)}${h.text.replace(/</g, "&lt;")}</p></li>`).join("")}</ul>`;
    editor.chain().focus().insertContent(html).run();
  };

  const share = async () => {
    await flush();
    const [f] = await exportItem({ ...item, title, html: editor.getHTML() }, pref<string>("export.doc", "pdf") || "pdf");
    const r = await shareOrDownload(f.blob, f.name);
    if (r === "downloaded") toast(`Saved ${f.name}`);
  };

  const more = (e: React.MouseEvent) =>
    menu.open(e, [
      { label: paper ? "Continuous view" : "Page view", icon: <BookOpen size={16} />, run: () => (setPaper(!paper), setPref("editor.paper", !paper)) },
      { label: "Focus mode", icon: <Maximize2 size={16} />, run: () => setFocus(!focus) },
      { label: "Find & replace", icon: <Search size={16} />, run: () => setFinding(true) },
      "sep",
      { label: "Insert table of contents", icon: <ListTree size={16} />, run: insertToc },
      { label: "Insert today's date", icon: <Calendar size={16} />, run: () => editor.chain().focus().insertContent(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })).run() },
      "sep",
      { label: "Save as…", icon: <Download size={16} />, run: () => flush().then(() => setExporting(true)) },
      { label: "Print", icon: <Printer size={16} />, run: () => window.print() },
      { label: item.pinned ? "Unpin" : "Pin", icon: <Pin size={16} />, run: () => patch(item.id, { pinned: !item.pinned }, false) },
      { label: "Duplicate", icon: <Copy size={16} />, run: () => flush().then(() => duplicate(item.id)).then((d) => d && app.open(d.id)) },
      "sep",
      {
        label: "Move to trash",
        icon: <Trash2 size={16} />,
        danger: true,
        run: async () => {
          await flush();
          await remove(item.id);
          app.close();
          toast("Moved to trash", "info", { label: "Undo", run: () => restore(item.id) });
        },
      },
    ]);

  return (
    <div className={`editor-wrap ${focus ? "focus-mode" : ""}`}>
      <div className="ed-top glass">
        <button className="btn icon ghost" aria-label="Back" onClick={() => flush().then(app.close)}><ArrowLeft size={19} /></button>
        <span className="ficon sm red"><FileText size={15} /></span>
        <input className="ed-title" value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <span className={`saved ${dirty ? "dirty" : ""}`} title={dirty ? "Saving…" : "Saved on this device"}>
          <span className="dot" /> <span className="hide-sm">{dirty ? "Saving" : `Saved ${ago(savedAt)}`}</span>
        </span>
        <button className="btn sm icon ghost" aria-label="Find" title="Find (Ctrl+F)" onClick={() => setFinding((f) => !f)}><Search size={17} /></button>
        {("share" in navigator || "FolioAndroid" in window) && <button className="btn sm icon ghost" aria-label="Share" onClick={share}><Share2 size={17} /></button>}
        <button className="btn sm orange" onClick={() => flush().then(() => setExporting(true))}><Download size={15} /> <span>Export</span></button>
        <button className="btn sm icon ghost" aria-label="More" onClick={more}><MoreVertical size={18} /></button>
      </div>
      <Toolbar editor={editor} />
      {finding && (
        <div className="findbar glass">
          <input
            id="find-input"
            className="input"
            placeholder="Find"
            value={term}
            autoFocus
            onChange={(e) => {
              setTerm(e.target.value);
              runFind({ term: e.target.value, cur: 0 });
            }}
            onKeyDown={(e) => e.key === "Enter" && runFind({ cur: (st?.cur ?? 0) + (e.shiftKey ? -1 : 1) })}
          />
          <span className="meta" style={{ minWidth: 54 }}>{st?.hits.length ? `${st.cur + 1} of ${st.hits.length}` : term ? "No match" : ""}</span>
          <button className="btn sm icon" aria-label="Previous" onClick={() => runFind({ cur: (st?.cur ?? 0) - 1 })}><ChevronUp size={16} /></button>
          <button className="btn sm icon" aria-label="Next" onClick={() => runFind({ cur: (st?.cur ?? 0) + 1 })}><ChevronDown size={16} /></button>
          <button className={`btn sm icon ${cs ? "orange" : ""}`} aria-label="Match case" title="Match case" onClick={() => (setCs(!cs), runFind({ caseSensitive: !cs }))}><CaseSensitive size={17} /></button>
          <input className="input" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} />
          <button className="btn sm" disabled={!st?.hits.length} onClick={() => replaceHits(editor, rep, false)}>Replace</button>
          <button className="btn sm" disabled={!st?.hits.length} onClick={() => toast(`Replaced ${replaceHits(editor, rep, true)}`)}>All</button>
          <button className="btn sm icon ghost" aria-label="Close find" onClick={() => (setFinding(false), runFind({ term: "" }))}><X size={16} /></button>
        </div>
      )}
      <div className="ed-scroll" onClick={(e) => e.target === e.currentTarget && editor.commands.focus("end")}>
        <div className={`paper ${paper ? "" : "fluid"}`}>
          {empty && (
            <div className="chips" style={{ marginBottom: 20, flexWrap: "wrap" }}>
              <span className="meta" style={{ alignSelf: "center" }}>Start from:</span>
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  className="chip"
                  onClick={() => {
                    editor.commands.setContent(t.html(), { emitUpdate: true });
                    if (title.startsWith("Untitled")) {
                      setTitle(t.title);
                      patch(item.id, { title: t.title });
                    }
                    editor.commands.focus("start");
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="ed-status glass">
        <span>{words.toLocaleString()} words</span>
        <span>{chars.toLocaleString()} characters</span>
        <span className="hide-sm">{Math.max(1, Math.round(words / 230))} min read</span>
        {item.source && <span className="hide-sm clip">From {item.source}</span>}
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => setFocus(!focus)}><Eye size={14} /> {focus ? "Exit focus" : "Focus"}</button>
      </div>
      {exporting && <ExportDialog item={{ ...item, title, html: editor.getHTML() }} onClose={() => setExporting(false)} />}
      {menu.el}
    </div>
  );
}
