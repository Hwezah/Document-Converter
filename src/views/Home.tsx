import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, FilePlus2, FolderOpen, StickyNote, Upload, Wrench, Sheet as SheetIcon, ScanLine } from "lucide-react";
import { useApp } from "../app";
import { useItems, type Item } from "../lib/store";
import { DocCard, useItemActions } from "../ui/Cards";
import { ExportDialog } from "../ui/ExportDialog";
import { Empty, useMenu } from "../ui/kit";
import { humanSize } from "../lib/formats";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Home() {
  const app = useApp();
  const items = useItems().filter((i) => !i.trashed);
  const menu = useMenu();
  const actions = useItemActions();
  const [exporting, setExporting] = useState<Item | null>(null);
  const [usage, setUsage] = useState<string>("");

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(humanSize(e.usage)));
  }, [items.length]);

  const docs = items.filter((i) => i.kind !== "note");
  const recent = [...docs].sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 8);
  const pinned = docs.filter((i) => i.pinned);
  const notes = items.filter((i) => i.kind === "note").slice(0, 4);
  const onMenu = (e: React.MouseEvent, i: Item) => menu.open(e, actions(i, setExporting));

  return (
    <>
      <div className="greet">
        <div>
          <div className="overline">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="hero" style={{ marginTop: 6 }}>{greeting()}.</h1>
          <p className="body" style={{ margin: "6px 0 0" }}>Open, write, convert. Everything stays on this device.</p>
        </div>
      </div>

      <div className="quick">
        <button className="qtile fill red" onClick={() => app.newDoc()}>
          <span className="ficon"><FilePlus2 size={22} /></span>
          <span><b>New document</b><small>Write, format, export anywhere</small></span>
        </button>
        <button className="qtile" onClick={app.pickFiles}>
          <span className="ficon"><FolderOpen size={22} /></span>
          <span><b>Open a file</b><small>From Downloads or anywhere</small></span>
        </button>
        <button className="qtile fill orange" onClick={() => app.go("convert")}>
          <span className="ficon"><ArrowLeftRight size={22} /></span>
          <span><b>Convert</b><small>PDF, Word, Markdown, Excel…</small></span>
        </button>
        <button className="qtile fill green" onClick={() => app.newNote()}>
          <span className="ficon"><StickyNote size={22} /></span>
          <span><b>Quick note</b><small>Jot it down, sort it later</small></span>
        </button>
      </div>

      <div className="chips mt">
        <button className="chip" onClick={() => app.newSheet()}><SheetIcon size={15} /> New spreadsheet</button>
        <button className="chip" onClick={() => app.go("tools")}><ScanLine size={15} /> Scan to PDF</button>
        <button className="chip" onClick={() => app.go("tools")}><Wrench size={15} /> Merge PDFs</button>
        <button className="chip" onClick={() => app.go("tools")}><Wrench size={15} /> Split, rotate, reorder pages</button>
      </div>

      {pinned.length > 0 && (
        <>
          <div className="section-head"><h2 className="title">Pinned</h2></div>
          <div className="grid-docs">{pinned.map((i) => <DocCard key={i.id} item={i} onMenu={onMenu} />)}</div>
        </>
      )}

      <div className="section-head">
        <h2 className="title">Recent</h2>
        {docs.length > recent.length && <button className="btn sm ghost" onClick={() => app.go("files")}>All {docs.length} <ArrowRight size={15} /></button>}
      </div>
      {recent.length ? (
        <div className="grid-docs">{recent.map((i) => <DocCard key={i.id} item={i} onMenu={onMenu} />)}</div>
      ) : (
        <div className="drop" onClick={app.pickFiles} style={{ cursor: "pointer" }}>
          <div className="ficon lg red"><Upload size={26} /></div>
          <h3 className="title">Open your first document</h3>
          <p className="body" style={{ margin: "6px 0 0" }}>Drop a file here, paste one, or tap to pick from your Downloads.</p>
          <p className="meta faint" style={{ marginTop: 10 }}>PDF · DOCX · ODT · RTF · MD · TXT · HTML · EPUB · PPTX · XLSX · CSV · images</p>
        </div>
      )}

      <div className="section-head">
        <h2 className="title">Notes</h2>
        <button className="btn sm ghost" onClick={() => app.go("notes")}>All notes <ArrowRight size={15} /></button>
      </div>
      {notes.length ? (
        <div className="notes" style={{ columns: "4 200px" }}>
          {notes.map((n) => (
            <div
              key={n.id}
              className={`note ${n.tint ? "c-" + n.tint : ""}`}
              onClick={() => {
                app.go("notes");
                setTimeout(() => window.dispatchEvent(new CustomEvent("folio:edit-note", { detail: n.id })), 30);
              }}
            >
              {n.title && <h4>{n.title}</h4>}
              <div className="content" style={{ maxHeight: 110 }} dangerouslySetInnerHTML={{ __html: n.html || "<p>Empty note</p>" }} />
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<StickyNote size={28} />} tone="green" title="No notes yet" body="Ideas, lists, things to remember. Colour them, pin them, tick them off.">
          <button className="btn green" onClick={() => app.newNote()}>Take a note</button>
        </Empty>
      )}

      <p className="meta faint" style={{ textAlign: "center", marginTop: 40 }}>
        {docs.length} files · {items.length - docs.length} notes{usage ? ` · ${usage} on this device` : ""}
      </p>

      {exporting && <ExportDialog item={exporting} onClose={() => setExporting(null)} />}
      {menu.el}
    </>
  );
}
