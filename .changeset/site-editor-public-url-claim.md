---
"@vintra/web": minor
---

Move the public URL (subdomain) claim form out of Booking settings into the Situs editor. The "URL Publik" card now lives at the top of the `/site/edit` controls panel — claim, copy, open, and change the public address where you build the site instead of in an unrelated page. The claim input's placeholder is now suggested from the tenant's business name. Removes the now-unused `getMyPublicSlug` server function.
