-- Inventory: raw ingredients and their stock levels.
-- Run once in the Supabase SQL editor.
--
-- Recipe deduction (an order consuming ingredients) is deliberately NOT
-- part of this. Stock only moves when someone changes it in the admin
-- portal.

create table if not exists public.ingredients (
    id             bigint generated always as identity primary key,
    name           text        not null,
    -- numeric, not integer: 1.5 L of milk is a normal thing to hold.
    current_stock  numeric(12,3) not null default 0 check (current_stock >= 0),
    unit           text        not null default 'pcs'
                   check (unit in ('L', 'ml', 'Kg', 'g', 'pcs')),
    -- The level at or below which the row is flagged Low Stock.
    min_stock      numeric(12,3) not null default 0 check (min_stock >= 0),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Milk" and "milk" are the same tin, and
-- letting both exist splits one ingredient's stock across two rows.
create unique index if not exists ingredients_name_unique
    on public.ingredients (lower(name));

create or replace function public.touch_ingredients()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists ingredients_touch on public.ingredients;
create trigger ingredients_touch
    before update on public.ingredients
    for each row execute function public.touch_ingredients();

-- ── Grants ──
-- RLS decides which rows a role may touch; it does not grant access to
-- the table. A table created from the SQL editor starts with no grants,
-- so without these every request fails with 42501 before any policy is
-- consulted.
--
-- No grant to anon on purpose. Stock levels are internal — the public
-- site has no reason to read them, and an anon grant would publish how
-- much of everything the shop has.
grant select, insert, update, delete on public.ingredients to authenticated;

-- ── RLS ──
alter table public.ingredients enable row level security;

drop policy if exists "ingredients admin all" on public.ingredients;
create policy "ingredients admin all"
    on public.ingredients for all
    to authenticated
    using (true)
    with check (true);

-- A few rows to start with. Safe to re-run — the unique index makes the
-- insert a no-op on a second pass.
insert into public.ingredients (name, current_stock, unit, min_stock) values
    ('Milk',              25,   'L',   10),
    ('Espresso Beans',    8,    'Kg',  3),
    ('Sugar',             15,   'Kg',  5),
    ('Chocolate Syrup',   4000, 'ml',  1000),
    ('Caramel Syrup',     2500, 'ml',  1000),
    ('Vanilla Syrup',     3000, 'ml',  1000),
    ('Whipped Cream',     6,    'L',   2),
    ('Paper Cups (12oz)', 400,  'pcs', 100),
    ('Paper Cups (16oz)', 250,  'pcs', 100),
    ('Cup Lids',          500,  'pcs', 150)
on conflict do nothing;

-- STATUS is derived, never stored:
--   current_stock <= 0          -> Out of Stock
--   current_stock <= min_stock  -> Low Stock
--   otherwise                   -> In Stock
-- Storing it would mean keeping a second copy of the truth in sync with
-- every stock change.
