-- ============================================================================
-- Brew Beans — corrections to security-audit.sql + pin-hashing.sql
-- ============================================================================
-- Run this once in the Supabase SQL editor, after the other two.
-- Safe to re-run. The source files have been corrected too, so a fresh
-- project built from them does not need this — it exists to repair a
-- database that already had the earlier versions applied.
-- ============================================================================


-- ============================================================================
-- FIX 1 (critical): verify_staff_pin was callable by anon
-- ============================================================================
-- Postgres grants EXECUTE on every new function to PUBLIC. The original
-- migration revoked it from `anon, authenticated` by name, which leaves the
-- PUBLIC grant in place — and anon inherits PUBLIC. Confirmed against the
-- live project: POST /rest/v1/rpc/verify_staff_pin with the publishable key
-- returned 200.
--
-- That made every other PIN control decorative. Hashing, the service-role
-- Edge Function and the edge rate limiter all sit in front of a door that
-- was standing open beside them: anyone could ask the database directly
-- whether a PIN is valid, as fast as they liked. A 4-digit PIN is 10,000
-- guesses.

REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_staff_pin(text) TO service_role;


-- ============================================================================
-- FIX 2: pin the search_path on both SECURITY DEFINER functions
-- ============================================================================
-- A SECURITY DEFINER function runs with its owner's privileges. Without a
-- fixed search_path, a caller who can create objects in a schema earlier in
-- that path can substitute their own `crypt` or `staff_pins`.
--
-- `extensions` has to be in the list. Supabase installs pgcrypto there, not
-- in public, so pinning the path to public alone puts crypt() and
-- gen_salt() out of reach — every PIN check then fails with "function
-- crypt(text, text) does not exist", which takes staff login down. An
-- earlier revision of this file made exactly that mistake.

ALTER FUNCTION public.verify_staff_pin(text)     SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_customer_orders(text)  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.hash_staff_pin()           SET search_path = public, extensions, pg_temp;


-- ============================================================================
-- FIX 3: drop the pg_sleep throttle out of get_customer_orders
-- ============================================================================
-- The 0.5 s sleep was meant as rate limiting, but it holds a pooler
-- connection for its entire duration. A few hundred concurrent calls with
-- the publishable key exhaust the connection pool and take the site down —
-- it traded availability for a delay an attacker can simply parallelise
-- around. Throttling belongs at the edge, where it costs no connection.

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  result json;
BEGIN
  WITH limited AS (
    SELECT * FROM public.orders
    WHERE phone = p_phone
    ORDER BY created_at DESC
    LIMIT 5
  )
  SELECT json_agg(
    json_build_object(
      'id', o.id,
      'customer_name', o.customer_name,
      'email', o.email,
      'payment_method', o.payment_method,
      'order_number', o.order_number,
      'status', o.status,
      'total', o.total,
      'created_at', o.created_at,
      'items', COALESCE((
        SELECT json_agg(json_build_object(
          'menu_item_id', oi.menu_item_id,
          'menu_item_name', oi.menu_item_name,
          'quantity', oi.quantity
        ))
        FROM public.order_items oi WHERE oi.order_id = o.id
      ), '[]'::json)
    )
    ORDER BY o.created_at DESC
  )
  FROM limited o
  INTO result;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

ALTER FUNCTION public.get_customer_orders(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_customer_orders(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;


-- ============================================================================
-- FIX 4: re-assert that anon cannot reach orders / order_items
-- ============================================================================
-- Belt and braces. These are already revoked on the live project (verified:
-- both return 42501 to the publishable key), but the earlier
-- security-audit.sql granted them and called itself safe to re-run, so
-- state this last and explicitly.

REVOKE ALL ON public.orders      FROM anon;
REVOKE ALL ON public.order_items FROM anon;
DROP POLICY IF EXISTS "orders anon select"      ON public.orders;
DROP POLICY IF EXISTS "order_items anon select" ON public.order_items;


-- ============================================================================
-- VERIFY — all three should come back denied / empty
-- ============================================================================
--   curl -s -X POST "$URL/rest/v1/rpc/verify_staff_pin" \
--     -H "apikey: $PUBLISHABLE" -H "Content-Type: application/json" \
--     -d '{"p_pin":"1234"}'
--   -> expect 404 PGRST202 (not visible to anon), NOT 200
--
--   curl -s "$URL/rest/v1/orders?select=*" -H "apikey: $PUBLISHABLE"
--   -> expect 42501 permission denied
-- ============================================================================
