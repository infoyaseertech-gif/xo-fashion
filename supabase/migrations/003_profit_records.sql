-- 003: profit and business records (owner-only data)
-- Cost prices live in their own table so they can never be read by shoppers.

create table if not exists public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost_ngn   integer not null check (cost_ngn >= 0)
);

-- Cost of each piece at the time it was sold, so later price changes never rewrite history.
alter table public.order_items add column if not exists unit_cost_ngn integer;

create or replace function public.set_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_cost_ngn is null then
    select pc.cost_ngn into new.unit_cost_ngn
      from public.variants v join public.product_costs pc on pc.product_id = v.product_id
     where v.id = new.variant_id;
  end if;
  return new;
end $$;
drop trigger if exists order_items_cost on public.order_items;
create trigger order_items_cost before insert on public.order_items
  for each row execute function public.set_item_cost();

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  spent_on   date not null default current_date,
  category   text not null check (category in ('Fabric and stock','Packaging','Delivery','Marketing','Rent and utilities','Salaries','Other')),
  note       text not null default '',
  amount_ngn integer not null check (amount_ngn > 0),
  created_at timestamptz not null default now()
);
create index if not exists expenses_day_idx on public.expenses (spent_on desc);

alter table public.product_costs enable row level security;
alter table public.expenses      enable row level security;
drop policy if exists product_costs_owner on public.product_costs;
drop policy if exists expenses_owner on public.expenses;
create policy product_costs_owner on public.product_costs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy expenses_owner      on public.expenses      for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.product_costs, public.expenses from anon, authenticated;
grant select, insert, update, delete on public.product_costs, public.expenses to authenticated;
