-- ============================================================================
-- Brew Beans — Security Audit & Hardening Migration
-- ============================================================================
-- Run this in the Supabase SQL Editor for project rtqbpviegxwgaknmrrsg
--
-- WHAT THIS DOES (idempotent — safe to run more than once):
--   1. Enables RLS on every table that lacks it
--   2. Creates explicit GRANT statements for every table
--   3. Creates secure RLS policies matching the application's access patterns
--   4. Secures the `staff_list_orders` RPC against PIN brute-forcing
--   5. Creates proper RPC definitions for undocumented functions
--   6. Adds security comments for future improvements
--
-- ⚠️  READ BEFORE APPLYING:
--   Each section is labeled. Review with the Supabase dashboard open.
--   The current site will CONTINUE to work after this migration.
--   Some policies are intentionally permissive (anon SELECT) to match
--   existing functionality — future improvements are noted.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Remove dangerous anon grants (explicit revoke, then re-grant)
-- ============================================================================
-- 🔍 FINDING: `staff_pins` table is readable by ANON — any visitor can dump
--    all staff PINs using the publishable anon key.
-- 🔧 FIX: Revoke all from anon, keep only authenticated.
-- ⚠️  This WILL NOT break the site — the public pages never read staff_pins.

-- First ensure RLS is enabled, then restrict
ALTER TABLE IF EXISTS public.staff_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_pins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_pins TO authenticated;

-- RLS: Only authenticated users can access staff_pins
DROP POLICY IF EXISTS "staff_pins authenticated all" ON public.staff_pins;
CREATE POLICY "staff_pins authenticated all"
    ON public.staff_pins
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 2: Secure orders table
-- ============================================================================
-- 🔍 FINDING: `orders` had anon SELECT — anyone with the anon key could query
--    orders by any phone number, or dump the table outright.
-- 🔧 FIX: Enable RLS and give anon nothing. The returning-customer lookup
--    now goes through the get_customer_orders RPC (see pin-hashing.sql),
--    so the client no longer needs to touch this table at all.
--
-- ⚠️  DO NOT re-add a grant or policy for anon here. An earlier revision of
--    this file kept `GRANT SELECT ... TO anon` to avoid breaking the site;
--    that predates the RPC, and re-running it now silently undoes the
--    revoke in pin-hashing.sql and re-opens the whole table.

ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;

-- Explicit grants
REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.orders TO authenticated;
-- No INSERT or DELETE to any Supabase role — writes go through service-role
-- Edge Functions (submit-order). This is correct.

DROP POLICY IF EXISTS "orders anon select" ON public.orders;

-- Authenticated (admin): full read + status updates
DROP POLICY IF EXISTS "orders authenticated select" ON public.orders;
CREATE POLICY "orders authenticated select"
    ON public.orders
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "orders authenticated update" ON public.orders;
CREATE POLICY "orders authenticated update"
    ON public.orders
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 3: Secure order_items table
-- ============================================================================
-- 🔍 FINDING: `order_items` had anon SELECT — linked to the orders exposure.
-- 🔧 FIX: Same pattern as orders — anon gets nothing, the RPC serves the
--    returning-customer lookup. The same "do not re-add anon" warning applies.

ALTER TABLE IF EXISTS public.order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_items FROM anon, authenticated;
GRANT SELECT ON public.order_items TO authenticated;
-- Writes only through service-role Edge Functions.

DROP POLICY IF EXISTS "order_items anon select" ON public.order_items;

DROP POLICY IF EXISTS "order_items authenticated select" ON public.order_items;
CREATE POLICY "order_items authenticated select"
    ON public.order_items
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================================
-- SECTION 4: Secure order_item_addons table
-- ============================================================================
-- 🔍 FINDING: `order_item_addons` has anon SELECT — no reason for anon to
--    read addon prices on historical orders.
-- 🔧 FIX: Restrict to authenticated only.
-- ⚠️  The current site does NOT query this table from the client — safe to
--    revoke anon SELECT.

