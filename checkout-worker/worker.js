// Hamwatan checkout worker (Cloudflare Worker).
// Creates a Stripe Checkout session so customers pay as guests (no account needed).
// The worker works out every price itself from the rate table below. The browser sends only
// what the customer chose (service, quantity, options); it never sends a price.
// Secret key is stored as a Worker secret: STRIPE_SECRET_KEY. Never put it in the website.
//
// KEEP IN SYNC: RATE, PUB and RATEH must match the website (merged site: RATE, PUB, RATEH).
// Change a price in both places, or in the app's prices.js once the app is connected.

const ALLOWED_ORIGINS = ['https://hlanguagesolutions.com', 'https://www.hlanguagesolutions.com'];
const SITE = 'https://hlanguagesolutions.com';
const MILEAGE = 0.70;
const RATE = {"cert":["page",50,50,1,1],"relo":["page",50,50,1,1],"court":["hour",80,160,2,2],"lawf":["page",50,50,1,1],"notar":["project",90,90,1,1],"medint":["hour",80,160,2,2],"medtr":["page",50,50,1,1],"school":["hour",80,160,2,2],"house":["hour",80,160,2,2],"cult":["day",450,450,1,1],"gov":["page",50,50,1,1],"fed":["hour",80,160,2,2],"corp":["page",50,50,1,1],"trade":["page",50,50,1,1],"bank":["page",50,50,1,1],"realty":["page",50,50,1,1],"dmv":["page",50,50,1,1],"dub":["minute",25,125,5,5],"sub":["minute",6,60,10,10],"l10n":["project",600,600,1,1],"news":["page",50,50,1,1],"narr":["minute",25,125,10,5],"lit":["page",50,50,1,1],"ai":["hour",600,1200,2,2],"speech":["hour",35,70,5,2],"rate":["hour",30,30,4,1],"mtpe":["page",50,50,1,1],"qa":["page",50,50,1,1],"teach":["hour",45,45,4,1],"trainw":["day",450,450,1,1],"curr":["project",1200,1200,1,1],"resett":["hour",80,160,2,2],"hr":["page",50,50,1,1],"disaster":["hour",80,160,2,2],"xcult":["hour",80,160,2,2],"survey":["project",1500,1500,1,1],"pubs":["article",400,400,1,1],"retain":["month",1200,1200,1,1],"dir":["month",300,300,1,1]};
// Interpreting modes: hourly or per-minute rate, and the minimum billed units.
const PUB = { onsite: { v: 80, min: 2 }, video: { v: 2.75, min: 15 }, phone: { v: 2.25, min: 10 } };
// Hire rates per hour (used by the hire flow).
const RATEH = { onsite: 80, video: 165, phone: 135 };

const money = n => Math.round(n * 100) / 100;

function estimate(slug, qty, rush, mail) {
  const r = RATE[slug];
  if (!r) throw new Error('unknown service');
  const q = Math.max(r[4], Math.floor(+qty) || r[4]);
  const base = Math.max(r[2], r[1] * q);
  let amt = Math.round(base * (rush ? 1.5 : 1));
  if (r[0] === 'page' && mail) amt += 15;
  return amt;
}

function disc(h) { if (h >= 8) return 0.10; if (h >= 4) return 0.05; return 0; }

