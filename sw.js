const CACHE="happywheel-v5-5";
const ASSETS=[
  "./","./index.html","./styles.css","./app.js","./manifest.webmanifest",
  "./icons/icon-192.png","./icons/icon-512.png",
  "./data/pois_london.geojson","./data/pois_paris.geojson","./data/pois_lucerne.geojson",
  "./data/pois_bern.geojson","./data/pois_interlaken.geojson","./data/pois_milan.geojson",
  "./data/pois_venice.geojson","./data/pois_florence.geojson","./data/pois_rome.geojson"
];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(u.origin===location.origin){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))}});
