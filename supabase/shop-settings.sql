-- Shop settings: the single row of business details the admin portal edits
-- and the public site reads. Run this once in the Supabase SQL editor.
--
-- Deliberately a single-row table rather than a key/value store: the fields
-- are a fixed, known set, so real columns give type checking, defaults and
-- readable queries. The id check keeps it to one row.

create table if not exists public.shop_settings (
    id                integer primary key default 1 check (id = 1),

    shop_name         text    not null default 'Brew Beans',
    logo_url          text,

    phone             text,
    whatsapp          text,
    email             text,
    address           text,
    maps_link         text,

    -- Social links. Null or empty means "hide this icon" on the public site.
    facebook_url      text,
    instagram_url     text,

    -- Not yet applied to order totals — see the note at the bottom.
    tax_percent       numeric(5,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
    currency_code     text    not null default 'PKR',
    currency_symbol   text    not null default 'Rs.',

    updated_at        timestamptz not null default now()
);

-- Seed the row with what is currently hardcoded in index.html, so nothing
-- on the live site changes the moment the public page starts reading this.
insert into public.shop_settings (
    id, shop_name, logo_url, phone, whatsapp, email, address, maps_link,
    facebook_url, instagram_url, tax_percent, currency_code, currency_symbol
) values (
    1,
    'Brew Beans',
    'img/brewbeans-logo.png',
    '+923112463092',
    '923112463092',
    'hello@brewbeans.pk',
    'Shop No. 6, Plot SB, Rab Medical Center, Block 2 Gulshan-e-Iqbal, Karachi, Pakistan',
    'https://www.google.com/maps/search/?api=1&query=Brew+Beans+Karachi',
    'https://www.facebook.com/brewbeanskhi/',
    'https://www.instagram.com/brewbeans.karachi/',
    0,
    'PKR',
    'Rs.'
)
on conflict (id) do nothing;

-- Keep updated_at honest without relying on the client to send it.
create or replace function public.touch_shop_settings()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists shop_settings_touch on public.shop_settings;
create trigger shop_settings_touch
    before update on public.shop_settings
    for each row execute function public.touch_shop_settings();

-- ── Grants ──
-- RLS policies decide which ROWS a role may touch; they do not grant the
-- privilege to touch the table at all. A table created from the SQL
-- editor starts with no grants to anon/authenticated, so without these
-- every request fails with 42501 "permission denied for table" before
-- any policy is even consulted.
grant select on public.shop_settings to anon, authenticated;
grant update on public.shop_settings to authenticated;

-- ── RLS ──
-- Anyone may read: the public site needs the phone number, address and
-- social links to render. Only a signed-in admin may write.
alter table public.shop_settings enable row level security;

drop policy if exists "shop_settings public read" on public.shop_settings;
create policy "shop_settings public read"
    on public.shop_settings for select
    to anon, authenticated
    using (true);

drop policy if exists "shop_settings admin update" on public.shop_settings;
create policy "shop_settings admin update"
    on public.shop_settings for update
    to authenticated
    using (true)
    with check (true);

-- ── Storage bucket for the logo ──
-- Public bucket, because the logo is rendered by anonymous visitors.
insert into storage.buckets (id, name, public)
values ('shop-assets', 'shop-assets', true)
on conflict (id) do nothing;

-- No SELECT policy on purpose. The bucket is public, so
-- /storage/v1/object/public/shop-assets/... serves the logo without
-- consulting RLS at all. A broad SELECT policy would add nothing for
-- that, and would let anyone LIST every file in the bucket.
drop policy if exists "shop-assets public read" on storage.objects;

drop policy if exists "shop-assets admin write" on storage.objects;
create policy "shop-assets admin write"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'shop-assets');

drop policy if exists "shop-assets admin update" on storage.objects;
create policy "shop-assets admin update"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'shop-assets');

drop policy if exists "shop-assets admin delete" on storage.objects;
create policy "shop-assets admin delete"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'shop-assets');

-- NOTE ON TAX
-- tax_percent is stored and editable but is NOT yet applied to order
-- totals. Order totals are recomputed server-side in the submit-order
-- edge function, which is the only place a tax line may be introduced —
-- adding it client-side would be ignored on submit and would make the
-- customer's total disagree with what is actually charged. Applying it
-- needs a tax_amount column on orders plus a change to that function.
