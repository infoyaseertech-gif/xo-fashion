// Paystack -> this function (set as the Webhook URL in the Paystack dashboard).
// 1) verify HMAC-SHA512 signature  2) re-verify the transaction with Paystack  3) confirm in the DB.
// Deploy with --no-verify-jwt (Paystack sends no Supabase JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac512(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")!;
  const raw = await req.text();
  const sig = req.headers.get("x-paystack-signature") ?? "";
  if (!safeEqual(await hmac512(secret, raw), sig)) return new Response("bad signature", { status: 401 });

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (evt?.event !== "charge.success") return new Response("ignored", { status: 200 });

  const ref = evt?.data?.reference;
  if (typeof ref !== "string") return new Response("no reference", { status: 400 });

  // Never trust the webhook body alone: ask Paystack directly.
  const v = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const vj = await v.json().catch(() => ({}));
  if (!v.ok || vj?.data?.status !== "success" || vj?.data?.currency !== "NGN") {
    return new Response("not verified", { status: 200 });   // 200 so Paystack stops retrying a non-success
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const orderNo = Number(String(ref).split("-")[1]);
  if (!Number.isFinite(orderNo)) return new Response("bad reference", { status: 200 });

  const { data, error } = await db.rpc("confirm_paystack_payment", {
    p_order_no: orderNo, p_reference: ref, p_amount_kobo: vj.data.amount,
  });
  if (error) return new Response("db error", { status: 500 });          // 500 => Paystack retries
  return new Response(String(data), { status: 200 });
});
