# X and O (XNO Fashion): website + backend

Modest-wear showcase and shop for X and O (Kaduna): product photos and videos, live stock by colour and size,
reviews from real buyers, and ordering by bank transfer, card (Paystack) or WhatsApp.

```
web/        the website (plain HTML/CSS/JS, no build step)  -> deploy to Vercel / Netlify / any static host
supabase/   database, security rules, storage, Paystack edge functions
tests/      SQL tests, backend unit test, browser test
```

## How it works
- The site has separate pages (Home, Shop, About, Customer love, Delivery and returns, Contact, Cart, Privacy), reached by links like `#/shop`. Works on any static host with no server setup.
- With `web/config.js` empty, the site runs in **demo mode** (sample products, orders go to WhatsApp). Good for design review.
- With your Supabase URL and anon key in `web/config.js`, it runs **live**: products, stock, orders and reviews come from the database.
- Stock is reserved when an order is placed (card: 30 min, transfer/WhatsApp: 3 h) and goes back automatically if unpaid.
- Prices are always computed in the database. Customers cannot read orders; the owner signs in (the **Login** button).

## Go live (about 30 minutes)
1. **Supabase**: create a project. SQL Editor: run `supabase/migrations/001_init.sql`, then `002_variant_order.sql`, then `003_profit_records.sql` (cost prices and expenses; owner-only), then `004_delivery_and_reviews.sql` (customer confirms receipt, then reviews), then `005_messages_and_cleanup.sql` (order conversation, customer cancel, owner deletion). `supabase/reset_test_data.sql` wipes all test data once (keeps logins, bank details and delivery fees).
2. Authentication -> Users -> Add user (the owner's email and password). Then in SQL Editor:
   `insert into admin_users(user_id, role) values ('<that user id>', 'owner');`
3. `web/config.js`: paste the project URL and the anon/publishable key (Project Settings -> API). Never the service_role key.
4. Deploy `web/` to Vercel (Import repo, Root Directory = `web`, no build command).
5. Open the site, **Login** (header, phone tab bar or footer, `#/admin`). The **Dashboard** has: Overview (sales, orders, customers, low stock, 14-day chart), Products (add/edit with photo and video upload), Orders (search, filter, mark paid/packed/shipped/delivered, view receipts, cancel), Customers, Stock (levels, movement log, restock requests), Reviews (approve), Profit (sales, cost, gross and net profit, monthly table, profit per product, expenses), Delivery and payment, Reports (CSV downloads). Give each product a cost price so profit is exact; upload several photos and videos per product and set the cover and order. Start in Delivery and payment: save bank details and delivery fees.
6. Database -> Extensions: enable `pg_cron`, then run: `select cron.schedule('expire-orders','*/5 * * * *','select public.expire_orders()');`
7. **Card payments (optional)**: Paystack account -> test keys, then
   `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_... SITE_URL=https://your-site ALLOWED_ORIGIN=https://your-site`
   `supabase functions deploy paystack-init --no-verify-jwt` and `supabase functions deploy paystack-webhook --no-verify-jwt`
   Paystack dashboard -> Settings -> API: Webhook URL = `https://<project>.supabase.co/functions/v1/paystack-webhook`.
   Then set `cardPayments: true` in `web/config.js`. Test a full order in test mode before using live keys.
8. Auth -> URL configuration: set Site URL to your domain.

## Tests
- `tests/run.sh` needs a Postgres with `tests/stub.sql` + the two migrations applied (32 checks: stock, holds, expiry, permissions, reviews).
- `node tests/backend-unit.js`, `node tests/web.e2e.js` (needs playwright).
All passing when this was packaged. NOT tested against a live Supabase or Paystack, and not on a real phone: do a full test order after step 7.

## Before launch
Owner phone test (photo/video upload on mobile data), lawyer review of the privacy and terms text (NDPR), Supabase plan limits for video storage, and a real domain.
