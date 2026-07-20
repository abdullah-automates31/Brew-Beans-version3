# Brew Beans — AGENTS.md

Static coffee shop site (HTML/CSS/JS + Bootstrap 5.3.2) with Supabase backend. Deployed on **Vercel**.

## Two projects at root

| Directory | Stack | Entry | Dev command |
|-----------|-------|-------|-------------|
| root (no `node_modules`) | HTML/CSS/JS + CDN deps | `index.html` | `npx serve .` or open directly |
| `brewbeans-next/` | Next.js 15 + React 18 + Supabase JS v2 | `brewbeans-next/app/` | `npm run dev` (turbopack) |

Edit the correct one. `Brew-Beans/` (nested) and `brewbeans-next/` are distinct projects — the first is an outdated backup, the second is a Next.js rewrite-in-progress. Neither is the "active" static site.

## Pages & JS (static site root)

| Page | JS | Purpose |
|------|----|---------|
| `index.html` | `js/main.js` | Customer: menu (`menuItems` array), cart, ordering, geolocation |
| `order-tracking.html` | `js/order-tracking.js` | Order status polling (10s) + browser notifications |
| `staff.html` | `js/staff.js` | PIN-protected staff dashboard, polls 15s |
| `admin.html` | inline script | Supabase Auth email/password login page |
| `admin-dashboard.html` | `js/admin-dashboard.js` | Full admin UI (Supabase Auth session) |
| `privacy-policy.html`, `terms.html` | none | Static legal pages |

**Shared**: `js/supabase-config.js` (global `supabaseClient`) and `js/scroll-fx.js` (AOS init + scroll progress bar) on **all pages except `index.html`** (index skips `scroll-fx.js`; AOS is inited inside `main.js`).

**Script load order** (no bundler — order matters):
```
Bootstrap JS → jQuery 3.7.1 → AOS 2.3.4 → Supabase JS v2 → supabase-config.js → page JS → [scroll-fx.js]
```

## CDN deps (no `node_modules`)
Bootstrap 5.3.2 + Icons 1.11.1, jQuery 3.7.1, AOS 2.3.4, Google Fonts (Poppins, Playfair Display), Supabase JS v2.

## Security headers

**`vercel.json` is the source of truth** (active deployment). `_headers` is a legacy Netlify artifact — its CSP uses a **wrong Supabase URL** (`uomaumlqblvaukalaqei.supabase.co` vs `rtqbpviegxwgaknmrrsg.supabase.co`) and is missing `wss://`. Keep both in sync if editing either.

When adding external CDN scripts or inline `<script>` blocks, update CSP in both files.

## Supabase

- Project ref: `rtqbpviegxwgaknmrrsg` — URL and anon key in `js/supabase-config.js`
- **Critical writes** go through Edge Functions (TypeScript/Deno) for server-side validation. Read-only queries use RPCs.

| Layer | Functions | Location |
|-------|-----------|----------|
| Edge Functions | `submit-order`, `update-order-status`, `create-payment` | `supabase/functions/*/index.ts` |
| RPCs (read/admin) | `get_order_status`, `staff_list_orders`, `get_business_hours` | Supabase DB only |

- **Edge Functions** use `SUPABASE_SERVICE_ROLE_KEY` env to bypass RLS. Deploy: `supabase functions deploy <name>`.
- `menu-seed.sql` — reseeds `menu_items` table. `addon-seed.sql` — populates addon groups/options (idempotent).
- **Addon system** is DB-driven (fetched live). The `submit-order` Edge Function re-validates addon prices — client-side addon prices are ignored.

## Key state & storage

- `localStorage`: `brewBeansCart` (sanitized on read), `brewBeansLastCustomer`, `brewBeansLastOrder`, `brewBeansLocation`
- `sessionStorage`: `bbStaffPin` (staff PIN), `bb_phone_${orderNumber}` (customer phone, avoids URL exposure)
- Delivery ETA: 15 min prep + 25 min delivery (8 min pickup). Haversine formula with shop at `24.9180°N, 67.0971°E`.

## Order status flow

`placed` → `preparing` → `out_for_delivery` → `delivered`. `cancelled` from any state. Enforced by the `update-order-status` Edge Function.

## Coding

- 4-space indentation for HTML/CSS/JS. JS: `camelCase`. CSS custom props: kebab-case under `:root`.
- XSS prevention: `escapeHtml()` or `innerText` throughout.
- Payment gateways (JazzCash, EasyPaisa): form redirects to sandbox domains, whitelisted in CSP `form-action`.
- No automated tests — verify manually at desktop/mobile viewports.
