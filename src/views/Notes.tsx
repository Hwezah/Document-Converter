import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { Download, FileText, ListChecks, Pin, PinOff, Plus, Search, StickyNote, Trash2, Tag, X } from "lucide-react";
import { useApp } from "../app";
import { create, getItem, patch, remove, restore, useItems, type Item, type Tint } from "../lib/store";
import { ago } from "../lib/formats";
import { Toolbar, useRichEditor } from "../ui/rich";
import { Empty, Modal, usePrompt, useToast } from "../ui/kit";
import { ExportDialog } from "../ui/ExportDialog";

const TINTS: { id: Tint; label: string; color: string }[] = [
  { id: null, label: "None", color: "var(--surface2)" },
  { id: "red", label: "Red", color: "#b81d24" },
  { id: "orange", label: "Orange", color: "#e8590c" },
  { id: "green", label: "Green", color: "#1e9e52" },
  { id: "gold", label: "Gold", color: "#f5c518" },
];

export function Notes() {
  const all = useItems();
  const app = useApp();
  const [q, setQ] = useState("");
  const [tint, setTint] = useState<Tint | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [capture, setCapture] = useState("");

  useEffect(() => {
    const h = (e: Event) => setEditing((e as CustomEvent<string>).detail);
    window.addEventListener("folio:edit-note", h);
    return () => window.removeEventListener("folio:edit-note", h);
  }, []);

  const notes = useMemo(() => all.filter((i) => i.kind === "note" && !i.trashed), [all]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags ?? []))].sort(), [notes]);
  const shown = notes.filter((n) => {
    if (tint !== "all" && (n.tint ?? null) !== tint) return false;
    if (tag && !n.tags?.includes(tag)) return false;
    const needle = q.trim().toLowerCase();
    return !needle || (n.title + " " + (n.html ?? "").replace(/<[^>]+>/g, " ") + " " + (n.tags ?? []).join(" ")).toLowerCase().includes(needle);
  });
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);

  const quickAdd = async (checklist = false) => {
    const text = capture.trim();
    const html = checklist
      ? `<ul data-type="taskList">${(text ? text.split(/\s*[,;]\s*/) : [""]).map((t) => `<li data-type="taskItem" data-checked="false"><p>${t.replace(/</g, "&lt;")}</p></li>`).join("")}</ul>`
      : text ? `<p>${text.replace(/</g, "&lt;")}</p>` : "";
    // Clear the box now, not after saving, so typing straight on isn't wiped.
    setCapture("");
    const it = await create({ kind: "note", title: "", html, text, tint: tint === "all" ? null : tint, tags: tag ? [tag] : [] });
    if (!text || checklist) setEditing(it.id);
  };

  const card = (n: Item) => (
    <div key={n.id} className={`note ${n.tint ? "c-" + n.tint : ""}`} role="button" tabIndex={0} onClick={() => setEditing(n.id)} onKeyDown={(e) => e.key === "Enter" && setEditing(n.id)}>
      {n.pinned && <Pin size={14} className="pinned" fill="currentColor" />}
      {n.title && <h4 style={{ paddingRight: 18 }}>{n.title}</h4>}
      <div className="content" dangerouslySetInnerHTML={{ __html: n.html || '<p style="opacity:.5">Empty note</p>' }} />
      <div className="foot">
        {(n.tags ?? []).map((t) => <span key={t} className="badge">#{t}</span>)}
        <span className="grow" />
        <span className="meta faint" style={{ fontSize: 11.5 }}>{ago(n.updated)}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className="row between wrap">
        <div>
          <div className="overline">Notes</div>
          <h1 className="display" style={{ marginTop: 4 }}>Jot it down</h1>
        </div>
        <div className="search" style={{ width: "min(320px, 100%)" }}>
          <Search size={17} />
          <input className="input" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <form className="capture mt-lg row" onSubmit={(e) => (e.preventDefault(), quickAdd())}>
        <StickyNote size={19} style={{ marginLeft: 10, color: "var(--green)", flex: "none" }} />
        <input placeholder="Take a note…" value={capture} onChange={(e) => setCapture(e.target.value)} aria-label="Take a note" />
        <button type="button" className="btn sm icon ghost" title="New checklist (comma-separated items)" aria-label="New checklist" onClick={() => quickAdd(true)}><ListChecks size={18} /></button>
        <button type="submit" className="btn sm green" aria-label="Add note"><Plus size={16} /> Add</button>
      </form>

      <div className="row wrap" style={{ justifyContent: "center", marginBottom: 24, gap: 14 }}>
        <div className="swatches" role="group" aria-label="Filter by colour">
          <button className={`chip ${tint === "all" ? "on" : ""}`} style={{ height: 26 }} onClick={() => setTint("all")}>All</button>
          {TINTS.map((t) => (
            <button key={String(t.id)} className={`swatch ${tint === t.id ? "on" : ""}`} style={{ background: t.color }} title={t.label} aria-label={t.label} onClick={() => setTint(tint === t.id ? "all" : t.id)} />
          ))}
        </div>
        {tags.length > 0 && (
          <div className="chips">
            {tags.map((t) => <button key={t} className={`chip ${tag === t ? "on" : ""}`} style={{ height: 26 }} onClick={() => setTag(tag === t ? null : t)}>#{t}</button>)}
          </div>
        )}
      </div>

      {!shown.length ? (
        <Empty icon={<StickyNote size={28} />} tone="green" title={notes.length ? "No notes match" : "Your notes live here"} body={notes.length ? "Try another word or colour." : "Type above and press Enter. Checklists, colours, pins and tags make them easy to find again."} />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <div className="overline" style={{ margin: "0 0 10px" }}>Pinned</div>
              <div className="notes">{pinned.map(card)}</div>
              {rest.length > 0 && <div className="overline" style={{ margin: "18px 0 10px" }}>Others</div>}
            </>
          )}
          <div className="notes">{rest.map(card)}</div>
        </>
      )}

      {editing && getItem(editing) && <NoteEditor key={editing} id={editing} onClose={() => setEditing(null)} onOpenDoc={app.open} />}
    </>
  );
}

function NoteEditor({ id, onClose, onOpenDoc }: { id: string; onClose: () => void; onOpenDoc: (id: string) => void }) {
  const item = getItem(id)!;
  const toast = useToast();
  const prompt = usePrompt();
  const [title, setTitle] = useState(item.title);
  const [exporting, setExporting] = useState(false);
  const latest = useRef({ html: item.html ?? "", text: item.text ?? "" });
  const timer = useRef<number>(0);
  const [, rerender] = useState(0);

  const flush = () => {
    clearTimeout(timer.current);
    const cur = getItem(id);
    if (cur && (cur.html !== latest.current.html || cur.title !== title.trim())) patch(id, { html: latest.current.html, text: latest.current.text.slice(0, 400), title: title.trim() });
  };
  const editor = useRichEditor({
    html: item.html ?? "",
    placeholder: "Note",
    autofocus: true,
    onChange: (html, text) => {
      latest.current = { html, text };
      clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 500);
    },
  });

  const close = () => {
    flush();
    // An empty note isn't worth keeping.
    const cur = getItem(id);
    if (cur && !title.trim() && !latest.current.text.trim() && !/<img/.test(latest.current.html)) remove(id, true);
    onClose();
  };
  const cur = getItem(id) ?? item;

  return (
    <Modal label="Note" onClose={close} wide>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="ed-title"
          style={{ fontSize: 20 }}
          placeholder="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, 500);
          }}
        />
        <button className="btn sm icon ghost" aria-label={cur.pinned ? "Unpin" : "Pin"} title={cur.pinned ? "Unpin" : "Pin"} onClick={() => (patch(id, { pinned: !cur.pinned }, false), rerender((n) => n + 1))}>
          {cur.pinned ? <PinOff size={17} /> : <Pin size={17} />}
        </button>
        <button className="btn sm icon ghost" aria-label="Close" onClick={close}><X size={18} /></button>
      </div>
      {editor && (
        <>
          <div style={{ margin: "0 -22px" }}><Toolbar editor={editor} compact /></div>
          <div style={{ minHeight: 220, maxHeight: "50vh", overflowY: "auto", padding: "14px 4px" }}>
            <EditorContent editor={editor} />
          </div>
        </>
      )}
      <div className="row wrap" style={{ paddingTop: 14, gap: 12 }}>
        <div className="swatches" role="group" aria-label="Colour">
          {TINTS.map((t) => (
            <button key={String(t.id)} className={`swatch ${(cur.tint ?? null) === t.id ? "on" : ""}`} style={{ background: t.color }} aria-label={t.label} title={t.label} onClick={() => (patch(id, { tint: t.id }, false), rerender((n) => n + 1))} />
          ))}
        </div>
        <div className="chips">
          {(cur.tags ?? []).map((t) => (
            <button key={t} className="chip" style={{ height: 26 }} title="Remove tag" onClick={() => (patch(id, { tags: cur.tags!.filter((x) => x !== t) }, false), rerender((n) => n + 1))}>#{t} <X size={12} /></button>
          ))}
          <button
            className="chip"
            style={{ height: 26 }}
            onClick={async () => {
              const t = await prompt({ title: "Add a tag", placeholder: "e.g. work, ideas, shopping", ok: "Add" });
              const clean = t?.trim().replace(/^#/, "").toLowerCase();
              if (clean) {
                patch(id, { tags: [...new Set([...(cur.tags ?? []), clean])] }, false);
                rerender((n) => n + 1);
              }
            }}
          >
            <Tag size={12} /> Tag
          </button>
        </div>
        <span className="grow" />
        <span className="meta faint">Edited {ago(cur.updated)}</span>
        <button
          className="btn sm"
          title="Turn into a full document"
          onClick={async () => {
            flush();
            const doc = await create({ kind: "doc", title: title.trim() || "From a note", html: latest.current.html, text: latest.current.text.slice(0, 400) });
            onClose();
            onOpenDoc(doc.id);
          }}
        >
          <FileText size={15} /> <span className="hide-sm">To document</span>
        </button>
        <button className="btn sm" onClick={() => (flush(), setExporting(true))}><Download size={15} /> <span className="hide-sm">Export</span></button>
        <button
          className="btn sm icon danger"
          aria-label="Delete note"
          onClick={() => {
            remove(id);
            onClose();
            toast("Note moved to trash", "info", { label: "Undo", run: () => restore(id) });
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {exporting && <ExportDialog item={{ ...cur, title: title.trim(), html: latest.current.html }} onClose={() => setExporting(false)} />}
    </Modal>
  );
}
