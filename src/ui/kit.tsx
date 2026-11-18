import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, NotebookPen, Sheet, StickyNote } from "lucide-react";
import { fmt } from "../lib/formats";
import type { Item } from "../lib/store";

/* ---------- Toasts ---------- */

type Toast = { id: number; text: string; tone: "good" | "bad" | "info"; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"], action?: Toast["action"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "good", action?: Toast["action"]) => {
    const id = Math.random();
    setList((l) => [...l.slice(-2), { id, text, tone, action }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), action ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className="toast">
              <span className="tdot" style={{ background: t.tone === "good" ? "var(--green)" : t.tone === "bad" ? "var(--danger)" : "var(--orange)" }} />
              <span>{t.text}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.run();
                    setList((l) => l.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

/* ---------- Menus ---------- */

export type MenuEntry = { label: string; icon?: ReactNode; run: () => void; danger?: boolean; disabled?: boolean } | "sep" | { heading: string };

export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const open = (e: { currentTarget: Element; preventDefault?: () => void; stopPropagation?: () => void; clientX?: number; clientY?: number }, items: MenuEntry[]) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    const r = e.currentTarget.getBoundingClientRect();
    const fromPointer = e.clientX && e.clientY && (e as unknown as MouseEvent).type === "contextmenu";
    setState({ x: fromPointer ? e.clientX! : r.right, y: fromPointer ? e.clientY! : r.bottom + 6, items });
  };
  const el = state ? <Menu {...state} onClose={() => setState(null)} /> : null;
  return { open, el };
}

function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x - r.width, window.innerWidth - r.width - 8)),
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height - 40) : y,
    });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const t = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", close);
      window.addEventListener("resize", close);
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {items.map((it, i) =>
        it === "sep" ? (
          <hr key={i} />
        ) : "heading" in it ? (
          <div key={i} className="overline lbl">{it.heading}</div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.4 } : undefined}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/* ---------- Sheets (dialogs; bottom sheets on phones) ---------- */

export function Modal({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet-modal grain ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <div>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const ConfirmCtx = createContext<(q: { title: string; body?: string; ok?: string; danger?: boolean }) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
const PromptCtx = createContext<(q: { title: string; value?: string; placeholder?: string; ok?: string }) => Promise<string | null>>(async () => null);
export const usePrompt = () => useContext(PromptCtx);

export function DialogHost({ children }: { children: ReactNode }) {
  const [c, setC] = useState<{ title: string; body?: string; ok?: string; danger?: boolean; done: (v: boolean) => void } | null>(null);
  const [p, setP] = useState<{ title: string; value?: string; placeholder?: string; ok?: string; done: (v: string | null) => void } | null>(null);
  const [val, setVal] = useState("");
  const confirm = useCallback((q: { title: string; body?: string; ok?: string; danger?: boolean }) => new Promise<boolean>((done) => setC({ ...q, done })), []);
  const prompt = useCallback(
    (q: { title: string; value?: string; placeholder?: string; ok?: string }) =>
      new Promise<string | null>((done) => {
        setVal(q.value ?? "");
        setP({ ...q, done });
      }),
    [],
  );
  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
        {children}
        {c && (
          <Modal label={c.title} onClose={() => (c.done(false), setC(null))}>
            <h2 className="title">{c.title}</h2>
            {c.body && <p className="body">{c.body}</p>}
            <div className="row mt" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => (c.done(false), setC(null))}>Cancel</button>
              <button className={`btn ${c.danger ? "red" : "green"}`} autoFocus onClick={() => (c.done(true), setC(null))}>{c.ok ?? "OK"}</button>
            </div>
          </Modal>
        )}
        {p && (
          <Modal label={p.title} onClose={() => (p.done(null), setP(null))}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                p.done(val);
                setP(null);
              }}
            >
              <h2 className="title" style={{ marginBottom: 14 }}>{p.title}</h2>
              <input className="input" autoFocus value={val} placeholder={p.placeholder} onChange={(e) => setVal(e.target.value)} onFocus={(e) => e.target.select()} />
              <div className="row mt" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => (p.done(null), setP(null))}>Cancel</button>
                <button className="btn green" type="submit">{p.ok ?? "OK"}</button>
              </div>
            </form>
          </Modal>
        )}
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

/* ---------- File badges ---------- */

export function FileBadge({ ext, size = "" }: { ext: string; size?: "" | "sm" }) {
  const f = fmt(ext);
  return (
    <span className={`ficon grain ${size}`} style={{ background: `radial-gradient(120% 120% at 85% 110%, color-mix(in srgb, ${f.color}, #ff8a4c 40%), ${f.color} 50%, color-mix(in srgb, ${f.color}, #000 45%))` }}>
      <span>{ext.slice(0, 4).toUpperCase()}</span>
    </span>
  );
}

export function ItemIcon({ item, size = "" }: { item: Item; size?: "" | "sm" }) {
  if (item.kind === "file" && item.ext) return <FileBadge ext={item.ext} size={size} />;
  const s = size === "sm" ? 15 : 18;
  const [bg, icon] =
    item.kind === "note" ? ["glow-green", <StickyNote size={s} key="n" />] :
    item.kind === "sheet" ? ["glow-green", <Sheet size={s} key="s" />] :
    item.kind === "doc" ? ["glow-red", <FileText size={s} key="d" />] :
    ["glow-orange", <ImageIcon size={s} key="i" />];
  return <span className={`ficon grain ${bg} ${size}`}>{icon}</span>;
}

export const kindLabel = (i: Item) => (i.kind === "file" ? fmt(i.ext ?? "").label : i.kind === "doc" ? "Document" : i.kind === "note" ? "Note" : "Sheet");

export function Spinner() {
  return <span className="spin" aria-label="Working" />;
}

export function Empty({ icon, title, body, children, tone = "red" }: { icon: ReactNode; title: string; body?: string; children?: ReactNode; tone?: "red" | "green" | "orange" }) {
  return (
    <div className="empty enter">
      <div className={`big grain glow-${tone}`}>{icon}</div>
      <h3 className="title">{title}</h3>
      {body && <p className="body" style={{ maxWidth: 380, margin: "6px auto 18px" }}>{body}</p>}
      {children}
    </div>
  );
}

export const NoteIcon = NotebookPen;
