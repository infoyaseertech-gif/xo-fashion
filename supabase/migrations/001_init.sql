-- X and O backend: tables, access rules, ordering and stock logic.
-- Run once in the Supabase SQL editor, or as a migration with the Supabase CLI.
-- Money is stored in whole naira. Stock lives on the variant (colour + size).

---------------------------------------------------------------------------
-- 1. People who can run the shop
---------------------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'owner');
$$;

---------------------------------------------------------------------------
-- 2. Catalogue
---------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null check (char_length(name) between 2 and 120),
  category    text not null check (category in ('Jilbab', 'Hijab', 'Prayer hijab')),
  origin      text not null check (origin in ('Nigeria', 'Egypt')),
  description text not null default '',
  fabric_note text not null default '',
  price_ngn   integer not null check (price_ngn > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  colour_name text not null check (char_length(colour_name) between 1 and 40),
  colour_hex  text not null default '#d9a1b0' check (colour_hex ~* '^#[0-9a-f]{6}$'),
  size        text not null check (char_length(size) between 1 and 20),
  sku         text unique,
  stock       integer not null default 0 check (stock >= 0),
  price_ngn   integer check (price_ngn > 0),            -- optional per-variant price
  unique (product_id, colour_name, size)
);
create index variants_product_idx on public.variants (product_id);

