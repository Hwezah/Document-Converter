import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { Modal, Spinner, useToast } from "./kit";
import { describe, exportItem, exportTargets } from "../lib/itemio";
import { pref, setPref, type Item } from "../lib/store";
import { shareOrDownload, zipFiles, download } from "../lib/exporters";

/** "Save as": pick a format, then download it (or share it, on a phone). */
export function ExportDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const targets = exportTargets(item);
  const [sel, setSel] = useState<string>(() => {
    const last = pref<string>(`export.${item.kind}`, "");
    return targets.includes(last) ? last : targets[0];
  });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const canShare = typeof navigator.canShare === "function" || "FolioAndroid" in window;

  const run = async (share: boolean) => {
    setBusy("Working");
    setPref(`export.${item.kind}`, sel);
    try {
      const files = await exportItem(item, sel, setBusy);
      const one = files.length === 1 ? files[0] : { name: `${item.title || "Untitled"} (${sel}).zip`, blob: await zipFiles(files) };
      if (share) {
        const r = await shareOrDownload(one.blob, one.name);
        if (r !== "cancelled") toast(r === "shared" ? "Shared" : `Saved ${one.name}`);
      } else {
        download(one.blob, one.name);
        toast(`Saved ${one.name}`);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast(`Couldn't make that file: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal label="Save as" onClose={onClose}>
      <div className="overline">Save as</div>
      <h2 className="title clip" style={{ margin: "4px 0 16px" }}>{item.title || "Untitled"}</h2>
      <div className="formats">
        {targets.map((t) => {
          const d = describe(t);
          return (
            <button key={t} className={`fmt ${sel === t ? "on" : ""}`} onClick={() => setSel(t)} onDoubleClick={() => run(false)}>
              <span className="badge" style={{ background: `color-mix(in srgb, ${d.color} 18%, transparent)`, color: d.color }}>.{t}</span>
              <span>
                <b>{d.label}</b>
                <br />
                <small>{t === item.ext ? "Original file" : d.note}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="row mt-lg" style={{ justifyContent: "flex-end" }}>
        {busy && (
          <span className="row meta grow">
            <Spinner /> {busy}…
          </span>
        )}
        {canShare && (
          <button className="btn" disabled={!!busy} onClick={() => run(true)}>
            <Share2 size={17} /> Share
          </button>
        )}
        <button className="btn orange grain" disabled={!!busy} onClick={() => run(false)}>
          <Download size={17} /> Download .{sel}
        </button>
      </div>
    </Modal>
  );
}
