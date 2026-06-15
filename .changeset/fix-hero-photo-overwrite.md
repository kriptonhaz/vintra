---
"@vintra/web": patch
---

Fix: uploading a second hero photo in the site editor overwrote the first. Hero (and gallery) are multi-photo repeaters, but only `gallery` minted a unique asset id per upload — `hero` reused a fixed key, so every hero photo wrote to the same S3 object (and even collided with the About section image, which also uses the `hero` kind). Hero uploads now get a unique id each, like gallery. Note: existing hero photos that already collided need to be re-uploaded once to get distinct images.
