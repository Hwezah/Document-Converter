import { createStore, del, get, set, entries, clear } from "idb-keyval";
import { useSyncExternalStore } from "react";

/**
 * Everything lives on this device, in IndexedDB: one row per item, the original file (if any)
 * beside it under "blob:<id>". Nothing is uploaded anywhere.
 */
export type Kind = "doc" | "note" | "sheet" | "file";
export type Tint = "red" | "green" | "orange" | "gold" | null;

export interface SheetData {
  name: string;
  rows: string[][];
}

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  created: number;
  updated: number;
  opened?: number;
  /** Rich text, for docs and notes. */
  html?: string;
  /** Plain-text preview for search and cards. */
  text?: string;
  sheets?: SheetData[];
  /** For files kept as they are (PDFs, images): their format and size. */
  ext?: string;
  mime?: string;
  size?: number;
  /** The name of the file this came from, if it came from one. */
  source?: string;
  hasBlob?: boolean;
  tint?: Tint;
  pinned?: boolean;
  tags?: string[];
  trashed?: number;
}

const items = createStore("folio", "items");
const blobs = createStore("folio-blobs", "blobs");

let cache: Item[] = [];
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function load() {
  const all = await entries<string, Item>(items);
  cache = all.map(([, v]) => v).sort((a, b) => b.updated - a.updated);
  ready = true;
  // Trash empties itself after 30 days.
  const old = cache.filter((i) => i.trashed && Date.now() - i.trashed > 30 * 864e5);
  for (const i of old) await remove(i.id, true);
  emit();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function useItems(): Item[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache,
  );
}
export const isReady = () => ready;
export const getItem = (id: string) => cache.find((i) => i.id === id);

export async function save(item: Item) {
  const i = cache.findIndex((x) => x.id === item.id);
  cache = i >= 0 ? cache.map((x) => (x.id === item.id ? item : x)) : [item, ...cache];
  cache = [...cache].sort((a, b) => b.updated - a.updated);
  emit();
  await set(item.id, item, items);
  return item;
}

export async function patch(id: string, p: Partial<Item>, touch = true) {
  const cur = getItem(id);
  if (!cur) return;
  return save({ ...cur, ...p, ...(touch ? { updated: Date.now() } : {}) });
}

export async function create(p: Partial<Item> & { kind: Kind }, blob?: Blob) {
  const now = Date.now();
  const item: Item = { id: uid(), title: "Untitled", created: now, updated: now, opened: now, ...p, hasBlob: !!blob };
  if (blob) await set(item.id, blob, blobs);
  return save(item);
}

export const getBlob = (id: string) => get<Blob>(id, blobs);
export const putBlob = (id: string, b: Blob) => set(id, b, blobs);

export async function remove(id: string, forever = false) {
  if (!forever) return patch(id, { trashed: Date.now(), pinned: false }, false);
  cache = cache.filter((x) => x.id !== id);
  emit();
  await del(id, items);
  await del(id, blobs);
}
export const restore = (id: string) => patch(id, { trashed: undefined }, false);

export async function duplicate(id: string) {
  const cur = getItem(id);
  if (!cur) return;
  const blob = cur.hasBlob ? await getBlob(id) : undefined;
  const { id: _old, ...rest } = cur;
  void _old;
  return create({ ...rest, title: cur.title + " (copy)", pinned: false }, blob);
}

/** Everything, as one JSON file: the backup. Blobs ride along as data URLs. */
export async function backup(): Promise<Blob> {
  const out: (Item & { blob?: string })[] = [];
  for (const it of cache) {
    const b = it.hasBlob ? await getBlob(it.id) : undefined;
    out.push(b ? { ...it, blob: await blobToDataUrl(b) } : it);
  }
  return new Blob([JSON.stringify({ app: "folio", version: 1, at: Date.now(), items: out })], { type: "application/json" });
}

export async function restoreBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.app !== "folio" || !Array.isArray(data.items)) throw new Error("Not a Folio backup");
  let n = 0;
  for (const raw of data.items as (Item & { blob?: string })[]) {
    const { blob, ...it } = raw;
    if (blob) await set(it.id, await (await fetch(blob)).blob(), blobs);
    await set(it.id, it, items);
    n++;
  }
  await load();
  return n;
}

export async function wipe() {
  await clear(items);
  await clear(blobs);
  cache = [];
  emit();
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/** Little settings in localStorage, each with a default. */
export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("folio." + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem("folio." + key, JSON.stringify(v));
  } catch {
    /* private mode: the setting lasts the session */
  }
}
