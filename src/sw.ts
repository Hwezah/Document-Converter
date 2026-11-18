/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/**
 * The share sheet POSTs files here. They are parked in a cache under /shared/<n>,
 * the app opens with ?share=<count>, and it picks them up from there.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/share")) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open("folio-share");
      for (const key of await cache.keys()) await cache.delete(key);
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      let n = 0;
      for (const f of files) {
        await cache.put(
          new URL(`shared/${n++}`, self.registration.scope).href,
          new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name) } }),
        );
      }
      const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
      if (text) await cache.put(new URL("shared/text", self.registration.scope).href, new Response(String(text)));
      return Response.redirect(new URL(`./?share=${n}${text ? "&text=1" : ""}`, self.registration.scope).href, 303);
    })(),
  );
});

registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
