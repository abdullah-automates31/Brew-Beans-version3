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

-- Hash existing plaintext PINs
UPDATE public.staff_pins SET pin = crypt(pin, gen_salt('bf'));

-- Trigger: auto-hash PIN on INSERT or UPDATE of pin column
CREATE OR REPLACE FUNCTION public.hash_staff_pin()
RETURNS trigger
LANGUAGE plpgsql
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
AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM public.staff_pins
  WHERE pin = crypt(p_pin, pin) AND is_active = true;
END;
$$;

ALTER FUNCTION public.verify_staff_pin(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin TO service_role;
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin FROM anon, authenticated;

-- ============================================================================
-- PART 2: Returning-Customer Orders RPC (rate-limited, SECURITY DEFINER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  PERFORM pg_sleep(0.5);
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
GRANT EXECUTE ON FUNCTION public.get_customer_orders TO anon;

-- ============================================================================
-- PART 3: Revoke anon SELECT from orders & order_items (replaced by RPC)
-- ============================================================================

REVOKE SELECT ON public.orders FROM anon;
REVOKE SELECT ON public.order_items FROM anon;

