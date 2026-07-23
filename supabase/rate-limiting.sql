-- ============================================================================
-- Brew Beans — durable rate limiting for the PIN-guarded endpoints
-- ============================================================================
-- Run this once in the Supabase SQL editor, then redeploy the
-- staff-list-orders and update-order-status Edge Functions.
-- Safe to re-run.
--
-- WHY THIS EXISTS
-- The Edge Functions previously counted attempts in a module-level Map.
-- That does not work: Supabase runs each function in a V8 isolate that is
-- created and discarded around requests, so the Map is empty far more often
-- than not. Verified against the live project — 42 consecutive wrong-PIN
-- requests, from one IP, over both functions, produced zero 429s. The
-- limiter was decorative, which is worse than none, because it made the
-- 4-digit PIN look defended.
--
-- The counter has to live somewhere both isolates and the database agree
-- on, so it lives here. Each check is one round trip on a primary-key
-- upsert, which is cheap next to the bcrypt comparison it guards.
-- ============================================================================


-- The bucket key is "<endpoint>:<kind>:<ip>", assembled by the caller, so
-- one table serves every limit without a schema change per endpoint.
CREATE TABLE IF NOT EXISTS public.rate_limits (
    bucket    text        PRIMARY KEY,
    count     integer     NOT NULL DEFAULT 0,
    reset_at  timestamptz NOT NULL
);

-- Nothing but the RPC below touches this table, and that runs as its owner.
-- No grants to anon or authenticated on purpose: a client that could read
-- it would learn which IPs are being throttled, and one that could write it
-- could clear its own counter.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;


-- Returns true when the caller is still inside its budget.
--
-- The INSERT ... ON CONFLICT is a single atomic statement, so two requests
-- arriving together cannot both read the same count and each decide they
-- are the fifth. A read-then-write pair would let exactly that through, and
-- a brute-force script is precisely the workload that arrives in parallel.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
    p_bucket          text,
    p_max             integer,
    p_window_seconds  integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    INSERT INTO public.rate_limits AS rl (bucket, count, reset_at)
    VALUES (p_bucket, 1, now() + make_interval(secs => p_window_seconds))
    ON CONFLICT (bucket) DO UPDATE
        SET count = CASE
                        WHEN rl.reset_at <= now() THEN 1
                        ELSE rl.count + 1
                    END,
            reset_at = CASE
                        WHEN rl.reset_at <= now() THEN now() + make_interval(secs => p_window_seconds)
                        ELSE rl.reset_at
                    END
    RETURNING rl.count INTO v_count;

    -- Sweep expired rows occasionally rather than on every call. The table
    -- is keyed by IP and would otherwise grow without bound; doing it on
    -- roughly one call in two hundred keeps it small without putting a
    -- delete in the hot path.
    IF random() < 0.005 THEN
        DELETE FROM public.rate_limits WHERE reset_at < now() - interval '1 hour';
    END IF;

    RETURN v_count <= p_max;
END;
$$;

ALTER FUNCTION public.rate_limit_hit(text, integer, integer) OWNER TO postgres;

-- REVOKE FROM PUBLIC first — Postgres grants EXECUTE on every new function
-- to PUBLIC and anon inherits it. Skipping this would let anyone burn any
-- IP's budget, or their own, at will.
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;


-- ============================================================================
-- VERIFY — after redeploying both Edge Functions
-- ============================================================================
--   for i in $(seq 1 8); do
--     curl -s -o /dev/null -w "%{http_code} " -X POST \
--       "$URL/functions/v1/staff-list-orders" \
--       -H "apikey: $PUBLISHABLE" -H "Content-Type: application/json" \
--       -d '{"p_pin":"000000"}'
--   done
--   -> expect 401 x5 then 429 429 429, not eight 401s
-- ============================================================================
