---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix: voiding a POS sale now reverses stamp-card movements the same way it already reverses loyalty points. Previously, redeemed stamps stayed gone (and earned stamps stayed on the card) after a void — so a customer who cancelled a transaction and re-entered it would find the stamp indicator missing because their card was still drained from the original sale. `voidSale` now writes compensating `'adjust'` rows to `customer_stamp_movements` and bumps `customer_stamp_cards.current_stamps` by the inverse of the original earn/redeem. `lifetime_stamps` / `lifetime_rewards` are intentionally left alone, mirroring the existing loyalty-points behaviour.
