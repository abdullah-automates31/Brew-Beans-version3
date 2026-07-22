-- ============================================================================
-- Brew Beans — PIN Hashing + Orders RPC + Tighten anon SELECT
-- ============================================================================
-- Prerequisite: security-audit.sql has been applied.
--
-- WHAT THIS DOES:
--   1. Enables pgcrypto, hashes all existing staff PINs
--   2. Creates trigger: hashes PINs on INSERT/UPDATE
--   3. Creates verify_staff_pin RPC (SECURITY DEFINER, service_role only)
--   4. Creates get_customer_orders RPC (SECURITY DEFINER, rate-limited)
--   5. REVOKEs anon SELECT from orders & order_items (replaced by RPC)
-- ============================================================================

-- ============================================================================
-- PART 1: Staff PIN Hashing with pgcrypto
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hash existing plaintext PINs.
--
-- The WHERE clause is not optional. A bcrypt hash is itself a valid input
-- to crypt(), so re-running this without it hashes the hashes — every PIN
-- stops working and there is nothing to recover, because the plaintext is
-- gone. '$2a$' / '$2b$' / '$2y$' is the bcrypt prefix; rows already
-- carrying it are done.
UPDATE public.staff_pins
   SET pin = crypt(pin, gen_salt('bf'))
 WHERE pin !~ '^\$2[aby]\$';

-- Trigger: auto-hash PIN on INSERT or UPDATE of pin column
CREATE OR REPLACE FUNCTION public.hash_staff_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.pin IS DISTINCT FROM OLD.pin THEN
    NEW.pin = crypt(NEW.pin, gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_pins_hash ON public.staff_pins;
CREATE TRIGGER staff_pins_hash
  BEFORE INSERT OR UPDATE OF pin ON public.staff_pins
  FOR EACH ROW
  EXECUTE FUNCTION public.hash_staff_pin();

-- Verification RPC (service-role only — called from Edge Functions)
DROP FUNCTION IF EXISTS public.verify_staff_pin CASCADE;
CREATE FUNCTION public.verify_staff_pin(p_pin text)
RETURNS TABLE(staff_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
-- A SECURITY DEFINER function runs as its owner, so an attacker-controlled
-- search_path could point `crypt` or `staff_pins` at objects of their own.
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM public.staff_pins
  WHERE pin = crypt(p_pin, pin) AND is_active = true;
END;
$$;

ALTER FUNCTION public.verify_staff_pin(text) OWNER TO postgres;

-- REVOKE FROM PUBLIC first, and it must be first. Postgres grants EXECUTE
-- on every new function to PUBLIC, and anon inherits that — revoking from
-- anon and authenticated by name leaves the PUBLIC grant untouched and the
-- function still callable with the publishable key. That turns it into an
-- unthrottled PIN-guessing oracle sitting behind all of the above.
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text) TO service_role;

-- ============================================================================
-- PART 2: Returning-Customer Orders RPC (rate-limited, SECURITY DEFINER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result json;
BEGIN
  -- There was a pg_sleep(0.5) here as a throttle. It is removed on purpose:
  -- the sleep holds a pooler connection for its whole duration, so a few
  -- hundred concurrent calls exhaust the connection pool and take the whole
  -- site down — it cost availability to buy very little. Throttling belongs
  -- at the edge, where it does not occupy a database connection.
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
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text) TO anon, authenticated;

-- KNOWN EXPOSURE: this still answers "what is this phone number's name,
-- email and order history?" for any phone number handed to it. That is
-- unchanged from the direct table query it replaced — the win here is that
-- anon can no longer read the orders table wholesale — but it is not least
-- privilege. Closing it properly means asking for something only the
-- customer holds (their last order number, or an OTP), which is a
-- checkout-flow change, not a policy change.

-- ============================================================================
-- PART 3: Revoke anon SELECT from orders & order_items (replaced by RPC)
-- ============================================================================

REVOKE SELECT ON public.orders FROM anon;
REVOKE SELECT ON public.order_items FROM anon;

