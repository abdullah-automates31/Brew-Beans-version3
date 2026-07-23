# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brew Beans is a coffee shop website with a Supabase backend, deployed on **Vercel**. The repo root holds two *separate* projects — edit the one relevant to your task, they don't share code:

| Directory | Stack | Entry point | Status |
|---|---|---|---|
| repo root | Static HTML/CSS/JS + CDN deps, no `node_modules` | `index.html` | **Active/deployed** site |
| `brewbeans-next/` | Next.js 15 + React 18 + Supabase JS v2 | `brewbeans-next/app/` | Rewrite-in-progress, not yet deployed |

**Ignore the nested `Brew-Beans/` subdirectory** — it's an outdated backup copy, distinct from both projects above.

An `AGENTS.md` at the repo root duplicates most of this file for non-Claude agents; keep the two in sync if either changes.

## Commands

**Root static site**: no build step. Open `index.html` directly, or serve it (`npx serve .` / VS Code Live Server) — use an HTTP server rather than `file://` for accurate CSP behavior during development. No automated test suite; verify changes manually at desktop and mobile viewports.

**`brewbeans-next/`** (run from inside that directory):
- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build (Turbopack)
- `npm start` — serve the production build
- `npm run lint` — Next.js lint

## Architecture

Everything below (through Payment Gateways) describes the **root static site**. `brewbeans-next/` has its own `app/`, `components/`, `context/`, and `lib/` directories following standard Next.js App Router conventions and is not covered here.

| Page | JS | Purpose |
|---|---|---|
| `index.html` | `js/main.js` | Customer-facing: menu (`menuItems` array), cart, ordering, geolocation |
| `order-tracking.html` | `js/order-tracking.js` | Order status polling (10 s) + browser notifications |
| `staff.html` | `js/staff.js` | PIN-protected staff dashboard, polls 15 s |
| `admin.html` | inline script | Supabase Auth email/password login page |
| `admin-dashboard.html` | `js/admin-dashboard.js` | Full admin UI (Supabase Auth session) |
| `privacy-policy.html`, `terms.html` | none | Static legal pages |

**Shared**: `js/supabase-config.js` (global `supabaseClient`) and `js/scroll-fx.js` (AOS init + scroll progress bar) on **all pages except `index.html`** (index skips `scroll-fx.js`; AOS is inited inside `main.js`).

**Script load order** (no bundler — order matters):
Bootstrap JS → jQuery 3.7.1 → AOS 2.3.4 → Supabase JS v2 → `supabase-config.js` → page-specific JS → [`scroll-fx.js`]

**Ignore the nested `Brew-Beans/` subdirectory** — it is an outdated backup copy of the project. Always edit files at the repo root.

## Key Patterns

**Menu data** lives in `js/main.js` as a hardcoded `menuItems` array (16 products with id, name, category, description, price, image). Changes to the menu require editing this array. The `menu-seed.sql` file can reseed the `menu_items` DB table if needed.

**Inventory** lives in the `ingredients` table, managed under Inventory in the admin portal (`supabase/inventory.sql` creates it). Stock **status is derived, never stored** — `<= 0` is Out of Stock, `<= min_stock` is Low Stock, otherwise In Stock — so there is no second copy of the truth to keep in sync. Name uniqueness is enforced case-insensitively via a `lower(name)` index, since "Milk" and "milk" splitting one ingredient's stock across two rows is the obvious failure. **Recipe deduction is not implemented**: stock only moves when someone edits it in the portal.

**Shop settings** (name, logo, phone, WhatsApp, email, address, Google Maps link, social URLs, tax %, currency) live in the single-row `shop_settings` table, edited under Settings in the admin portal. Run `supabase/shop-settings.sql` once to create the table, its **grants**, RLS policies and the public `shop-assets` storage bucket used for logo uploads. The grants matter: RLS decides which *rows* a role may touch but does not grant access to the table, and a table created from the SQL editor starts with none — without `grant select ... to anon` every public read fails with `42501` before any policy is consulted.