ALTER TABLE IF EXISTS public.order_item_addons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_item_addons FROM anon;
GRANT SELECT ON public.order_item_addons TO authenticated;

DROP POLICY IF EXISTS "order_item_addons authenticated select" ON public.order_item_addons;
CREATE POLICY "order_item_addons authenticated select"
    ON public.order_item_addons
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================================
-- SECTION 5: Secure menu_items table
-- ============================================================================
-- NOTE: This table likely already has RLS, but we ensure it.
-- Public (anon) can read. Only authenticated can write.

ALTER TABLE IF EXISTS public.menu_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.menu_items FROM anon, authenticated;
GRANT SELECT ON public.menu_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;

DROP POLICY IF EXISTS "menu_items anon select" ON public.menu_items;
CREATE POLICY "menu_items anon select"
    ON public.menu_items
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "menu_items authenticated all" ON public.menu_items;
CREATE POLICY "menu_items authenticated all"
    ON public.menu_items
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 6: Secure addon_groups table
-- ============================================================================
-- Public: can read. Admin: full CRUD.

ALTER TABLE IF EXISTS public.addon_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.addon_groups FROM anon, authenticated;
GRANT SELECT ON public.addon_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addon_groups TO authenticated;

DROP POLICY IF EXISTS "addon_groups anon select" ON public.addon_groups;
CREATE POLICY "addon_groups anon select"
    ON public.addon_groups
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "addon_groups authenticated all" ON public.addon_groups;
CREATE POLICY "addon_groups authenticated all"
    ON public.addon_groups
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 7: Secure addons table
-- ============================================================================
-- Same pattern: anon reads, authenticated writes.

ALTER TABLE IF EXISTS public.addons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.addons FROM anon, authenticated;
GRANT SELECT ON public.addons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addons TO authenticated;

DROP POLICY IF EXISTS "addons anon select" ON public.addons;
CREATE POLICY "addons anon select"
    ON public.addons
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "addons authenticated all" ON public.addons;
CREATE POLICY "addons authenticated all"
    ON public.addons
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 8: Secure menu_item_addon_groups table
-- ============================================================================

ALTER TABLE IF EXISTS public.menu_item_addon_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.menu_item_addon_groups FROM anon, authenticated;
GRANT SELECT ON public.menu_item_addon_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_addon_groups TO authenticated;

DROP POLICY IF EXISTS "menu_item_addon_groups anon select" ON public.menu_item_addon_groups;
CREATE POLICY "menu_item_addon_groups anon select"
    ON public.menu_item_addon_groups
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "menu_item_addon_groups authenticated all" ON public.menu_item_addon_groups;
CREATE POLICY "menu_item_addon_groups authenticated all"
    ON public.menu_item_addon_groups
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 9: Secure business_hours table
-- ============================================================================
-- NOTE: No SQL exists in repo for this table. We create the grants + RLS here.

ALTER TABLE IF EXISTS public.business_hours ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_hours FROM anon, authenticated;
GRANT SELECT ON public.business_hours TO anon;
GRANT SELECT, UPDATE ON public.business_hours TO authenticated;

DROP POLICY IF EXISTS "business_hours anon select" ON public.business_hours;
CREATE POLICY "business_hours anon select"
    ON public.business_hours
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "business_hours authenticated update" ON public.business_hours;
CREATE POLICY "business_hours authenticated update"
    ON public.business_hours
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 10: Secure shop_settings (re-confirm)
-- ============================================================================
-- Already done in shop-settings.sql, but re-applying here for completeness.
-- Idempotent — RLS policies are dropped and re-created.

ALTER TABLE IF EXISTS public.shop_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shop_settings FROM anon, authenticated;
GRANT SELECT ON public.shop_settings TO anon, authenticated;
GRANT UPDATE ON public.shop_settings TO authenticated;

