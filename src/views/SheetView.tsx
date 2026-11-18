import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowLeft, ArrowUpAZ, Columns3, Download, MoreVertical, Plus, Rows3, Search, Trash2 } from "lucide-react";
import { useApp } from "../app";
import { patch, type Item, type SheetData } from "../lib/store";
import { ago } from "../lib/formats";
import { ExportDialog } from "../ui/ExportDialog";
import { useMenu, usePrompt, useConfirm } from "../ui/kit";

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const num = (s: string) => {
  const t = s.replace(/[,\s$€£%]/g, "");
  return t !== "" && !isNaN(Number(t)) ? Number(t) : null;
};

export function SheetView({ item }: { item: Item }) {
  const app = useApp();
  const menu = useMenu();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [sheets, setSheets] = useState<SheetData[]>(() => item.sheets?.length ? item.sheets : [{ name: "Sheet1", rows: [[""]] }]);
  const [tab, setTab] = useState(0);
  const [title, setTitle] = useState(item.title);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState("");
  const [savedAt, setSavedAt] = useState(item.updated);
  const timer = useRef<number>(0);
  const latest = useRef(sheets);
  const dirty = useRef(false);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    patch(item.id, { sheets: latest.current }).then(() => setSavedAt(Date.now()));
  }, [item.id]);
  const commit = (next: SheetData[]) => {
    latest.current = next;
    dirty.current = true;
    setSheets(next);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 500);
  };
  useEffect(() => () => save(), [save]);

  const s = sheets[tab] ?? sheets[0];
  const cols = Math.max(1, ...s.rows.map((r) => r.length));
  const setRows = (rows: string[][]) => commit(sheets.map((x, i) => (i === tab ? { ...x, rows } : x)));
  const setCell = (r: number, c: number, v: string) => {
    const rows = s.rows.map((row) => [...row]);
    while (rows.length <= r) rows.push([]);
    while (rows[r].length <= c) rows[r].push("");
    rows[r][c] = v;
    setRows(rows);
  };

  const visible = useMemo(() => {
    const idx = s.rows.map((_, i) => i);
    if (!filter.trim()) return idx;
    const f = filter.toLowerCase();
    return idx.filter((i) => i === 0 || s.rows[i].some((c) => c.toLowerCase().includes(f)));
  }, [s.rows, filter]);

  const stats = useMemo(() => {
    if (!focus) return null;
    const vals = s.rows.slice(1).map((r) => num(r[focus.c] ?? "")).filter((v): v is number => v != null);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return { sum, avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals), count: vals.length };
  }, [focus, s.rows]);

  const sortBy = (c: number, dir: 1 | -1) => {
    const [head, ...body] = s.rows;
    body.sort((a, b) => {
      const x = a[c] ?? "", y = b[c] ?? "";
      const nx = num(x), ny = num(y);
      return dir * (nx != null && ny != null ? nx - ny : x.localeCompare(y, undefined, { numeric: true }));
    });
    setRows([head, ...body]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const el = document.getElementById(`cell-${r + dr}-${c + dc}`) as HTMLInputElement | null;
      if (el) el.focus();
      else if (dr > 0) {
        setRows([...s.rows, Array(cols).fill("")]);
        setTimeout(() => document.getElementById(`cell-${r + dr}-${c}`)?.focus());
      }
    };
    if (e.key === "Enter" || e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "Tab") move(0, e.shiftKey ? -1 : 1);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) move(0, 1);
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) move(0, -1);
  };

  const colMenu = (e: React.MouseEvent, c: number) =>
    menu.open(e, [
      { label: "Sort A → Z", icon: <ArrowDownAZ size={16} />, run: () => sortBy(c, 1) },
      { label: "Sort Z → A", icon: <ArrowUpAZ size={16} />, run: () => sortBy(c, -1) },
      "sep",
      { label: "Insert column left", icon: <Columns3 size={16} />, run: () => setRows(s.rows.map((r) => [...r.slice(0, c), "", ...r.slice(c)])) },
      { label: "Insert column right", icon: <Columns3 size={16} />, run: () => setRows(s.rows.map((r) => [...r.slice(0, c + 1), "", ...r.slice(c + 1)])) },
      { label: "Delete column", icon: <Trash2 size={16} />, danger: true, run: () => setRows(s.rows.map((r) => r.filter((_, i) => i !== c))) },
    ]);
  const rowMenu = (e: React.MouseEvent, r: number) =>
    menu.open(e, [
      { label: "Insert row above", icon: <Rows3 size={16} />, run: () => setRows([...s.rows.slice(0, r), Array(cols).fill(""), ...s.rows.slice(r)]) },
      { label: "Insert row below", icon: <Rows3 size={16} />, run: () => setRows([...s.rows.slice(0, r + 1), Array(cols).fill(""), ...s.rows.slice(r + 1)]) },
      { label: "Delete row", icon: <Trash2 size={16} />, danger: true, run: () => setRows(s.rows.filter((_, i) => i !== r)) },
    ]);

  const fmtN = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="viewer">
      <div className="vbar glass">
        <button className="btn icon ghost" aria-label="Back" onClick={() => (save(), app.close())}><ArrowLeft size={19} /></button>
        <span className="ficon sm grain glow-green" style={{ fontSize: 9 }}>XLS</span>
        <input className="ed-title" style={{ flex: 1 }} value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && patch(item.id, { title: title.trim() })} />
        <span className="saved hide-sm"><span className="dot" /> Saved {ago(savedAt)}</span>
        <div className="search hide-sm" style={{ width: 200 }}>
          <Search size={15} />
          <input className="input" style={{ height: 34 }} placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn sm" onClick={() => setRows([...s.rows, Array(cols).fill("")])}><Rows3 size={15} /> <span className="hide-sm">Row</span></button>
        <button className="btn sm" onClick={() => setRows(s.rows.map((r) => [...r, ...Array(Math.max(0, cols - r.length)), ""]))}><Columns3 size={15} /> <span className="hide-sm">Column</span></button>
        <button className="btn sm orange grain" onClick={() => (save(), setExporting(true))}><Download size={15} /> <span className="hide-sm">Export</span></button>
      </div>
      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="rn" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} onClick={(e) => colMenu(e, c)} style={{ cursor: "pointer" }} title="Sort, insert, delete">
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r}>
                <td className="rn" onClick={(e) => rowMenu(e, r)} style={{ cursor: "pointer", fontWeight: r === 0 ? 800 : undefined }}>{r + 1}</td>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} style={r === 0 ? { fontWeight: 700 } : undefined}>
                    <input
                      id={`cell-${r}-${c}`}
                      value={s.rows[r]?.[c] ?? ""}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onFocus={() => setFocus({ r, c })}
                      onKeyDown={(e) => onKey(e, r, c)}
                      style={{ textAlign: num(s.rows[r]?.[c] ?? "") != null && r > 0 ? "right" : "left", fontWeight: r === 0 ? 700 : undefined }}
                      aria-label={`${colName(c)}${r + 1}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tabs glass">
        {sheets.map((sh, i) => (
          <button
            key={i}
            className={`chip ${i === tab ? "on" : ""}`}
            onClick={() => setTab(i)}
            onDoubleClick={async () => {
              const n = await prompt({ title: "Rename sheet", value: sh.name, ok: "Rename" });
              if (n?.trim()) commit(sheets.map((x, j) => (j === i ? { ...x, name: n.trim() } : x)));
            }}
          >
            {sh.name}
          </button>
        ))}
        <button className="chip" aria-label="Add sheet" onClick={() => (commit([...sheets, { name: `Sheet${sheets.length + 1}`, rows: Array.from({ length: 20 }, () => Array(6).fill("")) }]), setTab(sheets.length))}><Plus size={14} /></button>
        {sheets.length > 1 && (
          <button
            className="chip"
            aria-label="Delete this sheet"
            onClick={async (e) =>
              menu.open(e, [{
                label: `Delete “${s.name}”`,
                icon: <Trash2 size={16} />,
                danger: true,
                run: async () => {
                  if (await confirm({ title: `Delete “${s.name}”?`, ok: "Delete", danger: true })) {
                    commit(sheets.filter((_, j) => j !== tab));
                    setTab(0);
                  }
                },
              }])
            }
          >
            <MoreVertical size={14} />
          </button>
        )}
        <span className="grow" />
        {stats && focus && (
          <span className="meta" style={{ whiteSpace: "nowrap", alignSelf: "center" }}>
            Column {colName(focus.c)}: Sum <b>{fmtN(stats.sum)}</b> · Avg <b>{fmtN(stats.avg)}</b> · Min {fmtN(stats.min)} · Max {fmtN(stats.max)} · {stats.count} numbers
          </span>
        )}
      </div>
      {exporting && <ExportDialog item={{ ...item, title, sheets: latest.current }} onClose={() => setExporting(false)} />}
      {menu.el}
    </div>
  );
}
