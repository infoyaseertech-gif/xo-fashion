-- 005: per-order conversation between customer and business, customer cancel, and owner data deletion.
-- An order stays "open" until it is cancelled, or delivered AND every item has been reviewed.

alter table public.orders add column if not exists owner_read_at timestamptz;

create table if not exists public.order_messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  sender     text not null check (sender in ('customer', 'owner', 'system')),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages (order_id, created_at);
alter table public.order_messages enable row level security;
drop policy if exists order_messages_admin on public.order_messages;
create policy order_messages_admin on public.order_messages for select to authenticated using (public.is_admin());
revoke all on public.order_messages from anon, authenticated;
grant select on public.order_messages to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.order_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
  end if;
end $$;

-- open = not cancelled/expired, and not (delivered with every item reviewed)
create or replace function public.order_is_open(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select o.status not in ('cancelled', 'expired')
     and not (o.status = 'delivered' and not exists (
           select 1 from public.order_items i
            where i.order_id = o.id and not exists (select 1 from public.reviews r where r.order_item_id = i.id)))
    from public.orders o where o.id = p_order;
$$;

-- Automatic notes in the conversation whenever the order moves.
create or replace function public.order_status_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare by_customer boolean := coalesce(current_setting('app.by', true), '') = 'customer'; t text;
begin
  if new.status is not distinct from old.status then return new; end if;
  t := case new.status
    when 'paid'      then 'Payment received. We will pack your order next.'
    when 'packed'    then 'Your order is packed.'
    when 'shipped'   then 'Your order has been handed to delivery.' || coalesce(' Courier: ' || nullif(new.courier, '') || coalesce(' ' || new.tracking_no, ''), '')
    when 'delivered' then case when by_customer then 'The customer confirmed they received the order.' else 'The order was marked as delivered.' end
    when 'cancelled' then case when by_customer then 'The customer cancelled this order.' else 'The business cancelled this order.' end
    else null end;
  if t is not null then insert into public.order_messages (order_id, sender, body) values (new.id, 'system', t); end if;
  return new;
end $$;
drop trigger if exists orders_status_note on public.orders;
create trigger orders_status_note after update of status on public.orders
  for each row execute function public.order_status_note();

-- Customer writes to the business (needs the private order link).
create or replace function public.post_order_message(p_token uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_id uuid; b text := btrim(coalesce(p_body, ''));
begin
  select * into o from public.orders where public_token = p_token;
  if not found then raise exception 'not_found'; end if;
  if not public.order_is_open(o.id) then raise exception 'closed'; end if;
  if char_length(b) < 1 or char_length(b) > 1000 then raise exception 'bad_message'; end if;
  if (select count(*) from public.order_messages where order_id = o.id and sender = 'customer' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many';
  end if;
  insert into public.order_messages (order_id, sender, body) values (o.id, 'customer', b) returning id into v_id;
  return v_id;
end $$;

-- Customer cancels before the goods are handed to delivery.
create or replace function public.cancel_my_order(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if o.status not in ('awaiting_payment', 'needs_review', 'paid', 'packed') then raise exception 'not_cancellable'; end if;
  perform public.release_order_stock(o.id, 'cancelled');
  perform set_config('app.by', 'customer', true);
  update public.orders set status = 'cancelled', expires_at = null where id = o.id;
end $$;

create or replace function public.confirm_received(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if o.status = 'delivered' then return; end if;
  if o.status <> 'shipped' then raise exception 'not_shipped'; end if;
  perform set_config('app.by', 'customer', true);
  update public.orders set status = 'delivered' where id = o.id;
end $$;

create or replace function public.get_order(p_token uuid) returns jsonb
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
    'paid_at', o.paid_at, 'shipped_at', o.shipped_at, 'delivered_at', o.delivered_at,
    'is_open', public.order_is_open(o.id),
    'cancellable', o.status in ('awaiting_payment', 'needs_review', 'paid', 'packed'),
    'bank', case when o.status = 'awaiting_payment' and o.payment_method <> 'paystack'
                 then (select value from public.settings where key = 'bank') end,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('from', m.sender, 'text', m.body, 'at', m.created_at) order by m.created_at), '[]'::jsonb)
                   from public.order_messages m where m.order_id = o.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'item_id', i.id, 'name', i.product_name, 'colour', i.colour_name, 'size', i.size,
                'qty', i.qty, 'unit_price_ngn', i.unit_price_ngn,
                'reviewed', exists (select 1 from public.reviews r where r.order_item_id = i.id))), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id));
end $$;

-- Business side
create or replace function public.admin_post_message(p_order uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; b text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(b) < 1 or char_length(b) > 1000 then raise exception 'bad_message'; end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'not_found'; end if;
  insert into public.order_messages (order_id, sender, body) values (p_order, 'owner', b) returning id into v_id;
  update public.orders set owner_read_at = now() where id = p_order;
  return v_id;
end $$;

create or replace function public.admin_mark_read(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.orders set owner_read_at = now() where id = p_order;
end $$;

-- Owner-only deletion. Stock held by an order goes back on the shelf first.
create or replace function public.admin_delete_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'not_found'; end if;
  perform public.release_order_stock(p_order, 'deleted');
  delete from public.orders where id = p_order;
end $$;

create or replace function public.admin_delete_customer(p_phone text) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  for r in select id from public.orders where regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g') loop
    perform public.release_order_stock(r.id, 'deleted');
    delete from public.orders where id = r.id; n := n + 1;
  end loop;
  return n;
end $$;

-- scope: orders | reviews | expenses | products | all
create or replace function public.admin_clear_data(p_scope text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_scope not in ('orders', 'reviews', 'expenses', 'products', 'all') then raise exception 'bad_scope'; end if;
  if p_scope in ('orders', 'all') then
    for r in select id from public.orders loop perform public.release_order_stock(r.id, 'deleted'); end loop;
    delete from public.orders;
  end if;
  if p_scope in ('reviews', 'all') then delete from public.reviews; delete from public.testimonials; end if;
  if p_scope in ('expenses', 'all') then delete from public.expenses; end if;
  if p_scope in ('products', 'all') then
    if exists (select 1 from public.order_items) then raise exception 'delete_orders_first'; end if;
    delete from public.notify_requests; delete from public.stock_log; delete from public.products;
  end if;
end $$;

-- Privileges: nothing by default, then exactly what each role needs.
revoke all on function public.order_is_open(uuid), public.order_status_note(), public.post_order_message(uuid, text),
  public.cancel_my_order(uuid), public.confirm_received(uuid), public.get_order(uuid), public.admin_post_message(uuid, text),
  public.admin_mark_read(uuid), public.admin_delete_order(uuid), public.admin_delete_customer(text), public.admin_clear_data(text)
  from public, anon, authenticated;
grant execute on function public.post_order_message(uuid, text), public.cancel_my_order(uuid),
  public.confirm_received(uuid), public.get_order(uuid) to anon, authenticated;
grant execute on function public.admin_post_message(uuid, text), public.admin_mark_read(uuid), public.admin_delete_order(uuid),
  public.admin_delete_customer(text), public.admin_clear_data(text) to authenticated;
