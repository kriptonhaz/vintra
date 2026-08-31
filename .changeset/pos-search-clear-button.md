---
"@vintra/web": patch
---

Add a clear button to the cashier's product search.

Ringing up two items means clearing a whole product name between them. On the
phone the cashier actually uses, "bakwan jagung" is a dozen backspaces on a
popup keyboard before the next item can be typed.

The button appears only while there is text, and returns focus to the field
after clearing — without that the keyboard dismisses and the cashier has to tap
the field again, which is most of the taps the button was meant to save.
