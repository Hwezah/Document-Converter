import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app";
import { DialogHost, ToastHost } from "./ui/kit";
import { applyAccent, applyGrain, applyTheme } from "./lib/theme";
import "./styles.css";

applyTheme();
applyAccent();
applyGrain();
if ("FolioAndroid" in window) document.documentElement.classList.add("android");
// Inside the Android app the files are already on the phone; no service worker needed.
if ("serviceWorker" in navigator && import.meta.env.PROD && !("FolioAndroid" in window)) registerSW({ immediate: true });
// Ask the browser not to evict the library when space runs low.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastHost>
      <DialogHost>
        <App />
      </DialogHost>
    </ToastHost>
  </StrictMode>,
);
