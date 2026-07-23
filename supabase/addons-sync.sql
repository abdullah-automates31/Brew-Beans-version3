-- ============================================================================
-- Brew Beans — make the addons table charge what the customer is shown
-- ============================================================================
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- WHY
-- The customer page renders LOCAL_ADDON_CATALOG (hardcoded in js/main.js),
-- but submit-order re-prices every addon by NAME against this table and
-- drops any it cannot find. Two ways that went wrong:
--
--   1. Eight priced options existed only in the catalog, with no row here,
--      so they were shown with a price and then charged as zero.
--   2. Five more had a row here at a DIFFERENT price than the page showed —
--      Colombian Supremo displayed Rs.120 but charged Rs.180, so the
--      customer was billed more than the amount they agreed to.
--
-- The rule is that the customer pays what they were shown, so this file
-- brings the table into line with the displayed (catalog) prices. If any of
-- these prices should actually be higher, raise them in BOTH places — the
-- catalog in js/main.js and here — or the mismatch simply comes back.
--
-- NOTE: this does not fix the split itself. The page still reads the
-- hardcoded catalog, not this table; a new priced option added to the
-- catalog without a matching row here will be charged zero again. The
-- durable fix is to make the page read addons from the DB and retire the
-- constant.
-- ============================================================================

-- ── Part 1: the eight that were charged zero ──
-- Placed in the "Extras" group. submit-order matches on name alone, so the
-- group only affects how they are listed in the admin portal, not pricing.
INSERT INTO public.addons (group_id, name, price, is_available)
SELECT g.id, v.name, v.price, true
FROM (VALUES
    ('Extra Espresso Shot', 60),
    ('Vanilla Syrup',       50),
    ('Caramel Syrup',       50),
    ('Hazelnut Syrup',      50),
    ('Chocolate Syrup',     50),
    ('Cinnamon Powder',     30),
    ('Chocolate Powder',    40),
    ('Marshmallows',        70)
) AS v(name, price)
CROSS JOIN (
    SELECT id FROM public.addon_groups WHERE name = 'Extras' LIMIT 1
) AS g
-- Idempotent: skip any name that already exists, so a second run is a no-op.
WHERE NOT EXISTS (
    SELECT 1 FROM public.addons a WHERE a.name = v.name
);

-- ── Part 2: the five priced differently than the page shows ──
-- Match by name (verified unique in this table). Each target is the price
-- the customer actually sees in LOCAL_ADDON_CATALOG.
UPDATE public.addons SET price = 120 WHERE name = 'Colombian Supremo' AND price <> 120;
UPDATE public.addons SET price =  60 WHERE name = 'Extra Shot'        AND price <>  60;
UPDATE public.addons SET price =  70 WHERE name = 'Oat Milk'          AND price <>  70;
UPDATE public.addons SET price =  90 WHERE name = 'Almond Milk'       AND price <>  90;
UPDATE public.addons SET price =  80 WHERE name = 'Soy Milk'          AND price <>  80;


-- ============================================================================
-- VERIFY — every priced catalog option should now exist here at its shown price
-- ============================================================================
--   select name, price, is_available from public.addons
--   where name in ('Extra Espresso Shot','Vanilla Syrup','Caramel Syrup',
--     'Hazelnut Syrup','Chocolate Syrup','Cinnamon Powder','Chocolate Powder',
--     'Marshmallows','Colombian Supremo','Extra Shot','Oat Milk',
--     'Almond Milk','Soy Milk')
--   order by name;
-- ============================================================================
