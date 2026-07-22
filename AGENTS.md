# Brew Beans — AGENTS.md

Static coffee shop site (HTML/CSS/JS + Bootstrap 5.3.2) with Supabase backend. Deployed on **Vercel**.

## Two projects at root

| Directory | Stack | Entry | Dev command |
|-----------|-------|-------|-------------|
| root (no `node_modules`) | HTML/CSS/JS + CDN deps | `index.html` | `npx serve .` or open directly via HTTP (not `file://`) |
| `brewbeans-next/` | Next.js 15 + React 18 + Supabase JS v2 | `brewbeans-next/app/` | `npm run dev`, `npm run build`, `npm run lint` |

**`Brew-Beans/`** is an outdated backup — ignore it. Edit only root or `brewbeans-next/`.

## Pages & JS (static site root)

| Page | JS | Purpose |
|------|----|---------|
| `index.html` | `js/main.js` | Customer: menu (`menuItems` array), cart, ordering, geolocation |
| `order-tracking.html` | `js/order-tracking.js` | Order status polling (10s) + browser notifications |
| `staff.html` | `js/staff.js` | PIN-protected staff dashboard, polls 15s |
| `admin.html` | inline script | Supabase Auth email/password login page |
| `admin-dashboard.html` | `js/admin-dashboard.js` | Full admin UI (Supabase Auth session) |
| `privacy-policy.html`, `terms.html` | none | Static legal pages |

**Shared**: `js/supabase-config.js` (global `supabaseClient`, shop TZ = `Asia/Karachi` via `getShopNow()`) on **all pages except `privacy-policy.html`/`terms.html`**. `js/scroll-fx.js` (AOS init + scroll progress bar) **only** on `order-tracking.html` and `staff.html`; index inits AOS inside `main.js`.

**Script load order** (no bundler — order matters):
```
Bootstrap JS → jQuery 3.7.1 → AOS 2.3.4 → Supabase JS v2 → supabase-config.js → page JS → [scroll-fx.js]
```

## Security headers

**`vercel.json` is the source of truth**. `_headers` is a legacy Netlify artifact — its CSP uses the **wrong Supabase URL** and lacks `wss://`. Keep both in sync when editing either.

When adding CDN scripts or inline `<script>` blocks, update CSP in both files. Payment gateway domains in `form-action`.

## Supabase

- Project ref: `rtqbpviegxwgaknmrrsg` — URL + anon key in `js/supabase-config.js`
- **Critical writes** go through Edge Functions (typecheck/Deno). Read-only queries use RPCs.

| Layer | Functions | Location |
|-------|-----------|----------|
| Edge Functions | `submit-order`, `update-order-status`, `create-payment`, `payment-callback` | `supabase/functions/*/index.ts` |
| RPCs (read/admin) | `get_order_status`, `staff_list_orders`, `get_business_hours` | Supabase DB only |

- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` env to bypass RLS. Deploy: `supabase functions deploy <name>`.
- `supabase/menu-seed.sql` — reseeds `menu_items`. `addon-seed.sql` — addon groups/options (idempotent).
- **Addons**: DB-driven (fetched live). `submit-order` re-validates addon prices server-side; client prices ignored.
- **Shop settings**: single-row `shop_settings` table (`id = 1`) — name, logo, phone, WhatsApp, email, address, maps link, socials, tax %, currency. Edited under Settings in the admin portal. Run `supabase/shop-settings.sql` once for the table, **grants**, RLS and the public `shop-assets` bucket. RLS alone is not enough — a table created from the SQL editor has no grants, so `grant select ... to anon` is required or every public read 42501s before any policy runs. `index.html` keeps real values hardcoded and overwrites them at runtime via `data-shop-*` attributes handled by `applyShopSettings()` in `js/main.js`, so a failed fetch still renders a complete page and new fields are markup-only. Uploaded logos come from Supabase Storage, so keep that origin in the CSP `img-src`. `tax_percent` is stored but **not** applied to totals yet — that belongs in `submit-order`.
- **Payments**: `create-payment` builds signed gateway forms; `payment-callback` verifies hash & updates `orders.payment_status`. Fallback to COD when merchant secrets unset. Go-live guide at `supabase/functions/PAYMENTS.md`.
- `_shared/jazzcash.ts` — HMAC-SHA256 signing for JazzCash requests and callback verification.

## Storage keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `brewBeansCart` | localStorage | Cart items keyed by product id; sanitized on read |
| `brewBeansLastCustomer` | localStorage | Returning customer profile |
| `brewBeansLastOrder` | localStorage | `{ orderNumber, phone }` for quick re-tracking |
| `brewBeansLocation` | localStorage | Cached `{ lat, lng }` from geolocation |
| `bbStaffPin` | sessionStorage | Staff PIN; cleared on logout |
| `bb_phone_${orderNumber}` | sessionStorage | Phone for tracking page (avoids URL exposure) |

## Order status flow

`placed` → `preparing` → `out_for_delivery` → `delivered`. `cancelled` from any state.

## Coding conventions

- 4-space indentation. JS: `camelCase`. CSS custom props: kebab-case under `:root`.
- XSS prevention: `escapeHtml()` or `innerText` throughout.
- Payment gateways: form redirects to sandbox domains; CSP `form-action` whitelists them.
- No automated tests — verify manually at desktop/mobile viewports.