`index.html` keeps the real values hardcoded in the markup and overwrites them at runtime from the DB, so crawlers and a failed fetch both still get a complete page. Elements opt in via `data-shop-*` attributes (`-text`, `-href`, `-src`, `-alt`, `-tel`, `-mailto`, `-whatsapp`, `-social`, `-phone-text`) handled by `applyShopSettings()` in `js/main.js` — wiring a new field is a markup change, not a JS one. A `data-shop-social` element hides itself when its URL is empty. **Uploaded logos are served from Supabase Storage, so that origin must stay in the CSP `img-src`.**

`tax_percent` is stored and editable but is **not yet applied to order totals** — totals are recomputed server-side in `submit-order`, which is the only place a tax line may be added.

**Addon system** is split, and the two halves disagree. The admin portal manages `addon_groups`, `addons` and `menu_item_addon_groups` in the DB, and `submit-order` re-prices every addon by **name** against the `addons` table, silently dropping any it cannot find. But `index.html` does *not* read those tables — it renders the `LOCAL_ADDON_CATALOG` constant in `js/main.js`, keyed by menu category. Any priced option in that constant with no matching `addons` row is shown to the customer with a price and then charged as zero. Adding an addon means adding it in **both** places until one side is retired.

**Cart state** is persisted in `localStorage` (`brewBeansCart` key) with sanitization on read. The cart object stores items keyed by product id.

**Critical writes go through Supabase Edge Functions** (TypeScript/Deno at `supabase/functions/*/index.ts`) for server-side validation. Read-only queries use RPCs.

| Layer | Functions | Location |
|-------|-----------|----------|
| Edge Functions | `submit-order`, `update-order-status`, `create-payment`, `payment-callback`, `staff-list-orders` | `supabase/functions/*/index.ts` |
| RPCs (anon) | `get_order_status`, `get_business_hours`, `get_menu_badges`, `get_customer_orders` | Supabase DB only |
| RPCs (service_role only) | `verify_staff_pin` | Supabase DB only |

