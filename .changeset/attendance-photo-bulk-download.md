---
"@vintra/web": minor
---

Bulk download attendance photos as a single ZIP from /attendance/records, plus a matching `File Foto Masuk` / `File Foto Pulang` filename column on the existing CSV and Excel exports. The browser packages the ZIP via jszip + signed S3 URLs (no server bandwidth), with progress shown inline and a 500-photo per-request cap. Filenames are deterministic (`{date}_{slug-staffname}_{slot}.jpg`) so the spreadsheet column matches the file inside the ZIP byte-for-byte. Lets owners back up photos before the 60-day S3 lifecycle rule expires them.
