---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-78 — emoji picker in the WhatsApp chat composer.

- New smiley button between the paperclip and the textarea.
- Click → popover renders above the composer with a searchable
  emoji grid.
- Click an emoji → inserts at the textarea's current cursor
  position (not appended at end), picker closes, focus returns to
  the textarea, caret moves past the inserted character.
- Picker chunk lazy-loaded — `emoji-picker-react` (~25 KB gzipped)
  only ships the first time the smiley button is clicked.
- Picker closes on outside click + Escape.
- Native emoji rendering, no remote sprite, no preview pane,
  no skin-tone selector (kept compact).
