import { useEffect, useState } from "react";
import { ArrowLeft, Download, FilePlus2, FlipHorizontal, Minus, Plus, RotateCw, Save, Share2 } from "lucide-react";
import { useApp } from "../app";
import { create, getBlob, patch, putBlob, blobToDataUrl, type Item } from "../lib/store";
import { humanSize } from "../lib/formats";
import { loadImage } from "../lib/pdf";
import { shareOrDownload } from "../lib/exporters";
import { ExportDialog } from "../ui/ExportDialog";
import { FileBadge, Spinner, useToast } from "../ui/kit";

export function ImageViewer({ item }: { item: Item }) {
  const app = useApp();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let u: string | null = null;
    getBlob(item.id).then(async (b) => {
      if (!b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
      const img = await loadImage(b).catch(() => null);
      if (img) setDims({ w: img.naturalWidth, h: img.naturalHeight });
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [item.id, item.updated]);

  const changed = rot !== 0 || flip;
  /** Bakes the rotation and flip into the file. */
  const apply = async () => {
    const b = await getBlob(item.id);
    if (!b) return;
    setBusy(true);
    try {
      const img = await loadImage(b);
      const c = document.createElement("canvas");
      const side = rot % 180 !== 0;
      c.width = side ? img.naturalHeight : img.naturalWidth;
      c.height = side ? img.naturalWidth : img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const type = /png|webp|jpeg/.test(b.type) ? b.type : "image/png";
      const out = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), type, 0.95));
      await putBlob(item.id, out);
      await patch(item.id, { size: out.size, mime: type });
      setRot(0);
      setFlip(false);
      toast("Saved");
    } finally {
      setBusy(false);
    }
  };

  const toDoc = async () => {
    const b = await getBlob(item.id);
    if (!b) return;
    const it = await create({ kind: "doc", title: item.title, html: `<p><img src="${await blobToDataUrl(b)}" alt=""></p><p></p>` });
    app.open(it.id);
  };

  return (
    <div className="viewer">
      <div className="vbar glass">
        <button className="btn icon ghost" aria-label="Back" onClick={app.close}><ArrowLeft size={19} /></button>
        <FileBadge ext={item.ext ?? "png"} size="sm" />
        <input className="ed-title" style={{ flex: 1 }} defaultValue={item.title} aria-label="Title" onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && patch(item.id, { title: e.target.value.trim() })} />
        <button className="btn sm icon ghost hide-sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}><Minus size={16} /></button>
        <button className="zoom btn sm ghost hide-sm" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button className="btn sm icon ghost hide-sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}><Plus size={16} /></button>
        <button className="btn sm icon ghost" aria-label="Rotate" onClick={() => setRot((r) => (r + 90) % 360)}><RotateCw size={17} /></button>
        <button className="btn sm icon ghost" aria-label="Flip" onClick={() => setFlip((f) => !f)}><FlipHorizontal size={17} /></button>
        {changed && <button className="btn sm green grain" disabled={busy} onClick={apply}>{busy ? <Spinner /> : <Save size={15} />} Save</button>}
        <button className="btn sm icon ghost" aria-label="Put in a document" title="Put in a new document" onClick={toDoc}><FilePlus2 size={17} /></button>
        <button className="btn sm icon ghost" aria-label="Share" onClick={async () => { const b = await getBlob(item.id); if (b) shareOrDownload(b, `${item.title}.${item.ext}`); }}><Share2 size={17} /></button>
        <button className="btn sm orange grain" onClick={() => setExporting(true)}><Download size={15} /> <span className="hide-sm">Convert</span></button>
      </div>
      <div className="img-stage" onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}>
        {url && <img src={url} alt={item.title} style={{ transform: `scale(${zoom}) rotate(${rot}deg) scaleX(${flip ? -1 : 1})` }} />}
      </div>
      <div className="ed-status glass">
        {dims && <span>{dims.w} × {dims.h}</span>}
        <span>{humanSize(item.size)}</span>
        <span>{(item.ext ?? "").toUpperCase()}</span>
        {item.source && <span className="hide-sm clip">From {item.source}</span>}
      </div>
      {exporting && <ExportDialog item={item} onClose={() => setExporting(false)} />}
    </div>
  );
}
