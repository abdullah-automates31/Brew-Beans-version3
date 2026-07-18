# Brew Beans — AGENTS.md

Static coffee shop site (HTML/CSS/JS + Bootstrap 5.3.2) with Supabase backend. Deployed on **Vercel**. No build step, no `node_modules`.

## Pages & JS

| Page | JS | Purpose |
|------|----|---------|
| `index.html` | `js/main.js` | Customer: menu (`menuItems` array), cart, ordering, geolocation |
| `order-tracking.html` | `js/order-tracking.js` | Order status polling (10s) + browser notifications |
| `staff.html` | `js/staff.js` | PIN-protected staff dashboard, polls 15s |
| `admin.html` | inline script | Supabase Auth email/password login page |
| `admin-dashboard.html` | `js/admin-dashboard.js` | Full admin UI (Supabase Auth session) |
| `privacy-policy.html`, `terms.html` | none | Static legal pages |

**Shared**: `js/supabase-config.js` (global `supabaseClient`) and `js/scroll-fx.js` (AOS init + scroll progress bar) on **all pages except `index.html`** (index skips `scroll-fx.js`; AOS is inited inside `main.js`).

Script load order (no bundler — order matters):
```
Bootstrap JS → jQuery 3.7.1 → AOS 2.3.4 → Supabase JS v2 → supabase-config.js → page JS → [scroll-fx.js]
```

## Dev

Open any `.html` directly or run `npx serve .` / VS Code Live Server. Use an HTTP server to test CSP behavior (not `file://`).

## Security headers

**`vercel.json` is the source of truth** (active deployment). `_headers` is a legacy Netlify artifact; keep it in sync if editing either. The `_headers` CSP is stale (wrong Supabase URL, missing `wss://`).

When adding external CDN scripts or inline `<script>` blocks, update CSP in both `vercel.json` and `_headers`.

## Supabase

**Critical writes go through Edge Functions** (TypeScript/Deno) for server-side validation. Read-only queries use RPCs.

| Layer | Functions | Location |
|-------|-----------|----------|
| Edge Functions | `submit-order`, `update-order-status`, `create-payment` | `supabase/functions/*/index.ts` |
| RPCs (read/admin) | `get_order_status`, `staff_list_orders`, `get_business_hours` | Supabase DB only |

**Edge Functions** use the service-role key (set via `SUPABASE_SERVICE_ROLE_KEY` env) to bypass RLS. Deploy with `supabase functions deploy <name>`.

Supabase URL/anon key in `js/supabase-config.js`. Keep anon key client-safe; never put service-role key in browser JS. `menu-seed.sql` has the DB seed for the menu table.

## Key state & storage

- Cart: `localStorage` key `brewBeansCart` (sanitized on read)
- Staff PIN: `sessionStorage` key `bbStaffPin`
- Customer phone: `sessionStorage` key `bb_phone_${orderNumber}`
- Delivery ETA: 15 min prep + 25 min delivery (8 min pickup). Haversine formula with shop at `24.9180°N, 67.0971°E`.

## Coding

- 4-space indentation for HTML/CSS/JS
- JS: `camelCase`; CSS custom properties: kebab-case under `:root`
- Prefer existing Bootstrap classes and CSS vars (`--primary`, `--secondary`, `--font-primary`) before adding new patterns
- XSS prevention: `escapeHtml()` or `innerText` assignment throughout
- Payment gateways (JazzCash, EasyPaisa): form redirects to sandbox domains, whitelisted in CSP `form-action`

## Avoid

- Do not edit the nested `Brew-Beans/` directory (outdated backup copy)
- No automated test framework — verify changes manually at desktop/mobile viewports
