---
"@vintra/web": minor
---

Show product photos on the POS cashier grid. `listPOSProducts` already signed a
short-lived `photoUrl` for every item, but the cashier tile ignored it and always
rendered the first letter of the product name. Tiles now render the photo when one
exists (fixed 2:1.5 aspect box, `object-contain` so nothing is cropped, lazy-loaded),
falling back to the letter placeholder otherwise.
