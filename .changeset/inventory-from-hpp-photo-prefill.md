---
"@vintra/web": patch
---

Fix: creating an inventory item from an HPP product now copies the product's photo too. `listInventoryFormMasters` was returning hpp products without `photoKey`, so the auto-prefill effect filled name / unit / category / cost / sellingPrice but left the photo blank. The form now pulls the linked product's photo (via the existing `getHppPhotoUrls` signed-URL helper) into the pending upload buffer, so the inventory item lands with its own fresh S3 copy — independent lifecycle from the HPP product's photo. Manual photos already on the form are never overwritten.
