/** Theme ("system", "dark", "light") and accent. Kept raw in localStorage so index.html applies them before first paint. */
export type ThemePref = "system" | "dark" | "light";

/** The accent choices, Folio's red first. */
export const ACCENTS = [
  { name: "Red", hex: "#B81D24" },
  { name: "Deep Orange", hex: "#D84315" },
  { name: "Amber", hex: "#C77700" },
  { name: "Teal", hex: "#00897B" },
  { name: "Rust", hex: "#9A4A2E" },
  { name: "Dusty Rose", hex: "#9A6B72" },
  { name: "Olive", hex: "#6B6E3A" },
  { name: "Sage", hex: "#6E8B74" },
  { name: "Slate", hex: "#4A5D6E" },
  { name: "Grey", hex: "#5F6368" },
  { name: "Sand", hex: "#C8B89A" },
  { name: "White", hex: "#ECECEC" },
];
/** White text on every accent but Sand and White, which take near-black. */
export const onAccent = (hex: string) => (/^#(C8B89A|ECECEC)$/i.test(hex) ? "#141414" : "#ffffff");

const mq = matchMedia("(prefers-color-scheme: dark)");
const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* applies for this session only */
  }
};

export const getTheme = (): ThemePref => (get("folio.theme") as ThemePref) || "system";
export const getAccent = () => get("folio.accent") || ACCENTS[0].hex;

export function applyTheme(t: ThemePref = getTheme()) {
  const dark = t === "dark" || (t === "system" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#f6f2ee");
  // The Android app colours its status and navigation bars to match.
  (window as unknown as { FolioAndroid?: { setDark?(d: boolean): void } }).FolioAndroid?.setDark?.(dark);
}
export function setTheme(t: ThemePref) {
  put("folio.theme", t);
  applyTheme(t);
}

export function applyAccent(hex = getAccent()) {
  const s = document.documentElement.style;
  s.setProperty("--accent", hex);
  s.setProperty("--on-accent", onAccent(hex));
}
export function setAccent(hex: string) {
  put("folio.accent", hex);
  applyAccent(hex);
}

/** The film grain: a 192×192 tile of random black or white pixels, each 0–21 alpha, seed 42. */
export function applyGrain() {
  let seed = 42;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = 192;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = rand() < 0.5 ? 255 : 0;
    img.data.set([v, v, v, Math.floor(rand() * 22)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty("--grain", `url(${c.toDataURL("image/png")})`);
  document.documentElement.style.setProperty("--grain-size", `${n / (window.devicePixelRatio || 1)}px`);
}

mq.addEventListener("change", () => getTheme() === "system" && applyTheme());
