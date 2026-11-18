import { useMemo, useState } from "react";
import { CheckSquare, LayoutGrid, List, MoreHorizontal, Search, Trash2, Upload, X, Library, Archive } from "lucide-react";
import { useApp } from "../app";
import { remove, useItems, getBlob, type Item } from "../lib/store";
import { ago, familyOf, humanSize } from "../lib/formats";
import { DocCard, useItemActions } from "../ui/Cards";
import { ExportDialog } from "../ui/ExportDialog";
import { Choice, Empty, ItemIcon, kindLabel, useConfirm, useMenu, useToast } from "../ui/kit";
import { pref, setPref } from "../lib/store";
import { download, zipFiles } from "../lib/exporters";
import { exportItem } from "../lib/itemio";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "doc", label: "Documents" },
  { id: "pdf", label: "PDFs" },
  { id: "sheet", label: "Sheets" },
  { id: "image", label: "Pictures" },
  { id: "trash", label: "Trash" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];
type Sort = "recent" | "name" | "size" | "created";

export function Files() {
  const app = useApp();
  const all = useItems();
  const menu = useMenu();
  const actions = useItemActions();
  const confirm = useConfirm();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(() => pref("files.sort", "recent"));
  const [layout, setLayout] = useState<"grid" | "list">(() => pref("files.layout", "grid"));
  const [exporting, setExporting] = useState<Item | null>(null);
  const [sel, setSel] = useState<Set<string> | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = all.filter((i) => i.kind !== "note" && (filter === "trash" ? i.trashed : !i.trashed));
    if (filter === "doc") l = l.filter((i) => i.kind === "doc");
    if (filter === "pdf") l = l.filter((i) => i.ext === "pdf" && i.kind === "file");
    if (filter === "sheet") l = l.filter((i) => i.kind === "sheet");
    if (filter === "image") l = l.filter((i) => i.kind === "file" && familyOf(i.ext ?? "") === "image");
    if (needle) l = l.filter((i) => (i.title + " " + (i.source ?? "") + " " + (i.html ?? "").replace(/<[^>]+>/g, " ")).toLowerCase().includes(needle));
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      recent: (a, b) => b.updated - a.updated,
      name: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
      size: (a, b) => (b.size ?? (b.html?.length ?? 0)) - (a.size ?? (a.html?.length ?? 0)),
      created: (a, b) => b.created - a.created,
    };
    return [...l].sort(by[sort]).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [all, q, filter, sort]);

  const onMenu = (e: React.MouseEvent, i: Item) => {
    if (sel) {
      e.preventDefault();
      e.stopPropagation();
      toggle(i.id);
      return;
    }
    menu.open(e, actions(i, setExporting));
  };
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const zipSelected = async () => {
    const chosen = list.filter((i) => sel?.has(i.id));
    const files = [];
    for (const i of chosen) {
      if (i.kind === "file") {
        const b = await getBlob(i.id);
        if (b) files.push({ name: `${i.title}.${i.ext}`, blob: b });
      } else files.push(...(await exportItem(i, i.kind === "sheet" ? "xlsx" : "docx")));
    }
    download(await zipFiles(files), `Folio ${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`Zipped ${files.length} files`);
    setSel(null);
  };

  return (
    <>
      <div className="row between wrap">
        <div>
          <div className="overline">Library</div>
          <h1 className="display" style={{ marginTop: 4 }}>Your files</h1>
        </div>
        <div className="row">
          {sel ? (
            <>
              <span className="meta">{sel.size} selected</span>
              <button className="btn sm" disabled={!sel.size} onClick={zipSelected}><Archive size={15} /> ZIP</button>
              <button
                className="btn sm danger"
                disabled={!sel.size}
                onClick={async () => {
                  const forever = filter === "trash";
                  if (forever && !(await confirm({ title: `Delete ${sel.size} forever?`, ok: "Delete", danger: true }))) return;
                  for (const id of sel) await remove(id, forever);
                  toast(forever ? "Deleted" : "Moved to trash");
                  setSel(null);
                }}
              >
                <Trash2 size={15} /> {filter === "trash" ? "Delete" : "Trash"}
              </button>
              <button className="btn sm icon" aria-label="Done" onClick={() => setSel(null)}><X size={16} /></button>
            </>
          ) : (
            <>
              <button className="btn sm" onClick={() => setSel(new Set())}><CheckSquare size={15} /> Select</button>
              <button className="btn sm red" onClick={app.pickFiles}><Upload size={15} /> Open</button>
            </>
          )}
        </div>
      </div>

      <div className="row wrap mt" style={{ gap: 12 }}>
        <div className="search grow" style={{ minWidth: 220 }}>
          <Search size={17} />
          <input className="input" placeholder="Search titles and contents" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 150 }} value={sort} onChange={(e) => (setSort(e.target.value as Sort), setPref("files.sort", e.target.value))} aria-label="Sort">
          <option value="recent">Last edited</option>
          <option value="created">Newest</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
        <Choice
          label="Layout"
          value={layout}
          onChange={(v) => (setLayout(v), setPref("files.layout", v))}
          options={[{ value: "grid", label: <><LayoutGrid size={15} /> Grid</> }, { value: "list", label: <><List size={15} /> List</> }]}
        />
      </div>
      <div className="mt">
        <Choice label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.id, label: f.label }))} />
      </div>

      <div className="mt-lg">
        {!list.length ? (
          filter === "trash" ? (
            <Empty icon={<Trash2 size={28} />} tone="orange" title="Trash is empty" body="Deleted files wait here for 30 days." />
          ) : (
            <Empty icon={<Library size={28} />} title={q ? "Nothing matches" : "Nothing here yet"} body={q ? "Try another word." : "Open a file from your Downloads, or create something new."}>
              {!q && <button className="btn red" onClick={app.pickFiles}><Upload size={16} /> Open a file</button>}
            </Empty>
          )
        ) : layout === "grid" ? (
          <div className="grid-docs">
            {list.map((i) => (
              <div key={i.id} className={sel?.has(i.id) ? "picked" : undefined} onClickCapture={(e) => sel && (e.stopPropagation(), toggle(i.id))}>
                <DocCard item={i} onMenu={onMenu} />
              </div>
            ))}
          </div>
        ) : (
          <div className="list card">
            {list.map((i) => (
              <div
                key={i.id}
                className={`li ${sel?.has(i.id) ? "sel" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => (sel ? toggle(i.id) : !i.trashed && app.open(i.id))}
                onContextMenu={(e) => onMenu(e, i)}
              >
                {sel && <input type="checkbox" readOnly checked={sel.has(i.id)} style={{ accentColor: "var(--orange)" }} />}
                <ItemIcon item={i} />
                <div className="grow">
                  <div className="clip" style={{ fontWeight: 600 }}>{i.title || "Untitled"}</div>
                  <div className="meta clip">{kindLabel(i)}{i.source ? ` · from ${i.source}` : ""}</div>
                </div>
                <span className="meta" style={{ whiteSpace: "nowrap" }}>{humanSize(i.size)}</span>
                <span className="meta" style={{ whiteSpace: "nowrap", minWidth: 80, textAlign: "right" }}>{ago(i.updated)}</span>
                <button className="btn sm icon ghost" aria-label="More" onClick={(e) => onMenu(e, i)}><MoreHorizontal size={17} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {exporting && <ExportDialog item={exporting} onClose={() => setExporting(null)} />}
      {menu.el}
    </>
  );
}
