-- RESET: deletes all orders, customers, messages, reviews, screenshots, expenses, products (with their photos/videos
-- records, colours, sizes, stock and cost prices), stock history and restock requests.
-- KEEPS: owner logins, bank details, delivery fees by state, shop settings.
-- Run once in the Supabase SQL Editor. This cannot be undone.
begin;
delete from public.reviews;
delete from public.testimonials;
delete from public.expenses;
delete from public.notify_requests;
delete from public.orders;          -- also removes order items and messages
delete from public.stock_log;
delete from public.products;        -- also removes variants, media and cost prices
alter table public.orders alter column order_no restart;
commit;
select 'products' as table_name, count(*) from public.products
union all select 'orders', count(*) from public.orders
union all select 'reviews', count(*) from public.reviews;
