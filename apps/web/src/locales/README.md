# Vintra Translations

This directory holds the user-facing copy for the Vintra web app, split per language:

- **`id.json`** — Bahasa Indonesia (**source of truth**)
- **`en.json`** — English (translation target)

Indonesian is the source. When product copy changes, edit `id.json` first, then translate the change into `en.json`. Both files must have the same key shape — missing keys fall back to `id` via the i18next `fallbackLng` setting in `apps/web/src/lib/i18n.ts`.

---

## Translation glossary

These terms have a fixed English rendering across the whole app. Translators must apply these consistently — do not paraphrase them.

| Indonesian | English | Notes |
| --- | --- | --- |
| Kasir | Cashier | Role name + module name |
| Kelola | Configure | As a UI verb ("Kelola produk" → "Configure products"). Standard "Manage" feels weaker in product context. |
| HPP | Cost of Goods Sold | The HPP acronym is meaningless in EN. First mention in marketing copy can use "Cost of Goods Sold (HPP)" — body text uses the full phrase. |
| ~~UMKM~~ | — | Retired (brand repositioning, June 2026). Do not use in any copy — write "bisnis" / "business(es)" instead. |
| Outlet | Outlet | Same in both. |
| Komplit | Komplit | Brand plan name — never translate. |
| Toko | Toko | When used as a plan name (e.g. "POS Toko"), keep Indonesian. Otherwise translate as "shop" / "store". |
| Tenant | Tenant | Internal/admin term; stays the same. |
| QRIS | QRIS | Indonesian payment standard; brand name. |

### Brand and product names — never translate
- Vintra, Komplit, POS Toko, Inventory Toko, WhatsApp AI
- Qasir, Moka, Loyverse (competitor references)
- Customer / store names in mockups: Rina Amelia, Kedai Kopi Nusantara, Kopi Susu Gula Aren, etc. These are illustrative Indonesian businesses and stay in Indonesian regardless of locale.
- WhatsApp message templates inside `https://wa.me/...?text=...` URLs — they send to the Indonesian-speaking sales team, so they stay in Indonesian.

### Code identifiers — never translate
Strings that look like `inventory_price`, `on_keyword`, `pos_komplit_annual`, etc. are retrieval-type keys / plan keys / enum values. They're paired with backend code and break if changed.

---

## File structure

Top-level keys are namespaces, usually one per route family or feature area. Example:

```json
{
  "auth": { "login": { ... }, "register": { ... } },
  "hpp": { ... },
  "landing": { ... },
  "pricing": { ... },        // plan-label dictionary, shared across app
  "pricingPage": { ... },    // the /pricing route — separate namespace to avoid collision
  "admin": { "dashboard": { ... }, "monitoring": { ... }, ... }
}
```

### Interpolation

i18next uses `{{var}}` placeholders. Both locales must keep the same placeholders. Example:

```json
// id.json
"lastUpdatedTpl": "Terakhir diperbarui: {{date}}"
// en.json
"lastUpdatedTpl": "Last updated: {{date}}"
```

The component then calls `t('lastUpdatedTpl', { date: '...' })`.

### Lists

When a key holds an array of strings or objects (e.g. FAQ items, feature lists), both locales must keep the **same length and shape**. Example:

```json
"items": [
  { "q": "...", "a": "..." },
  { "q": "...", "a": "..." }
]
```

### Embedded markup

Strings that need inline HTML (links, `<strong>`) use named placeholders inside `<Trans>` components, e.g. `<emaillink>` or `<waLink>`. Translators **must keep the same tag names** but can move them within the sentence:

```json
"contact": "Untuk pertanyaan, hubungi <emaillink>support@vintra.my.id</emaillink>."
"contact": "For questions, contact us at <emaillink>support@vintra.my.id</emaillink>."
```

### Multi-line text

`\n` newlines inside a single string are real line breaks (used in chat mockups, receipt summaries). Keep them in both locales:

```json
"ai2OrderLines": "3x Iced Palm Sugar Latte: Rp 66,000\nDiscount: -Rp 6,600\nTotal: Rp 60,000"
```

### Numbers and currency

- **Indonesian format**: `Rp 25.000` (dot as thousands separator)
- **English format**: `Rp 25,000` (comma as thousands separator)
- Currency stays in Rupiah for both locales — Vintra is Indonesia-only product.
- Hardcoded prices in copy ("Rp 660.000/tahun" vs "Rp 660,000/year") should follow the locale's separator.

---

## Translation quality status

Not all EN translations are equal. Quality varies by route, and some need a native-speaker / domain-expert pass before being marketed externally.

| Surface | Status | Notes |
| --- | --- | --- |
| Auth flow (`auth.*`) | Carefully written | Pattern PR, small surface, real review |
| Help center (`help.*`) | Carefully written | Article catalog data still in Indonesian only |
| Authed app routes | **Not yet migrated** (JUR-139) | Still 100% Indonesian |
| `vs-qasir.tsx` | Carefully written | Marketing voice approved |
| `landing` (index.tsx) | Mechanical | Brand voice review needed before EN launch — idioms like "Kelola usaha jadi lebih mudah & untung" got literal renderings |
| `pricingPage` (`/pricing`) | Mechanical | 200+ strings; comparison table copy needs marketing voice review |
| `privacy`, `terms` | **Mechanical — needs legal review** | Direct translation, jurisdiction wording not verified for English-speaking users |
| `admin.*` | Functional only | Admin-internal — quality bar is "comprehensible", not "polished" |

**Before launching English to real users:**
1. Marketing/brand-voice pass on `landing`, `pricingPage`, `vsQasir`
2. Legal review on `privacy`, `terms` — confirm wording matches what's legally enforceable in jurisdictions where EN users would sue
3. Translate the help-article catalog (`apps/web/src/lib/help-articles.ts`) — article bodies are JSX in code, not in JSON

---

## Adding new translations (for developers)

1. Add the key to **both** `id.json` and `en.json` in the same path.
2. Use the key in JSX:

   ```tsx
   import { useTranslation } from 'react-i18next'
   const { t } = useTranslation()
   return <h1>{t('namespace.key')}</h1>
   ```

3. For `head()` meta tags (static context, no hook), import the i18n instance:

   ```tsx
   import i18n from '@/lib/i18n'
   head: () => ({ meta: [{ title: i18n.t('namespace.metaTitle') }] }),
   ```

4. For embedded markup, use `<Trans>`:

   ```tsx
   <Trans i18nKey="namespace.body" components={{ strong: <strong /> }} />
   ```

5. For arrays/lists:

   ```tsx
   const items = t('namespace.items', { returnObjects: true }) as string[]
   ```

6. Run `bun run --filter @vintra/web typecheck` and `node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/id.json','utf8'))"` to catch malformed JSON.

### Don't

- Don't conditionally call hooks (`condition ? useT() : ...`). Move conditional logic inside the hook.
- Don't put translations directly into `MEMORY.md` or markdown — only `id.json` and `en.json`.
- Don't translate technical identifiers (`pos_komplit_annual`, `on_keyword`).
- Don't change the placeholder names (`{{date}}`, `<emaillink>`) between locales.

---

## Testing locales

The user's locale preference is stored in `localStorage` under the key `jq-lang`. To test EN:

```js
// In the browser DevTools console
localStorage.setItem('jq-lang', 'en')
location.reload()
```

To reset:

```js
localStorage.removeItem('jq-lang')
location.reload()
```

If a UI locale switcher exists, it writes to the same key.

---

## File sizes (as of last update)

Both files are around 126 KB / 1,900+ lines. They're loaded at app startup as part of the JS bundle — keep them lean by avoiding redundant keys and consolidating shared phrases into the `common`, `nav`, or `validation` namespaces where appropriate.