create table public.media (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  colour_name text,                                     -- null = shown for every colour
  kind        text not null check (kind in ('image', 'video')),
  url         text not null check (url ~ '^https://'),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index media_product_idx on public.media (product_id, sort_order);

create table public.delivery_zones (
  state   text primary key,
  fee_ngn integer check (fee_ngn >= 0),                 -- null = owner confirms on WhatsApp
  days    integer check (days >= 0)
);

create table public.settings (
  key       text primary key,
  value     jsonb not null,
  is_public boolean not null default false
);

---------------------------------------------------------------------------
-- 3. Orders
---------------------------------------------------------------------------
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         bigint generated always as identity unique,
  public_token     uuid not null unique default gen_random_uuid(),   -- the customer's private tracking link
  status           text not null default 'awaiting_payment'
                   check (status in ('awaiting_payment','paid','packed','shipped','delivered','cancelled','expired','needs_review')),
  payment_method   text not null check (payment_method in ('paystack', 'transfer', 'whatsapp')),
  customer_name    text not null,
  phone            text not null,
  email            text,
  state            text not null references public.delivery_zones (state),
  address          text not null,
  subtotal_ngn     integer not null check (subtotal_ngn >= 0),
  delivery_fee_ngn integer check (delivery_fee_ngn >= 0),            -- null = to be confirmed
  total_ngn        integer not null check (total_ngn >= 0),
  paystack_ref     text unique,
  receipt_path     text,
  courier          text,
  tracking_no      text,
  stock_held       boolean not null default true,                    -- true while items are taken out of stock
  expires_at       timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index orders_status_idx on public.orders (status, created_at desc);

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  variant_id     uuid not null references public.variants (id),
  product_name   text not null,
  colour_name    text not null,
  size           text not null,
  qty            integer not null check (qty between 1 and 10),
  unit_price_ngn integer not null check (unit_price_ngn > 0)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.stock_log (
  id         bigint generated always as identity primary key,
  variant_id uuid not null references public.variants (id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  order_id   uuid,
  actor      uuid,
  created_at timestamptz not null default now()
);

create function public.log_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock is distinct from old.stock then
    insert into public.stock_log (variant_id, delta, reason, order_id, actor)
    values (new.id, new.stock - old.stock,
            coalesce(nullif(current_setting('app.reason', true), ''), 'manual'),
            nullif(current_setting('app.order_id', true), '')::uuid,
            auth.uid());
  end if;
  return new;
end $$;
create trigger variants_stock_log after update of stock on public.variants
  for each row execute function public.log_stock_change();

---------------------------------------------------------------------------
-- 4. Reviews and testimonials
---------------------------------------------------------------------------
create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  order_item_id uuid unique references public.order_items (id) on delete set null,
  reviewer_name text not null check (char_length(reviewer_name) between 1 and 60),
  stars         smallint not null check (stars between 1 and 5),
  comment       text not null check (char_length(comment) between 3 and 800),
  size_feedback text check (size_feedback in ('ran_small', 'true_to_size', 'ran_large')),
  approved      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index reviews_product_idx on public.reviews (product_id) where approved;

create table public.testimonials (
  id         uuid primary key default gen_random_uuid(),
  image_url  text not null check (image_url ~ '^https://'),
  caption    text,
  product_id uuid references public.products (id) on delete set null,
  approved   boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.notify_requests (                    -- "tell me when it is back"
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants (id) on delete cascade,
  phone      text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  created_at timestamptz not null default now(),
  unique (variant_id, phone)
);

---------------------------------------------------------------------------
-- 5. Stock helpers (internal)
---------------------------------------------------------------------------
create function public.reserve_order_stock(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; l record; cur integer;
begin
  select * into o from public.orders where id = p_order for update;
  if o.stock_held then return; end if;
  perform set_config('app.reason', 'reserve', true);
  perform set_config('app.order_id', p_order::text, true);
  for l in select variant_id, qty from public.order_items where order_id = p_order order by variant_id loop
    select stock into cur from public.variants where id = l.variant_id for update;
    if cur is null or cur < l.qty then raise exception 'out_of_stock:%', l.variant_id; end if;
    update public.variants set stock = stock - l.qty where id = l.variant_id;
  end loop;
  update public.orders set stock_held = true where id = p_order;
end $$;

create function public.release_order_stock(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not o.stock_held then return; end if;
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.order_id', p_order::text, true);
  update public.variants v set stock = v.stock + oi.qty
    from public.order_items oi where oi.order_id = p_order and oi.variant_id = v.id;
  update public.orders set stock_held = false where id = p_order;
end $$;

-- Puts unpaid orders whose hold ran out back into stock. Runs at every new order, so no scheduler is needed.
create function public.expire_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.orders
           where status = 'awaiting_payment' and expires_at is not null and expires_at < now()
           for update skip locked loop
    perform public.release_order_stock(r.id, 'expired');
    update public.orders set status = 'expired' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

---------------------------------------------------------------------------
-- 6. Customer-facing functions (no sign-in needed)
---------------------------------------------------------------------------
-- p_items:    [{"variant_id": "...", "qty": 2}]
-- p_customer: {"name": "...", "phone": "...", "email": "...", "state": "Kano", "address": "..."}
create function public.place_order(p_items jsonb, p_customer jsonb, p_payment_method text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_line     record;
  v_var      record;
  v_name     text := btrim(coalesce(p_customer ->> 'name', ''));
  v_phone    text := regexp_replace(coalesce(p_customer ->> 'phone', ''), '[\s\-()]', '', 'g');
  v_email    text := nullif(btrim(coalesce(p_customer ->> 'email', '')), '');
  v_state    text := btrim(coalesce(p_customer ->> 'state', ''));
  v_addr     text := btrim(coalesce(p_customer ->> 'address', ''));
  v_fee      integer;
  v_hold     integer;
  v_subtotal integer := 0;
begin
  perform public.expire_orders();

  if p_payment_method not in ('paystack', 'transfer', 'whatsapp') then raise exception 'bad_payment_method'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'bad_items'; end if;
  if jsonb_array_length(p_items) not between 1 and 20 then raise exception 'bad_items'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'bad_name'; end if;
  if v_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'bad_phone'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if char_length(v_addr) not between 8 and 300 then raise exception 'bad_address'; end if;
  if not exists (select 1 from public.delivery_zones where state = v_state) then raise exception 'bad_state'; end if;

  select fee_ngn into v_fee from public.delivery_zones where state = v_state;
  if p_payment_method = 'paystack' and v_fee is null then raise exception 'fee_unknown'; end if;

  select coalesce(
           (select (value #>> '{}')::integer from public.settings
             where key = case when p_payment_method = 'paystack' then 'hold_minutes_paystack' else 'hold_minutes_transfer' end),
           case when p_payment_method = 'paystack' then 30 else 180 end)
    into v_hold;

  insert into public.orders (payment_method, customer_name, phone, email, state, address,
                             subtotal_ngn, delivery_fee_ngn, total_ngn, expires_at)
  values (p_payment_method, v_name, v_phone, v_email, v_state, v_addr,
          0, v_fee, 0, now() + make_interval(mins => v_hold))
  returning * into v_order;

  perform set_config('app.reason', 'order', true);
  perform set_config('app.order_id', v_order.id::text, true);

  for v_line in
    select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'qty')::integer)::integer as qty
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if v_line.qty not between 1 and 10 then raise exception 'bad_qty'; end if;
    select v.id, v.stock, v.colour_name, v.size, coalesce(v.price_ngn, p.price_ngn) as price, p.name, p.active
      into v_var
      from public.variants v join public.products p on p.id = v.product_id
     where v.id = v_line.variant_id
       for update of v;
    if not found or not v_var.active then raise exception 'unavailable:%', v_line.variant_id; end if;
    if v_var.stock < v_line.qty then raise exception 'out_of_stock:%', v_line.variant_id; end if;

    update public.variants set stock = stock - v_line.qty where id = v_line.variant_id;
    insert into public.order_items (order_id, variant_id, product_name, colour_name, size, qty, unit_price_ngn)
    values (v_order.id, v_line.variant_id, v_var.name, v_var.colour_name, v_var.size, v_line.qty, v_var.price);
    v_subtotal := v_subtotal + v_var.price * v_line.qty;
  end loop;

  update public.orders
     set subtotal_ngn = v_subtotal, total_ngn = v_subtotal + coalesce(v_fee, 0)
   where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'token', v_order.public_token,
    'payment_method', v_order.payment_method,
    'subtotal_ngn', v_order.subtotal_ngn,
    'delivery_fee_ngn', v_order.delivery_fee_ngn,
    'fee_to_confirm', v_fee is null,
    'total_ngn', v_order.total_ngn,
    'expires_at', v_order.expires_at,
    'bank', case when p_payment_method <> 'paystack'
                 then (select value from public.settings where key = 'bank') end);
end $$;

-- The customer's tracking page: anyone holding the private token can read this one order.
create function public.get_order(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'order_id', o.id, 'order_no', o.order_no, 'status', o.status, 'payment_method', o.payment_method,
    'customer_name', o.customer_name, 'state', o.state,
    'subtotal_ngn', o.subtotal_ngn, 'delivery_fee_ngn', o.delivery_fee_ngn, 'total_ngn', o.total_ngn,
    'courier', o.courier, 'tracking_no', o.tracking_no, 'expires_at', o.expires_at,
    'receipt_uploaded', o.receipt_path is not null, 'created_at', o.created_at,
    'bank', case when o.status = 'awaiting_payment' and o.payment_method <> 'paystack'
                 then (select value from public.settings where key = 'bank') end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'item_id', i.id, 'name', i.product_name, 'colour', i.colour_name, 'size', i.size,
                'qty', i.qty, 'unit_price_ngn', i.unit_price_ngn)), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id));
end $$;

-- After uploading a transfer receipt to Storage at "<order_id>/<file>", the customer records it here.
create function public.attach_receipt(p_token uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if o.payment_method = 'paystack' or o.status not in ('awaiting_payment', 'expired') then raise exception 'not_allowed'; end if;
  if p_path not like o.id::text || '/%' or char_length(p_path) > 300 then raise exception 'bad_path'; end if;
  update public.orders
     set receipt_path = p_path,
         expires_at = case when status = 'awaiting_payment' then greatest(coalesce(expires_at, now()), now() + interval '24 hours') else expires_at end
   where id = o.id;
end $$;

-- A review is only accepted for a delivered order, once per item, and waits for the owner to approve it.
create function public.submit_review(p_token uuid, p_order_item uuid, p_stars integer, p_name text,
                                     p_comment text, p_size_feedback text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_product uuid; v_id uuid;
begin
  select v.product_id into v_product
    from public.order_items i
    join public.orders o on o.id = i.order_id
    join public.variants v on v.id = i.variant_id
   where i.id = p_order_item and o.public_token = p_token and o.status = 'delivered';
  if v_product is null then raise exception 'not_eligible'; end if;
  insert into public.reviews (product_id, order_item_id, reviewer_name, stars, comment, size_feedback)
  values (v_product, p_order_item, btrim(p_name), p_stars, btrim(p_comment), p_size_feedback)
  returning id into v_id;
  return v_id;
end $$;

create function public.request_restock_notice(p_variant uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notify_requests (variant_id, phone)
  values (p_variant, regexp_replace(p_phone, '[\s\-()]', '', 'g'))
  on conflict do nothing;
end $$;

---------------------------------------------------------------------------
-- 7. Owner functions (checked against admin_users)
---------------------------------------------------------------------------
create function public.admin_set_status(p_order uuid, p_status text,
                                        p_courier text default null, p_tracking text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  if not ((o.status, p_status) in (
        ('awaiting_payment','paid'), ('awaiting_payment','cancelled'),
        ('expired','paid'), ('expired','cancelled'),
        ('needs_review','paid'), ('needs_review','cancelled'),
        ('paid','packed'), ('paid','shipped'), ('paid','cancelled'),
        ('packed','shipped'), ('packed','cancelled'), ('shipped','delivered'))) then
    raise exception 'bad_transition:% -> %', o.status, p_status;
  end if;
  if p_status = 'paid' then perform public.reserve_order_stock(p_order); end if;
  if p_status = 'cancelled' then perform public.release_order_stock(p_order, 'cancelled'); end if;
  update public.orders
     set status = p_status,
         paid_at = case when p_status = 'paid' then now() else paid_at end,
         expires_at = case when p_status in ('paid', 'cancelled') then null else expires_at end,
         courier = coalesce(p_courier, courier),
         tracking_no = coalesce(p_tracking, tracking_no)
   where id = p_order;
end $$;

-- Called only by the Paystack webhook (service role).
create function public.confirm_paystack_payment(p_order_no bigint, p_reference text, p_amount_kobo bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where order_no = p_order_no for update;
  if not found then return 'order_not_found'; end if;
  if o.paystack_ref is distinct from p_reference then return 'reference_mismatch'; end if;
  if o.status in ('paid', 'packed', 'shipped', 'delivered') then return 'already_paid'; end if;
  if p_amount_kobo <> o.total_ngn::bigint * 100 then
    update public.orders set status = 'needs_review' where id = o.id;
    return 'amount_mismatch';
  end if;
  if o.status = 'awaiting_payment' then
    update public.orders set status = 'paid', paid_at = now(), expires_at = null where id = o.id;
    return 'paid';
  elsif o.status in ('expired', 'needs_review') then
    begin
      perform public.reserve_order_stock(o.id);
      update public.orders set status = 'paid', paid_at = now(), expires_at = null where id = o.id;
      return 'paid_after_expiry';
    exception when others then
      update public.orders set status = 'needs_review' where id = o.id;
      return 'needs_review';
    end;
  else
    update public.orders set status = 'needs_review' where id = o.id;
    return 'needs_review';
  end if;
end $$;

---------------------------------------------------------------------------
-- 8. Views for the dashboard and the storefront
---------------------------------------------------------------------------
create view public.product_ratings with (security_invoker = true) as
  select product_id, count(*)::integer as review_count, round(avg(stars), 1) as avg_stars
    from public.reviews where approved group by product_id;

create view public.low_stock with (security_invoker = true) as
  select p.name as product, v.colour_name, v.size, v.stock
    from public.variants v join public.products p on p.id = v.product_id
   where public.is_admin()
     and v.stock <= coalesce((select (value #>> '{}')::integer from public.settings where key = 'low_stock_threshold'), 5);

create view public.sales_daily with (security_invoker = true) as
  select (paid_at at time zone 'Africa/Lagos')::date as day, count(*)::integer as orders, sum(total_ngn)::integer as sales_ngn
    from public.orders
   where public.is_admin() and paid_at is not null and status not in ('cancelled', 'expired')
   group by 1;

create view public.best_sellers with (security_invoker = true) as
  select i.product_name, sum(i.qty)::integer as sold
    from public.order_items i join public.orders o on o.id = i.order_id
   where public.is_admin() and o.status in ('paid', 'packed', 'shipped', 'delivered')
   group by i.product_name;

---------------------------------------------------------------------------
-- 9. Row level security
---------------------------------------------------------------------------
alter table public.admin_users     enable row level security;
alter table public.products        enable row level security;
alter table public.variants        enable row level security;
alter table public.media           enable row level security;
alter table public.delivery_zones  enable row level security;
alter table public.settings        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.stock_log       enable row level security;
alter table public.reviews         enable row level security;
alter table public.testimonials    enable row level security;
alter table public.notify_requests enable row level security;

-- Everyone can browse the shop.
create policy products_read  on public.products       for select to anon, authenticated using (active or public.is_admin());
create policy variants_read  on public.variants       for select to anon, authenticated
  using (public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.active));
create policy media_read     on public.media          for select to anon, authenticated
  using (public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.active));
create policy zones_read     on public.delivery_zones for select to anon, authenticated using (true);
create policy settings_read  on public.settings       for select to anon, authenticated using (is_public or public.is_admin());
create policy reviews_read   on public.reviews        for select to anon, authenticated using (approved or public.is_admin());
create policy testimonials_read on public.testimonials for select to anon, authenticated using (approved or public.is_admin());

-- Only shop staff change things.
create policy products_admin     on public.products       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy variants_admin     on public.variants       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy media_admin        on public.media          for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy zones_admin        on public.delivery_zones for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_admin     on public.settings       for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy reviews_admin      on public.reviews        for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy testimonials_admin on public.testimonials   for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Orders, customers' details, stock history and restock requests are staff-only.
create policy orders_admin        on public.orders          for select to authenticated using (public.is_admin());
create policy order_items_admin   on public.order_items    for select to authenticated using (public.is_admin());
create policy stock_log_admin     on public.stock_log       for select to authenticated using (public.is_admin());
create policy notify_admin        on public.notify_requests for select to authenticated using (public.is_admin());
create policy admin_users_read    on public.admin_users     for select to authenticated using (public.is_admin());
create policy admin_users_owner   on public.admin_users     for all to authenticated using (public.is_owner()) with check (public.is_owner());

---------------------------------------------------------------------------
-- 10. Privileges: start from nothing, then grant only what each role needs
---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.products, public.variants, public.media, public.delivery_zones, public.settings,
                public.reviews, public.testimonials, public.product_ratings to anon, authenticated;
grant select on public.orders, public.order_items, public.stock_log, public.notify_requests, public.admin_users,
                public.low_stock, public.sales_daily, public.best_sellers to authenticated;
grant insert, update, delete on public.products, public.variants, public.media, public.delivery_zones,
                public.settings, public.reviews, public.testimonials, public.admin_users to authenticated;

grant execute on function public.is_admin(), public.is_owner() to anon, authenticated;
grant execute on function public.place_order(jsonb, jsonb, text),
                          public.get_order(uuid),
                          public.attach_receipt(uuid, text),
                          public.submit_review(uuid, uuid, integer, text, text, text),
                          public.request_restock_notice(uuid, text) to anon, authenticated;
grant execute on function public.admin_set_status(uuid, text, text, text) to authenticated;
grant execute on function public.confirm_paystack_payment(bigint, text, bigint) to service_role;

---------------------------------------------------------------------------
-- 11. File storage
---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-media', 'product-media', true, 52428800,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']),
  ('receipts', 'receipts', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy media_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'product-media' and public.is_admin())
  with check (bucket_id = 'product-media' and public.is_admin());
create policy receipts_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$');
create policy receipts_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

---------------------------------------------------------------------------
-- 12. Starting data (no products: the owner adds the real ones)
---------------------------------------------------------------------------
insert into public.delivery_zones (state) values
  ('Abia'),('Adamawa'),('Akwa Ibom'),('Anambra'),('Bauchi'),('Bayelsa'),('Benue'),('Borno'),('Cross River'),
  ('Delta'),('Ebonyi'),('Edo'),('Ekiti'),('Enugu'),('FCT Abuja'),('Gombe'),('Imo'),('Jigawa'),('Kaduna'),
  ('Kano'),('Katsina'),('Kebbi'),('Kogi'),('Kwara'),('Lagos'),('Nasarawa'),('Niger'),('Ogun'),('Ondo'),
  ('Osun'),('Oyo'),('Plateau'),('Rivers'),('Sokoto'),('Taraba'),('Yobe'),('Zamfara');

insert into public.settings (key, value, is_public) values
  ('hold_minutes_paystack', '30',            false),
  ('hold_minutes_transfer', '180',           false),
  ('low_stock_threshold',   '5',             true),
  ('return_days',           '14',            true),
  ('whatsapp',              '"2349093813119"', true),
  ('bank',                  '{"bank":"","account_name":"","account_number":""}', false);

-- Live stock on the product page: let the storefront subscribe to stock changes.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.variants;
  end if;
end $$;