DROP POLICY IF EXISTS "shop_settings anon select" ON public.shop_settings;
CREATE POLICY "shop_settings anon select"
    ON public.shop_settings
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "shop_settings authenticated update" ON public.shop_settings;
CREATE POLICY "shop_settings authenticated update"
    ON public.shop_settings
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 11: Secure ingredients (re-confirm)
-- ============================================================================
-- Already done in inventory.sql. Re-applying for completeness.
-- No anon access — stock levels are internal.

ALTER TABLE IF EXISTS public.ingredients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ingredients FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredients TO authenticated;

DROP POLICY IF EXISTS "ingredients authenticated all" ON public.ingredients;
CREATE POLICY "ingredients authenticated all"
    ON public.ingredients
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- SECTION 12: RPC SECURITY — staff_list_orders
-- ============================================================================
-- 🔍 FINDING: `staff_list_orders` was executable by ANON — anyone could
--    brute-force PINs. The `staff-list-orders` Edge Function now handles
--    this server-side using the service role key.
-- 🔧 FIX: Drop the RPC entirely — replaced by the `staff-list-orders` Edge
--    Function which uses the service role key server-side.

DROP FUNCTION IF EXISTS public.staff_list_orders CASCADE;

-- ============================================================================
-- SECTION 13: ⚠️  RPC SECURITY — get_order_status
-- ============================================================================
-- 🔍 FINDING: This RPC is executable by anon. It requires both order_number
--    and phone, which provides some protection (two-factor query).
-- ✅ LOW RISK: Requires knowledge of both order number and phone to look up.
--    The return is limited to order status info, not full PII.
-- No change needed.

-- ============================================================================
-- SECTION 14: ⚠️  AUTH CONFIGURATION
-- ============================================================================
-- 🔍 FINDING (config.toml):
--   enable_signup = true      — Anyone can sign up via the Auth API
--   enable_confirmations = false  — No email confirmation required
--   minimum_password_length = 6  — Very weak
--
-- ⚠️  RISK: every `authenticated` policy in this file is `USING (true)`,
--    because the admin dashboard is the only thing that signs in. That
--    makes "can sign up" and "is an admin" the same thing — anyone who
--    could create an account would get the full dashboard's database
--    access. There is no admin role to check against.
--
-- ✅ VERIFIED on the live project: /auth/v1/settings reports
--    "disable_signup": true, so no new accounts can be created. This is
--    what holds the whole authenticated tier up — if signups are ever
--    re-enabled, these policies must gain a real role check first.
--
-- Remaining dashboard hardening (config.toml is local dev only):
--   • Set minimum password length to 8+
--   • Consider enabling captcha
--   https://supabase.com/dashboard/project/rtqbpviegxwgaknmrrsg/auth/providers

-- ============================================================================
-- SECTION 15: ⚠️  STAFF PINS — Plaintext storage
-- ============================================================================
-- ✅ RESOLVED in supabase/pin-hashing.sql — PINs are bcrypt-hashed by a
--    trigger and compared only through verify_staff_pin(), which is granted
--    to service_role alone. Both Edge Functions call that RPC instead of
--    reading the table.
--
-- ⚠️  RUN ORDER: this file first, then pin-hashing.sql. pin-hashing.sql
--    tightens what this file sets up; running them the other way round
--    leaves anon holding SELECT on orders.

-- ============================================================================
-- SECTION 16: ✅  Storage bucket permissions (verification)
-- ============================================================================
-- The `shop-assets` bucket is public (for logo serving) with authenticated-only
-- write. This is correct. No changes needed.

-- ============================================================================
-- SECTION 17: ✅  Edge Functions — Server-side operations
-- ============================================================================
-- The following operations correctly use service-role key (bypass RLS):
--   • submit-order    → writes orders, order_items, order_item_addons
--   • update-order-status → updates orders (PIN-validated)
--   • create-payment  → builds payment gateway forms (no DB writes)
--   • payment-callback → updates payment_status on orders
-- ✅ No changes needed.

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
