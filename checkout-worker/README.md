# Checkout worker setup (Stripe, guest checkout)

Customers pay on a Stripe-hosted page without creating an account.
The worker calculates every price itself and creates the payment session.
The website never sees the secret key.

## What goes to Stripe
- Service name, quantity, and options (for example "On-site, 2 h"), plus the amount.
- The customer's name and email, for the receipt.
- No patient information, no dates, no places, no phone number.

## Set up on Cloudflare (free plan)
1. Create a free Cloudflare account at cloudflare.com.
2. Go to Workers & Pages → Create → Worker. Name it `hamwatan-checkout`.
3. Replace the default code with the contents of `worker.js`. Click Deploy.
4. Open the worker's Settings → Variables and Secrets. Add a **secret** named
   `STRIPE_SECRET_KEY` with your Stripe secret key (Stripe Dashboard → Developers → API keys).
   Start with the test key (`sk_test_...`), then switch to the live key (`sk_live_...`) when ready.
5. Copy the worker's web address (for example `https://hamwatan-checkout.<your-account>.workers.dev`).
   Send it to the person maintaining the website, who sets it as `checkoutEndpoint` in CONFIG.

## Keep prices in sync
The rate table in `worker.js` must match the website's prices. If a price changes on the website,
change it in `worker.js` too, then deploy the worker again.

## Test before going live
- Pay with the test card `4242 4242 4242 4242`, any future expiry date, any CVC.
- Check the amount, the items, and the receipt in the Stripe test dashboard.

## Partner discount
Create a promotion code in Stripe Dashboard → Product catalog → Coupons (for example a 10% coupon with the code `PARTNER10`).
Give the code only to partners. The checkout page shows an "Add promotion code" field.

## Payment email
Turn on payment emails in Stripe (Settings → Notifications) so you get one for each order.
