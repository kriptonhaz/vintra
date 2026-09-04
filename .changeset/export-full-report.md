---
"@vintra/web": patch
---

Export the whole report, not just the page on screen — and footer every page of it.

The Produk and Pelanggan reports paginate at 25 rows. Their Export button serialized
`rows` — whatever page React Query had loaded — so a tenant with 100 products got 25
of them, four times, and stitched the files together by hand. Nothing in the file or
the UI said the data was partial, so an owner who never noticed the page count read
25 rows as the whole story.

Both server functions now take `all: true`, which returns every matching row for the
current filters in one call and ignores page/pageSize. The export path re-fetches
with it rather than reusing the loaded page; filters, search and sort carry over
verbatim so the file contains exactly what the screen claims to show, just all of
it. Bounded at 10k rows rather than unbounded — these are grouped aggregates held in
memory and serialized into a workbook in the browser. Past the cap the response comes
back flagged `truncated` and the UI says which rows are missing and how to narrow the
range.

That made a second bug reachable. Every `/pos/reports` PDF draws rows top-to-bottom,
calls `addPage()` when it runs past the margin, then calls `pdfFooter()` once at the
end — which stamped whichever page the cursor happened to be sitting on. With these
reports fitting on one page that was always the right one; a multi-page Produk PDF
would have left every page but the last unmarked. The shared helper now footers all
of them and adds a page counter, since a reader of a 40-page report needs to know
whether any are missing. `reports.index.tsx` had its own copy of the footer inlined
and now uses the shared one.
