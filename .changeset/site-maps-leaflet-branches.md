---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Rebuild the public site "Peta Lokasi" section. It now pins branches from their stored coordinates, with two map providers the tenant can pick between: Leaflet + OpenStreetMap (all branches on one map, Vintra logo as a custom marker, no API key) or Google Maps (familiar keyless embed, single branch, no logo) — the editor shows the trade-off. A multi-select "Cabang yang ditampilkan" config picks any subset of branches (empty = all). Each branch also gets an address card with a one-tap Google Maps directions link, which doubles as the no-JS fallback. Adds a `branchMultiSelect` editor field type and surfaces branch latitude/longitude in the site render data.
