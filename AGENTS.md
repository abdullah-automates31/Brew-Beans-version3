# Brew Beans — AGENTS.md

Two projects at root; the **other** `Brew-Beans/` dir is a stale backup — ignore it.

| Project | Stack | Entry | Dev cmd (from its dir) |
|---------|-------|-------|------------------------|
| root | HTML/CSS/JS + CDN, no bundler | `index.html` | `npx serve .` (needs HTTP, not `file://`) |
| `brewbeans-next/` | Next.js 15 + React 18 + Supabase JS v2 | `brewbeans-next/app/` | `npm run dev` / `build` / `lint` |

No automated tests in either project — verify at desktop + mobile viewports.

---

## Root static site — pages & JS

| Page | JS | Notes |
|------|----|-------|
| `index.html` | `js/main.js` | Hardcoded `menuItems` array (16 items); cart, ordering, geolocation |
| `order-tracking.html` | `js/order-tracking.js` | Polls every 10 s |
| `staff.html` | `js/staff.js` | PIN-based auth (verified via Edge Function `staff-list-orders`), polls 15 s |
| `admin.html` | inline script only | Supabase Auth email/password login |
| `admin-dashboard.html` | `js/admin-dashboard.js` | Full admin UI (inline `<style>`, loads Chart.js) |
| `privacy-policy.html`, `terms.html` | none | Static legal pages |

**Shared**: `js/supabase-config.js` (global `supabaseClient`, shop TZ = `Asia/Karachi` via `getShopNow()`) on all pages except `privacy-policy.html`/`terms.html`. `js/scroll-fx.js` (AOS init + scroll progress bar) on `order-tracking.html` and `staff.html` only; index.html inits AOS inside `main.js`. Admin pages (`admin.html`, `admin-dashboard.html`) have **no** scroll-fx, AOS, jQuery, or Motion.

**Script load order** (no bundler — matters when adding CDN scripts):
```
Bootstrap JS → jQuery 3.7.1 → AOS 2.3.4 → Motion 12.42.2 → Supabase JS v2 → supabase-config.js → page JS → [scroll-fx.js]
```
`motion@12.42.2` is loaded on all customer-facing pages. `admin.html` loads only `supabase-config.js` + inline script (no Bootstrap JS/jQuery/AOS/Motion/scroll-fx).

---

## Security headers

**`vercel.json` = source of truth** (active deployment). `_headers` is a legacy Netlify artifact — keep both in sync. When adding CDN scripts or inline `<script>` blocks, update CSP in both files. CSP `img-src` must include `https://rtqbpviegxwgaknmrrsg.supabase.co` (Supabase Storage for logo uploads). Payment gateway sandbox domains in `form-action`.

---

## Supabase

**Project**: `rtqbpviegxwgaknmrrsg` — URL + anon key in `js/supabase-config.js`.  
**Critical writes → Edge Functions** (TypeScript/Deno, use `SUPABASE_SERVICE_ROLE_KEY`). Read-only queries → RPCs.

| Edge Functions | `submit-order`, `update-order-status`, `create-payment`, `payment-callback`, `staff-list-orders` |
|---|---|---|
| RPCs | `get_order_status`, `get_business_hours`, `get_customer_orders` (anon), `verify_staff_pin` (service_role only) |
| Deploy | `supabase functions deploy <name>` |

Key patterns:
- **Addons**: DB-driven. `submit-order` re-validates addon prices server-side; client prices ignored.
- **Inventory** (`ingredients` table): authenticated-only, no anon grant. Status derived (`<=0` Out, `<= min_stock` Low, else In). Recipe deduction **not implemented**.
- **Shop settings** (`shop_settings`, id=1): single-row, editable via admin portal. `index.html` hardcodes fallback values, overwrites via `data-shop-*` attributes (`applyShopSettings()` in `main.js`). Run `supabase/shop-settings.sql` to create table + grants + RLS + storage bucket. **Grants required** — RLS alone 42501s. `tax_percent` stored but not yet applied to totals.
- **Payments**: `create-payment` builds signed gateway forms; `payment-callback` verifies hash. Falls back to COD when merchant secrets unset. Guide: `supabase/functions/PAYMENTS.md`.
- **Staff auth**: PIN-based (not Supabase Auth), verified via Edge Function `staff-list-orders` (service role key), cached in `sessionStorage` (`bbStaffPin`). PINs stored as bcrypt hash (pgcrypto `crypt()`/`gen_salt('bf')` via `staff_pins_hash` trigger). Admin dashboard cannot reveal existing PINs — only set new ones.

---

## Browser storage keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `brewBeansCart` | localStorage | Cart items by product id; sanitized on read |
| `brewBeansLastCustomer` | localStorage | Returning customer profile |
| `brewBeansLastOrder` | localStorage | `{ orderNumber, phone }` for re-tracking |
| `brewBeansLocation` | localStorage | Cached `{ lat, lng }` from geolocation |
| `bbStaffPin` | sessionStorage | Staff PIN; cleared on logout |
| `bb_phone_${orderNumber}` | sessionStorage | Phone for tracking (avoids URL exposure) |

---

## Order status flow

`placed` → `preparing` → `out_for_delivery` → `delivered`. `cancelled` from any state.

---

## Coding conventions

- 4-space indent, JS `camelCase`, CSS custom props kebab-case under `:root`.
- XSS: `escapeHtml()` or `innerText` throughout.
- Payment gateways: form redirects to sandbox domains; CSP `form-action` whitelists.
- No test suite — verify manually.
