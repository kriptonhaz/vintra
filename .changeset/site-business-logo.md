---
"@vintra/web": minor
"@vintra/shared": patch
"@vintra/db": patch
---

Add a business logo upload to the Situs editor's Theme card. The logo is stored on the site theme and used as the marker icon in the Peta Lokasi section (falling back to the Vintra logo when none is set). Replacing the logo deletes the previous S3 object — guarded so the currently published logo survives until the next publish. Migrating v1 sites carry their old `logoAssetKey` into the v2 theme.