// Returns the price in dollars for one cart line, or throws if the line is not valid.
function priceLine(c) {
  const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error('bad value'); return n; };
  if (c.kind === 'hire') {
    const mode = String(c.mode);
    if (!RATEH[mode]) throw new Error('bad mode');
    const hours = num(c.hours, 1, 24);
    const base = RATEH[mode] * hours;
    return money(base - base * disc(hours) + (mode === 'onsite' && c.region === 'near' ? 40 : 0));
  }
  const slug = String(c.slug || '');
  if (!RATE[slug]) throw new Error('unknown service');
  const qty = num(c.qty || RATE[slug][3], 1, 500);
  const rush = !!c.rush;
  if (c.mode) {
    const mode = String(c.mode);
    if (!PUB[mode]) throw new Error('bad mode');
    const onsite = mode === 'onsite';
    const miles = onsite ? num(c.miles || 0, 0, 500) : 0;
    const parking = onsite ? num(c.parking || 0, 0, 200) : 0;
    const extra = onsite ? Math.max(0, miles - 20) * 2 * MILEAGE + parking : 0;
    if (c.ond) return money(estimate(slug, qty, rush, false) + extra);
    let base = Math.max(PUB[mode].min, qty) * PUB[mode].v;
    if (rush) base *= 1.5;
    return money(base + extra);
  }
  // Certified delivery adds $15 on top of the mailed copy. Only a mailed page order can have it.
  if (c.mail && c.intl && (RATE[slug][0] === 'page')) return estimate(slug, qty, rush, false) + 45;
  if (c.cert && c.mail && (RATE[slug][0] === 'page')) return estimate(slug, qty, rush, true) + 15;
  return estimate(slug, qty, rush, !!c.mail);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
    if (!allowed) return json({ error: 'origin not allowed' }, 403, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'invalid json' }, 400, cors); }

    const cart = Array.isArray(body.cart) ? body.cart.slice(0, 20) : [];
    if (!cart.length) return json({ error: 'no items' }, 400, cors);

    const customer = body.customer || {};
    const email = String(customer.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid email' }, 400, cors);
    const name = String(customer.name || '').trim().slice(0, 120);

    // Work out every price here. Anything the browser sent as a price is ignored.
    let lines;
    try {
      lines = cart.map(function (c) {
        const amount = priceLine(c);
        const cents = Math.round(amount * 100);
        if (cents < 100 || cents > 500000) throw new Error('amount out of range');
        return { name: String(c.name || c.slug || 'Service').trim().slice(0, 120),
                  description: String(c.description || '').trim().slice(0, 500),
                  cents: cents };
      });
    } catch (e) {
      return json({ error: 'invalid item' }, 400, cors);
    }

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', SITE + '/?paid=1#/quote');
    params.set('cancel_url', SITE + '/#/quote');
    if (email) params.set('customer_email', email);
    params.set('metadata[customer_name]', name);
    params.set('payment_intent_data[statement_descriptor_suffix]', 'HAMWATAN');
    // Partners enter a promo code (for example PARTNER10) created in the Stripe Dashboard.
    params.set('allow_promotion_codes', 'true');
    // Mailed paper copies need a U.S. mailing address, so Stripe collects it when any item asks for mail.
    if (cart.some(function (c) { return !!c.mail; })) params.set('shipping_address_collection[allowed_countries][0]', 'US');
    if (cart.some(function (c) { return !!(c.mail && c.intl); })) params.set('shipping_address_collection[allowed_countries][1]', 'CA');

    lines.forEach(function (l, i) {
      params.set(`line_items[${i}][quantity]`, '1');
      params.set(`line_items[${i}][price_data][currency]`, 'usd');
      params.set(`line_items[${i}][price_data][unit_amount]`, String(l.cents));
      params.set(`line_items[${i}][price_data][product_data][name]`, l.name);
      if (l.description) params.set(`line_items[${i}][price_data][product_data][description]`, l.description);
    });

    // Order summary on the payment record (Stripe metadata values are max 500 characters).
    const summary = lines.map(function (l) { return (l.description || l.name); }).join('\n');
    params.set('metadata[order_summary]', summary.slice(0, 500));
    if (summary.length > 500) params.set('metadata[order_summary_2]', summary.slice(500, 1000));
    if (summary.length > 1000) params.set('metadata[order_summary_3]', summary.slice(1000, 1500));

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    const d = await r.json();
    if (!r.ok || !d.url) return json({ error: 'payment could not start' }, 502, cors);
    return json({ url: d.url }, 200, cors);
  }
};
