/* X and O: live backend adapter (Supabase). Sets window.XO_BE, or null when config.js is empty (the site then runs in demo mode). */
(function () {
  const C = window.XO_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseAnonKey || !window.supabase) { window.XO_BE = null; return; }
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/pdf': 'pdf' };
  const ok = (r) => { if (r.error) throw r.error; return r.data; };
  const slug = (n) => (String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item') + '-' + Math.random().toString(36).slice(2, 7);

  function shapeProduct(r) {
    const vs = [...(r.variants || [])].sort((a, b) => (a.sort - b.sort) || a.colour_name.localeCompare(b.colour_name) || String(a.size).localeCompare(String(b.size), undefined, { numeric: true }));
    const colours = [], sizes = [], stock = {}, vid = {};
    vs.forEach((v) => {
      if (!colours.some((c) => c.name === v.colour_name)) colours.push({ name: v.colour_name, hex: v.colour_hex });
      if (!sizes.includes(v.size)) sizes.push(v.size);
      stock[v.colour_name + '|' + v.size] = v.stock; vid[v.colour_name + '|' + v.size] = v.id;
    });
    const media = [...(r.media || [])].sort((a, b) => a.sort_order - b.sort_order).map((m) => ({ type: m.kind, url: m.url, colour: m.colour_name || '' }));
    return { id: r.id, name: r.name, category: r.category, origin: r.origin, price: r.price_ngn, fabric: r.fabric_note, desc: r.description, colours, sizes, stock, vid, media, active: r.active, createdAt: Date.parse(r.created_at) };
  }

  const BE = {
    sb, cardEnabled: !!C.cardPayments,
    async products() { return ok(await sb.from('products').select('*, variants(*), media(*)').order('created_at', { ascending: false })).map(shapeProduct); },
    async reviews() { return ok(await sb.from('reviews').select('*').order('created_at', { ascending: false })).map((r) => ({ id: r.id, productId: r.product_id, name: r.reviewer_name, stars: r.stars, text: r.comment, approved: r.approved, size: r.size_feedback })); },
    async shots() { return ok(await sb.from('testimonials').select('*').order('created_at', { ascending: false })).map((t) => ({ id: t.id, url: t.image_url, createdAt: Date.parse(t.created_at) })); },
    async zones() { const m = {}; ok(await sb.from('delivery_zones').select('*')).forEach((z) => { if (z.fee_ngn != null || z.days != null) m[z.state] = { fee: z.fee_ngn || 0, days: z.days || 0 }; }); return m; },
    async orders() {
      // Falls back to plain orders if database step 005 (messages) has not been run yet.
      let r = await sb.from('orders').select('*, order_items(*), order_messages(*)').order('created_at', { ascending: false }).limit(300);
      if (r.error) r = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(300);
      const rows = ok(r);
      let rv = new Set();
      try { rv = new Set(ok(await sb.from('reviews').select('order_item_id').not('order_item_id', 'is', null)).map((r) => r.order_item_id)); } catch (e) { /* reviews list optional */ }
      return rows.map((o) => ({ id: o.id, no: o.order_no, status: o.status, method: o.payment_method, createdAt: Date.parse(o.created_at), total: o.total_ngn, receipt: o.receipt_path, courier: o.courier, tracking: o.tracking_no, customer: { name: o.customer_name, phone: o.phone, state: o.state, address: o.address, email: o.email }, paidAt: o.paid_at ? Date.parse(o.paid_at) : null, msgs: (o.order_messages || []).slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((m) => ({ from: m.sender, text: m.body, at: Date.parse(m.created_at) })),
        unread: (o.order_messages || []).some((m) => m.sender === 'customer' && (!o.owner_read_at || Date.parse(m.created_at) > Date.parse(o.owner_read_at))),
        open: !['cancelled', 'expired'].includes(o.status) && !(o.status === 'delivered' && (o.order_items || []).every((i) => rv.has(i.id))),
        items: (o.order_items || []).map((i) => ({ name: i.product_name, colour: i.colour_name, size: i.size, n: i.qty, price: i.unit_price_ngn, cost: i.unit_cost_ngn })) }));
    },
    async postMessage(token, body) { ok(await sb.rpc('post_order_message', { p_token: token, p_body: body })); },
    async cancelMine(token) { ok(await sb.rpc('cancel_my_order', { p_token: token })); },
    async adminMessage(id, body) { ok(await sb.rpc('admin_post_message', { p_order: id, p_body: body })); },
    async markRead(id) { ok(await sb.rpc('admin_mark_read', { p_order: id })); },
    async deleteOrder(id) { ok(await sb.rpc('admin_delete_order', { p_order: id })); },
    async deleteCustomer(phone) { return ok(await sb.rpc('admin_delete_customer', { p_phone: phone })); },
    async clearData(scope) { ok(await sb.rpc('admin_clear_data', { p_scope: scope })); },
    watchOrders(fn) { let t; const go = () => { clearTimeout(t); t = setTimeout(fn, 500); }; sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'order_messages' }, go).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, go).subscribe(); },
    async costs() { const m = {}; ok(await sb.from('product_costs').select('*')).forEach((r) => { m[r.product_id] = r.cost_ngn; }); return m; },
    async expenses() { return ok(await sb.from('expenses').select('*').order('spent_on', { ascending: false }).limit(500)).map((e) => ({ id: e.id, date: e.spent_on, cat: e.category, note: e.note, amt: e.amount_ngn })); },
    async addExpense(x) { const e = ok(await sb.from('expenses').insert({ spent_on: x.date, category: x.cat, note: x.note, amount_ngn: x.amt }).select('*').single()); return { id: e.id, date: e.spent_on, cat: e.category, note: e.note, amt: e.amount_ngn }; },
    async deleteExpense(id) { ok(await sb.from('expenses').delete().eq('id', id)); },
    async stockLog() { return ok(await sb.from('stock_log').select('delta,reason,created_at,variants(colour_name,size,products(name))').order('created_at', { ascending: false }).limit(100)).map((l) => ({ at: Date.parse(l.created_at), delta: l.delta, reason: l.reason, item: ((l.variants && l.variants.products && l.variants.products.name) || '') + ' · ' + ((l.variants && l.variants.colour_name) || '') + ' ' + ((l.variants && l.variants.size) || '') })); },
    async restocks() { return ok(await sb.from('notify_requests').select('phone,created_at,variants(colour_name,size,products(name))').order('created_at', { ascending: false }).limit(100)).map((r) => ({ phone: r.phone, item: ((r.variants && r.variants.products && r.variants.products.name) || '') + ' · ' + ((r.variants && r.variants.colour_name) || '') + ' ' + ((r.variants && r.variants.size) || '') })); },
    async bank() { const r = ok(await sb.from('settings').select('value').eq('key', 'bank').maybeSingle()); const v = (r && r.value) || {}; return { bank: v.bank || '', name: v.account_name || '', number: v.account_number || '' }; },
    watchStock(fn) { let t; sb.channel('stock').on('postgres_changes', { event: '*', schema: 'public', table: 'variants' }, () => { clearTimeout(t); t = setTimeout(fn, 400); }).subscribe(); },

    async placeOrder(items, cust, method) { return ok(await sb.rpc('place_order', { p_items: items, p_customer: cust, p_payment_method: method })); },
    async getOrder(token) { return ok(await sb.rpc('get_order', { p_token: token })); },
    async payByCard(token) {
      const r = await fetch(C.supabaseUrl + '/functions/v1/paystack-init', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'card_unavailable'); return j.authorization_url;
    },
    async sendReceipt(token, orderId, file) {
      const ext = EXT[file.type] || 'jpg';
      const path = orderId + '/' + Date.now() + '.' + ext;
      const up = await sb.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
      ok(await sb.rpc('attach_receipt', { p_token: token, p_path: path }));
    },
    async confirmReceived(token) { ok(await sb.rpc('confirm_received', { p_token: token })); },
    async review(token, itemId, stars, name, comment, size) { return ok(await sb.rpc('submit_review', { p_token: token, p_order_item: itemId, p_stars: stars, p_name: name, p_comment: comment, p_size_feedback: size || null })); },
    async notifyMe(variantId, phone) { ok(await sb.rpc('request_restock_notice', { p_variant: variantId, p_phone: phone })); },

    /* owner */
    async signIn(email, password) { const r = await sb.auth.signInWithPassword({ email, password }); if (r.error) throw r.error; return BE.isAdmin(); },
    async signOut() { await sb.auth.signOut(); },
    async isAdmin() { const s = await sb.auth.getSession(); if (!s.data.session) return false; const r = await sb.rpc('is_admin'); return !r.error && r.data === true; },
    async setStatus(id, status, courier, tracking) { ok(await sb.rpc('admin_set_status', { p_order: id, p_status: status, p_courier: courier || null, p_tracking: tracking || null })); },
    async receiptUrl(path) { const r = await sb.storage.from('receipts').createSignedUrl(path, 300); if (r.error) throw r.error; return r.data.signedUrl; },
    async upload(file) {
      const ext = EXT[file.type] || 'bin';
      const path = new Date().toISOString().slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
      const up = await sb.storage.from('product-media').upload(path, file, { contentType: file.type, cacheControl: '31536000' }); if (up.error) throw up.error;
      return { url: sb.storage.from('product-media').getPublicUrl(path).data.publicUrl, type: file.type.startsWith('video/') ? 'video' : 'image' };
    },
    async saveProduct(d, id) {
      const row = { name: d.name, category: d.category, origin: d.origin, description: d.desc, fabric_note: d.fabric, price_ngn: d.price, active: d.active };
      let pid = id;
      if (pid) ok(await sb.from('products').update(row).eq('id', pid));
      else pid = ok(await sb.from('products').insert({ ...row, slug: slug(d.name) }).select('id').single()).id;
      const want = [];
      d.colours.forEach((c, ci) => d.sizes.forEach((s, si) => want.push({ product_id: pid, colour_name: c.name, colour_hex: c.hex, size: s, stock: d.stock[c.name + '|' + s] || 0, sort: ci * 100 + si })));
      ok(await sb.from('variants').upsert(want, { onConflict: 'product_id,colour_name,size' }));
      const have = ok(await sb.from('variants').select('id,colour_name,size').eq('product_id', pid));
      for (const v of have) {
        if (want.some((w) => w.colour_name === v.colour_name && w.size === v.size)) continue;
        const del = await sb.from('variants').delete().eq('id', v.id);
        if (del.error) ok(await sb.from('variants').update({ stock: 0 }).eq('id', v.id)); // already sold once: keep the row, zero the stock
      }
      ok(await sb.from('media').delete().eq('product_id', pid));
      if (d.media.length) ok(await sb.from('media').insert(d.media.map((m, i) => ({ product_id: pid, colour_name: m.colour || null, kind: m.type, url: m.url, sort_order: i }))));
      try {
        if (d.cost != null) ok(await sb.from('product_costs').upsert({ product_id: pid, cost_ngn: d.cost }));
        else ok(await sb.from('product_costs').delete().eq('product_id', pid));
      } catch (e) { throw new Error('Product saved, but the cost price was not stored. Run database step 003 in Supabase.'); }
      return pid;
    },
    async deleteProduct(id) { const r = await sb.from('products').delete().eq('id', id); if (r.error) { ok(await sb.from('products').update({ active: false }).eq('id', id)); return 'hidden'; } return 'deleted'; },
    async approveReview(id) { ok(await sb.from('reviews').update({ approved: true }).eq('id', id)); },
    async deleteReview(id) { ok(await sb.from('reviews').delete().eq('id', id)); },
    async addShot(url) { ok(await sb.from('testimonials').insert({ image_url: url })); },
    async deleteShot(id) { ok(await sb.from('testimonials').delete().eq('id', id)); },
    async saveBank(b) { ok(await sb.from('settings').upsert({ key: 'bank', value: { bank: b.bank, account_name: b.name, account_number: b.number }, is_public: false })); },
    async saveZones(m, states) { ok(await sb.from('delivery_zones').upsert(states.map((s) => ({ state: s, fee_ngn: m[s] ? m[s].fee || null : null, days: m[s] ? m[s].days || null : null })))); }
  };
  window.XO_BE = BE;
})();
