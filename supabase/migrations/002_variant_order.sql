-- Keeps colours and sizes in the order the owner typed them.
alter table public.variants add column if not exists sort integer not null default 0;
