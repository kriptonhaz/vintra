---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

`/master/customers` gains server-side pagination at 25 rows per page, matching the prev/next + page-counter pattern already used on `/hpp`. Previously the page hard-coded `pageSize: 50` and rendered a single static slice with only a "narrow your search" hint at the bottom — fine for the typical merchants tenant but unworkable for a tenant who imported a 5k-customer Qasir export and needed to scroll through them. The query key now includes `currentPage`, the search input resets the page to 1 so narrowing the list never strands you on an empty later page, and `placeholderData: (prev) => prev` keeps the current page visible while the next page loads so there's no skeleton flash on flip. Pagination chrome is hidden entirely when the result set fits on one page.
