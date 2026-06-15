---
"@vintra/web": minor
"@vintra/db": patch
---

Site editor: desktop/mobile preview toggle. The live preview now has Desktop and Mobile icons; mobile renders inside an iframe so CSS breakpoints respond to the real device width (an inline div couldn't simulate mobile). Also adds a per-store toggle for product ratings & reviews — when off, review forms (on /track), rating summaries on product pages, and star averages on catalog cards are all hidden, and the review submit path is rejected. Configured under Situs → Toko Online → Lainnya. Default on.