**Edge Functions** use the Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY` env) to bypass RLS. Deploy with: `supabase functions deploy <name>`. `_shared/` holds code imported by more than one function (`jazzcash.ts`, `rate-limit.ts`); relative `../_shared/x.ts` imports are bundled at deploy time.

**Polling intervals**: staff dashboard polls every 15 s; order tracking polls every 10 s. Neither uses Supabase Realtime subscriptions.

**Delivery charge** is calculated client-side using the Haversine formula against hardcoded shop coordinates (`24.9180°N, 67.0971°E`). ETA is estimated as 15 min prep + 25 min delivery (or 8 min for pickup when delivery charge = 0). Geolocation permission is requested via a modal shown 3 s after page load.

**Staff authentication** is PIN-based (not Supabase Auth) and the PIN is cached in `sessionStorage`. PINs are stored as bcrypt hashes — a `staff_pins_hash` trigger runs `crypt()`/`gen_salt('bf')` on insert and on any update that touches `pin`, so the admin dashboard can set a new PIN but can never reveal an existing one. Comparison happens only inside `verify_staff_pin()`, which is granted to `service_role` alone and called by the `staff-list-orders` and `update-order-status` Edge Functions. **When adding a SECURITY DEFINER function, `REVOKE EXECUTE ... FROM PUBLIC` before granting** — Postgres grants EXECUTE to PUBLIC on every new function and `anon` inherits it, so revoking from `anon` by name leaves the function wide open. The page is served with `X-Robots-Tag: noindex, nofollow`.

**RLS** is enabled on every table. `anon` may read only `menu_items`, `addon_groups`, `addons`, `menu_item_addon_groups`, `business_hours` and `shop_settings`, and may write nothing anywhere; `orders`, `order_items`, `order_item_addons`, `staff_pins` and `ingredients` are closed to it entirely. All `authenticated` policies are `USING (true)`, so signing up and being an admin are the same thing — this is only safe because signups are disabled on the project. Migrations live in `supabase/security-audit.sql`, then `supabase/pin-hashing.sql`, then `supabase/security-fixes-2.sql`, then `supabase/rate-limiting.sql`, **in that order**.

**Rate limiting** for the PIN-guarded Edge Functions is counted in the `rate_limits` table via the `rate_limit_hit()` RPC (service_role only), not in the function's memory. **Do not move it back into a module-level `Map`** — Supabase creates and discards a V8 isolate around requests, so in-process counters reset constantly; a previous version allowed 42 consecutive wrong PINs from one IP without a single 429. Two budgets per IP: 60 requests/min (staff share one shop IP and the dashboard polls every 15 s) and 5 wrong PINs/min. The limiter fails open if the RPC errors.

**Phone number privacy**: the customer's phone is stored in `sessionStorage` under the key `bb_phone_${orderNumber}` so it never appears in the browser history URL when returning from a payment gateway redirect.

**Order status flow**: `placed` → `preparing` → `out_for_delivery` → `delivered`. `cancelled` is reachable from any state. The `update-order-status` Edge Function enforces this enum; no other values are accepted.

## Browser Storage Keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `brewBeansCart` | localStorage | Cart items keyed by product id; sanitized on read |
| `brewBeansLastCustomer` | localStorage | Returning customer profile (name, phone, email, address, payment method, favorite items) |
| `brewBeansLastOrder` | localStorage | `{ orderNumber, phone }` for quick re-tracking |
| `brewBeansLocation` | localStorage | Cached `{ lat, lng }` from geolocation |
| `bbStaffPin` | sessionStorage | Cached staff PIN; cleared on logout |
| `bb_phone_${orderNumber}` | sessionStorage | Customer phone for tracking page; avoids exposing it in the URL |

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `menu_items` | Products (id, name, category, description, price, image, is_available, is_popular) |
| `addon_groups` | Addon groups (id, name, is_required) |
| `addons` | Addon options (id, group_id, name, price, is_available) |
| `menu_item_addon_groups` | Many-to-many join: menu items ↔ addon groups |
| `orders` | Order header (order_number, customer info, lat/lng, payment method/status, subtotal, delivery_charge, total, status) |
| `order_items` | Line items per order (menu_item_id, name snapshot, quantity, unit/total price) |
| `order_item_addons` | Addon selections per line item (addon_name, addon_price snapshots) |
| `staff_pins` | Staff PINs (name, pin 4–6 digits, is_active) |
| `business_hours` | Open/close times per day of week, is_closed flag |
| `ingredients` | Inventory: name, current_stock, unit (`L`/`ml`/`Kg`/`g`/`pcs`), min_stock. Authenticated-only — **no anon grant**, stock levels are internal. |
| `shop_settings` | Single row (`id = 1`): shop name, logo, contact details, maps link, social URLs, tax %, currency. Public read, authenticated write. |

## CSS

All styles are in `css/style.css`. Design tokens are CSS custom properties defined at `:root` (e.g., `--primary`, `--secondary`, `--text-*`). Bootstrap 5.3.2 handles the responsive grid; custom CSS overrides and extends it.

## Security Headers

`vercel.json` at the repo root is the **source of truth** (active deployment) and configures response headers including a strict CSP that whitelists specific CDN origins and inline script hashes. **When adding new external scripts or inline `<script>` blocks**, update the CSP in `vercel.json` accordingly — otherwise they will be blocked in production. All user-generated content rendered into the DOM uses `escapeHtml()` or `innerText` assignment to prevent XSS.

The `_headers` file is a legacy Netlify artifact kept for reference; keep it in sync with `vercel.json` when editing either. As of writing, `_headers` has drifted — its CSP `connect-src` points at the wrong Supabase project ref and is missing the `wss://` scheme needed for realtime/websocket connections — so don't treat it as authoritative.

## External Dependencies (CDN)

All loaded via CDN, no local `node_modules`:
- Bootstrap 5.3.2 + Bootstrap Icons 1.11.1
- jQuery 3.7.1
- AOS 2.3.4 (Animate On Scroll)
- Google Fonts: Poppins, Playfair Display
- Supabase JS client v2

## Payment Gateways

JazzCash and EasyPaisa are integrated via form redirects to their payment pages. The `create-payment` Edge Function builds the gateway form fields server-side. Both domains are whitelisted in the CSP `form-action` directive in `vercel.json`. The return URL lands on `order-tracking.html` with a `?payment=success|failed` query param.

## Coding Conventions (root static site)

4-space indentation for HTML/CSS/JS. JS identifiers use `camelCase`; CSS custom properties use kebab-case under `:root`.
