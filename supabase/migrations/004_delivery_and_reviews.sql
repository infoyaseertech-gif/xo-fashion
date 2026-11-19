-- 004: customer confirms receipt; tracking page shows delivery progress and which items are already reviewed.

alter table public.orders add column if not exists shipped_at   timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;

-- Stamp the times whenever the status changes (by the owner or by the customer).
create or replace function public.stamp_order_times() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'shipped'   and old.status is distinct from 'shipped'   then new.shipped_at   := coalesce(new.shipped_at, now()); end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  return new;
end $$;
drop trigger if exists orders_stamp_times on public.orders;
create trigger orders_stamp_times before update on public.orders
  for each row execute function public.stamp_order_times();

-- The customer taps "I have received my order". Only a shipped order can be confirmed.
create or replace function public.confirm_received(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if o.status = 'delivered' then return; end if;
  if o.status <> 'shipped' then raise exception 'not_shipped'; end if;
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
    'bank', case when o.status = 'awaiting_payment' and o.payment_method <> 'paystack'
                 then (select value from public.settings where key = 'bank') end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'item_id', i.id, 'name', i.product_name, 'colour', i.colour_name, 'size', i.size,
                'qty', i.qty, 'unit_price_ngn', i.unit_price_ngn,
                'reviewed', exists (select 1 from public.reviews r where r.order_item_id = i.id))), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id));
end $$;

revoke all on function public.confirm_received(uuid) from public, anon, authenticated;
grant execute on function public.confirm_received(uuid) to anon, authenticated;
