/** "system", "dark" or "light". Kept raw in localStorage so index.html can apply it before first paint. */
export type ThemePref = "system" | "dark" | "light";

const mq = matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): ThemePref {
  try {
    return (localStorage.getItem("folio.theme") as ThemePref) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: ThemePref = getTheme()) {
  const dark = t === "dark" || (t === "system" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#f6f2ee");
}

export function setTheme(t: ThemePref) {
  try {
    localStorage.setItem("folio.theme", t);
  } catch {
    /* applies for this session only */
  }
  applyTheme(t);
}

mq.addEventListener("change", () => getTheme() === "system" && applyTheme());
