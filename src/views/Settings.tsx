import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download, HardDrive, Monitor, Moon, Palette, RefreshCw, Smartphone, Trash2, Upload, ShieldCheck, Keyboard } from "lucide-react";
import { backup, pref, remove, restoreBackup, setPref, useItems, wipe } from "../lib/store";
import { download } from "../lib/exporters";
import { humanSize } from "../lib/formats";
import { ACCENTS, getAccent, getTheme, onAccent, setAccent, setTheme, type ThemePref } from "../lib/theme";
import { Choice } from "../ui/kit";
import { native } from "../lib/native";
import { useConfirm, useToast } from "../ui/kit";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
});

export function Settings() {
  const items = useItems();
  const toast = useToast();
  const confirm = useConfirm();
  const [theme, setT] = useState<ThemePref>(getTheme());
  const [accent, setAcc] = useState(getAccent());
  const [docFmt, setDocFmt] = useState(() => pref("export.doc", "pdf"));
  const [paper, setPaper] = useState(() => pref("editor.paper", true));
  const [usage, setUsage] = useState<{ used?: number; quota?: number; persisted?: boolean }>({});
  const [canInstall, setCanInstall] = useState(!!deferred);
  const restoreInput = useRef<HTMLInputElement>(null);
  const standalone = matchMedia("(display-mode: standalone)").matches || "FolioAndroid" in window;

  useEffect(() => {
    (async () => {
      const e = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setUsage({ used: e?.usage, quota: e?.quota, persisted });
    })();
    const t = setInterval(() => setCanInstall(!!deferred), 1000);
    return () => clearInterval(t);
  }, [items.length]);

  const trashed = items.filter((i) => i.trashed);
  const Row = ({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children: React.ReactNode }) => (
    <div className="setting">
      <span className="ficon sm" style={{ background: "var(--tint)", color: "var(--ember)" }}>{icon}</span>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{title}</div>
        {body && <div className="meta">{body}</div>}
      </div>
      <div className="row wrap" style={{ justifyContent: "flex-end" }}>{children}</div>
    </div>
  );

  return (
    <>
      <div className="overline">Settings</div>
      <h1 className="display" style={{ marginTop: 4, marginBottom: 24 }}>Make it yours</h1>

      <div className="overline" style={{ margin: "0 0 8px" }}>Look</div>
      <div className="card">
        <Row icon={<Moon size={16} />} title="Theme" body="Near-black, or warm paper in the light.">
          <Choice label="Theme" value={theme} onChange={(v) => (setTheme(v), setT(v))} options={[{ value: "system", label: "Auto" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Row>
        <Row icon={<Monitor size={16} />} title="Documents open in" body="Page view shows paper; continuous is easier on phones.">
          <Choice label="Documents open in" value={paper ? "page" : "flow"} onChange={(v) => (setPaper(v === "page"), setPref("editor.paper", v === "page"))} options={[{ value: "page", label: "Page" }, { value: "flow", label: "Continuous" }]} />
        </Row>
        <Row icon={<Palette size={16} />} title="Accent" body="The colour of the main buttons, the current tab and choices.">
          <div className="accents" role="radiogroup" aria-label="Accent">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                role="radio"
                aria-checked={accent === a.hex}
                aria-label={a.name}
                title={a.name}
                className={accent === a.hex ? "on" : ""}
                style={{ background: a.hex, "--on": onAccent(a.hex) } as React.CSSProperties}
                onClick={() => (setAccent(a.hex), setAcc(a.hex))}
              />
            ))}
          </div>
        </Row>
        <Row icon={<Download size={16} />} title="Share documents as" body="What the share button in the editor sends.">
          <select className="select" style={{ width: 130, height: 36 }} value={docFmt} onChange={(e) => (setDocFmt(e.target.value), setPref("export.doc", e.target.value))}>
            {["pdf", "docx", "odt", "html", "md", "txt", "rtf", "epub"].map((f) => <option key={f} value={f}>.{f}</option>)}
          </select>
        </Row>
      </div>

      <div className="overline" style={{ margin: "26px 0 8px" }}>App</div>
      <div className="card">
        <Row icon={<Smartphone size={16} />} title={standalone ? "Installed" : "Install Folio"} body={standalone ? "Running as an app. It opens offline and appears in your share sheet." : "Adds Folio to your home screen or Start menu, works offline, and shows up when you share or open documents."}>
          {!standalone && (
            <button
              className="btn sm red"
              disabled={!canInstall}
              title={canInstall ? "" : "Use your browser's menu: Install app / Add to Home screen"}
              onClick={async () => {
                if (!deferred) return;
                await deferred.prompt();
                deferred = null;
                setCanInstall(false);
              }}
            >
              Install
            </button>
          )}
        </Row>
        {native && (
          <Row icon={<RefreshCw size={16} />} title="Updates" body={`Version ${native.version()}. Folio checks for a new build each time it opens and offers to install it.`}>
            <button className="btn sm" onClick={() => (native!.checkForUpdate(), toast("Checking for updates…", "info"))}>Check now</button>
          </Row>
        )}
        <Row icon={<HardDrive size={16} />} title="Storage on this device" body={`${humanSize(usage.used) || "0 B"} used${usage.quota ? ` of ${humanSize(usage.quota)} available` : ""}. ${usage.persisted ? "Protected from automatic clean-up." : "The browser may clear it if space runs very low — keep a backup."}`}>
          <span className="badge green">{items.length} items</span>
        </Row>
      </div>

      <div className="overline" style={{ margin: "26px 0 8px" }}>Your data</div>
      <div className="card">
        <Row icon={<DatabaseBackup size={16} />} title="Back up everything" body="Every document, note, sheet and file in one file. Keep it somewhere safe, or move it to another device.">
          <button className="btn sm green" onClick={async () => (download(await backup(), `Folio backup ${new Date().toISOString().slice(0, 10)}.json`), toast("Backup saved"))}>
            <Download size={15} /> Back up
          </button>
          <button className="btn sm" onClick={() => restoreInput.current?.click()}><Upload size={15} /> Restore</button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                toast(`Restored ${await restoreBackup(f)} items`);
              } catch (err) {
                toast((err as Error).message, "bad");
              }
            }}
          />
        </Row>
        <Row icon={<Trash2 size={16} />} title="Trash" body={`${trashed.length} item${trashed.length === 1 ? "" : "s"}. Emptied automatically after 30 days.`}>
          <button
            className="btn sm danger"
            disabled={!trashed.length}
            onClick={async () => {
              if (!(await confirm({ title: `Empty the trash?`, body: `${trashed.length} items will be deleted for good.`, ok: "Empty", danger: true }))) return;
              for (const i of trashed) await remove(i.id, true);
              toast("Trash emptied");
            }}
          >
            Empty trash
          </button>
        </Row>
        <Row icon={<ShieldCheck size={16} />} title="Erase everything" body="Removes all of Folio's data from this device.">
          <button
            className="btn sm danger"
            onClick={async () => {
              if (await confirm({ title: "Erase everything?", body: "Every document, note and file in Folio on this device will be deleted. Back up first if you might want them.", ok: "Erase", danger: true })) {
                await wipe();
                toast("Erased");
              }
            }}
          >
            Erase
          </button>
        </Row>
      </div>

      <div className="overline" style={{ margin: "26px 0 8px" }}>Keyboard</div>
      <div className="card" style={{ padding: "6px 0" }}>
        {[
          ["Open a file", "Ctrl O"],
          ["New document", "Ctrl Alt N"],
          ["New note", "Ctrl Alt M"],
          ["Find & replace", "Ctrl F"],
          ["Save now / Save as", "Ctrl S / Ctrl Shift S"],
          ["Link", "Ctrl K"],
          ["Zoom a PDF", "Ctrl + / Ctrl − / Ctrl 0"],
        ].map(([a, k]) => (
          <div key={a} className="setting" style={{ padding: "9px 16px" }}>
            <Keyboard size={15} className="faint" />
            <span className="grow">{a}</span>
            <span>{k.split(" ").map((x, i) => (x === "/" ? <span key={i} className="faint"> / </span> : <span key={i} className="kbd" style={{ marginLeft: 4 }}>{x}</span>))}</span>
          </div>
        ))}
      </div>

      <p className="meta faint" style={{ textAlign: "center", marginTop: 34, lineHeight: 1.7 }}>
        Folio 1.0 · Everything is processed and stored on this device; nothing is uploaded.
        <br />
        Type: Google Sans Flex (SIL Open Font License).
      </p>
    </>
  );
}
