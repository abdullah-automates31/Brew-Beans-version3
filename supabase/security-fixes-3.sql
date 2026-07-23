-- ============================================================================
-- Brew Beans — hotfix: restore crypt() to the PIN functions' search_path
-- ============================================================================
-- Run this once in the Supabase SQL editor, after security-fixes-2.sql.
-- Safe to re-run. security-fixes-2.sql has been corrected too, so a fresh
-- project built from these files never hits the bug — this exists to repair
-- a database that already ran the broken revision.
-- ============================================================================

-- WHAT BROKE
-- security-fixes-2.sql pinned `search_path = public, pg_temp` on the
-- SECURITY DEFINER functions. That is the right instinct — an unpinned
-- search_path lets a caller substitute their own crypt() or staff_pins —
-- but the list was wrong: Supabase installs pgcrypto into the `extensions`
-- schema, not `public`. With `extensions` missing, crypt() and gen_salt()
-- became unreachable and every PIN check failed with
--
--     function crypt(text, text) does not exist
--
-- which returned 500 from staff-list-orders and update-order-status. Staff
-- could not log in and could not move an order's status.
--
-- `extensions` goes after `public` so a public object still wins the name
-- resolution, keeping the substitution protection the pin was added for.

ALTER FUNCTION public.verify_staff_pin(text)     SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.hash_staff_pin()           SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_customer_orders(text)  SET search_path = public, extensions, pg_temp;


-- ============================================================================
-- VERIFY
-- ============================================================================
--   for i in $(seq 1 8); do
--     curl -s -o /dev/null -w "%{http_code} " -X POST \
--       "$URL/functions/v1/staff-list-orders" \
--       -H "apikey: $PUBLISHABLE" -H "Content-Type: application/json" \
--       -d '{"p_pin":"000000"}'
--   done
--   -> expect 401 x5 then 429 429 429.
--      500 means crypt() is still unreachable.
--      Then log in with a real PIN to confirm staff auth works again.
-- ============================================================================
