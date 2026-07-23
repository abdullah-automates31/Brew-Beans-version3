-- ============================================================================
-- Brew Beans — get_order_status: return what the tracking page actually reads
-- ============================================================================
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- WHAT WAS WRONG
-- The tracking page (js/order-tracking.js) reads order.payment_method,
-- order.created_at, order.subtotal, order.delivery_charge, order.total and
-- order.items — it has since the first commit. But the live RPC only
-- returned status, payment_status and a precomputed "estimated" the page
-- never reads. Every other field came back undefined, so the page showed
-- "undefined — Payment Pending", "Estimated ready by Invalid Date" and
-- "Rs. undefined".
--
-- The RPC is the right place to fix this: the page has no anon SELECT on
-- orders or order_items (both are revoked), so this SECURITY DEFINER
-- function is its only way to read an order — and it must stay that way.
--
-- SECURITY, unchanged from the previous version:
--   • Two-factor lookup — the caller must supply BOTH the order number and
--     the matching phone. Neither is guessable from the other.
--   • Returns NULL when they do not match, revealing nothing about whether
--     the order number or the phone was the wrong one.
--   • SECURITY DEFINER with a pinned search_path, granted to anon only,
--     revoked from PUBLIC first.
-- ============================================================================

-- Signature changes (TABLE -> json), so the old one has to go first.
DROP FUNCTION IF EXISTS public.get_order_status(text, text);

CREATE FUNCTION public.get_order_status(p_order_number text, p_phone text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'order_number',    o.order_number,
    'status',          o.status,
    'payment_method',  o.payment_method,
    'payment_status',  o.payment_status,
    'created_at',      o.created_at,
    'subtotal',        o.subtotal,
    'delivery_charge', o.delivery_charge,
    'total',           o.total,
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        -- The page reads item.name; the column is menu_item_name.
        'name',        oi.menu_item_name,
        'quantity',    oi.quantity,
        'unit_price',  oi.unit_price,
        'total_price', oi.total_price
      ) ORDER BY oi.id)
      FROM public.order_items oi
      WHERE oi.order_id = o.id
    ), '[]'::json)
  )
  INTO result
  FROM public.orders o
  WHERE o.order_number = p_order_number
    AND o.phone = p_phone;

  -- NULL, not an error object: the page treats a null result as "not found"
  -- and says so without disclosing which of the two values was wrong.
  RETURN result;
END;
$$;

ALTER FUNCTION public.get_order_status(text, text) OWNER TO postgres;

-- PUBLIC first — Postgres grants EXECUTE to PUBLIC on every new function and
-- anon inherits it; revoking anon by name alone would leave it reachable.
REVOKE EXECUTE ON FUNCTION public.get_order_status(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_order_status(text, text) TO anon, authenticated;


-- ============================================================================
-- VERIFY (use a real order number + its phone)
-- ============================================================================
--   curl -s -X POST "$URL/rest/v1/rpc/get_order_status" \
--     -H "apikey: $PUBLISHABLE" -H "Content-Type: application/json" \
--     -d '{"p_order_number":"BB...","p_phone":"+92..."}'
--   -> expect an object with payment_method, subtotal, total, created_at
--      and an items array; wrong phone -> null.
-- ============================================================================
