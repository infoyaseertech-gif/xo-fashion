// POST { token: "<order public_token>" }  ->  { authorization_url, reference }
// The amount ALWAYS comes from the database, never from the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (await req.json().catch(() => ({})))?.token;
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "bad_token" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: o } = await db.from("orders")
    .select("id, order_no, status, payment_method, total_ngn, delivery_fee_ngn, email, phone, paystack_ref")
    .eq("public_token", token).maybeSingle();

  if (!o) return json({ error: "order_not_found" }, 404);
  if (o.payment_method !== "paystack") return json({ error: "not_a_card_order" }, 400);
  if (o.status !== "awaiting_payment") return json({ error: "order_not_payable", status: o.status }, 409);
  if (o.delivery_fee_ngn === null) return json({ error: "delivery_fee_pending" }, 409);

  const reference = o.paystack_ref ?? `XO-${o.order_no}-${crypto.randomUUID().slice(0, 8)}`;
  if (!o.paystack_ref) {
    const { error } = await db.from("orders").update({ paystack_ref: reference }).eq("id", o.id);
    if (error) return json({ error: "could_not_save_reference" }, 500);
  }

  const callback = Deno.env.get("SITE_URL") ? `${Deno.env.get("SITE_URL")}/#/order/${token}` : undefined;
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: o.email || `${o.phone.replace(/\D/g, "")}@orders.invalid`,  // Paystack requires an email
      amount: o.total_ngn * 100,                                        // kobo
      currency: "NGN",
      reference,
      callback_url: callback,
      metadata: { order_no: o.order_no },
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.status) return json({ error: "paystack_error", message: out?.message }, 502);
  return json({ authorization_url: out.data.authorization_url, reference });
});
