---
"@vintra/web": minor
---

Enable Web Push on iPhone / iPad by installing the site as a PWA (the only path Apple allows for iOS push, since iOS 16.4). Adds a Web App Manifest, the Apple-specific meta tags, and a new `requires-pwa` state in the push subscription hook that detects iOS-Safari-in-tab and surfaces explicit "Add to Home Screen" instructions on both /settings/account and /notifications.
