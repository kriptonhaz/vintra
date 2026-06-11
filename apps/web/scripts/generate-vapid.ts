/**
 * One-shot generator for the VAPID keypair used by Web Push.
 *
 * Run once per environment, then paste the values into .env.local
 * (and into the VPS environment for production):
 *
 *   bun run apps/web/scripts/generate-vapid.ts
 *
 * Output:
 *   VAPID_PUBLIC_KEY=...        (server, signs push requests)
 *   VAPID_PRIVATE_KEY=...       (server, NEVER ship to client)
 *   VITE_VAPID_PUBLIC_KEY=...   (client, identical to public — exposed by design)
 *   VAPID_SUBJECT=mailto:...    (server, contact for browser-vendor abuse handling)
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

console.log('# Add these to apps/web/.env.local AND to your VPS env file:')
console.log()
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log(`VAPID_SUBJECT=mailto:noreply@vintra.my.id`)
console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`)
