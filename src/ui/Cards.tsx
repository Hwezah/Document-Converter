import { memo, useEffect, useRef, useState } from "react";
import { Copy, Download, FileText, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Trash2, ArrowLeftRight } from "lucide-react";
import { duplicate, getBlob, patch, remove, restore, type Item } from "../lib/store";
import { ago, humanSize } from "../lib/formats";
import { closePdf, openPdf, renderPage } from "../lib/pdf";
import { ItemIcon, kindLabel, useConfirm, usePrompt, useToast, type MenuEntry } from "./kit";
import { useApp } from "../app";

/** What the "…" on any item offers. */
export function useItemActions() {
  const prompt = usePrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const app = useApp();
  return (item: Item, onExport: (i: Item) => void): MenuEntry[] =>
    item.trashed
      ? [
          { label: "Restore", icon: <RotateCcw size={16} />, run: () => restore(item.id).then(() => toast("Restored")) },
          {
            label: "Delete forever",
            icon: <Trash2 size={16} />,
            danger: true,
            run: async () => (await confirm({ title: `Delete “${item.title || "Untitled"}” forever?`, body: "This can't be undone.", ok: "Delete", danger: true })) && remove(item.id, true),
          },
        ]
      : [
          { label: "Open", icon: <FileText size={16} />, run: () => app.open(item.id) },
          {
            label: "Rename",
            icon: <Pencil size={16} />,
            run: async () => {
              const t = await prompt({ title: "Rename", value: item.title, ok: "Rename" });
              if (t != null && t.trim()) patch(item.id, { title: t.trim() });
            },
          },
          { label: item.pinned ? "Unpin" : "Pin to top", icon: item.pinned ? <PinOff size={16} /> : <Pin size={16} />, run: () => patch(item.id, { pinned: !item.pinned }, false) },
          { label: "Duplicate", icon: <Copy size={16} />, run: () => duplicate(item.id).then(() => toast("Duplicated")) },
          "sep",
          { label: "Save as…", icon: <Download size={16} />, run: () => onExport(item) },
          ...(item.kind === "file"
            ? [{
                label: "Convert…",
                icon: <ArrowLeftRight size={16} />,
                run: async () => {
                  const b = await getBlob(item.id);
                  if (b) app.queueConvert([new File([b], `${item.title}.${item.ext}`, { type: b.type })]);
                },
              }]
            : []),
          "sep",
          {
            label: "Move to trash",
            icon: <Trash2 size={16} />,
            danger: true,
            run: () => remove(item.id).then(() => toast("Moved to trash", "info", { label: "Undo", run: () => restore(item.id) })),
          },
        ];
}

/** A little live preview of the item: its first lines, first rows, PDF's first page, or the picture. */
export const Thumb = memo(function Thumb({ item }: { item: Item }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    if (box.current) io.observe(box.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || item.kind !== "file") return;
    let gone = false;
    let url: string | null = null;
    (async () => {
      const b = await getBlob(item.id);
      if (!b || gone) return;
      if (item.ext === "pdf" && canvas.current) {
        try {
          const doc = await openPdf(await b.arrayBuffer());
          const page = await doc.getPage(1);
          if (!gone && canvas.current) await renderPage(page, canvas.current, 240);
          closePdf(doc);
        } catch {
          /* a damaged or locked PDF keeps its badge */
        }
      } else {
        url = URL.createObjectURL(b);
        setImg(url);
      }
    })();
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, item.id, item.kind, item.ext, item.updated]);

  if (item.kind === "file")
    return (
      <div className="thumb" ref={box} style={{ padding: 0, background: item.ext === "pdf" ? "#fff" : "var(--surface2)" }}>
        {item.ext === "pdf" ? <canvas ref={canvas} style={{ objectFit: "cover", objectPosition: "top" }} /> : img && <img className="imgthumb" src={img} alt="" />}
      </div>
    );
  if (item.kind === "sheet") {
    const rows = (item.sheets?.[0]?.rows ?? []).slice(0, 9);
    return (
      <div className="thumb" ref={box}>
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.slice(0, 5).map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <div className="thumb" ref={box} dangerouslySetInnerHTML={{ __html: (item.html ?? "").slice(0, 2500) || '<p style="opacity:.5">Empty</p>' }} />;
});

export function DocCard({ item, onMenu }: { item: Item; onMenu: (e: React.MouseEvent, i: Item) => void }) {
  const app = useApp();
  return (
    <div
      className="doc"
      role="button"
      tabIndex={0}
      onClick={() => !item.trashed && app.open(item.id)}
      onKeyDown={(e) => e.key === "Enter" && app.open(item.id)}
      onContextMenu={(e) => onMenu(e, item)}
    >
      {item.pinned && <Pin size={15} className="pin" fill="currentColor" />}
      <button className="btn sm icon more" aria-label="More" onClick={(e) => onMenu(e, item)}>
        <MoreHorizontal size={17} />
      </button>
      <Thumb item={item} />
      <div className="info">
        <div className="row" style={{ gap: 8 }}>
          <ItemIcon item={item} size="sm" />
          <b className="title clip grow">{item.title || "Untitled"}</b>
        </div>
        <span className="meta clip">
          {kindLabel(item)} · {ago(item.updated)}
          {item.size && item.kind === "file" ? ` · ${humanSize(item.size)}` : ""}
        </span>
      </div>
    </div>
  );
}
