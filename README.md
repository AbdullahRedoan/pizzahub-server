# PizzaHub Server

Express API for PizzaHub: authentication, roles, menu items, orders, admin
tools, and Stripe subscription billing.

## Run locally

```bash
npm install
node index.js
```

The server listens on `PORT` (default `5000`).

## Environment variables

Create a `.env` file in this directory with:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (defaults to `5000`) |
| `DB_USER` | MongoDB Atlas username |
| `DB_PASSWORD` | MongoDB Atlas password |
| `JWT_SECRET` | Secret used to sign auth tokens |
| `CLIENT_URL` | Client origin used for Stripe redirect URLs (defaults to `http://localhost:3000`) |
| `STRIPE_SECRET_KEY` | Stripe secret key for checkout and webhook verification |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook endpoint |

## Billing model

Vendors on the Free plan can keep up to **3 active menu items**. The Premium
plan is a recurring `$29/month` Stripe subscription with no active-item cap.

Premium status is changed **only by Stripe webhooks**; no client endpoint can
activate a plan:

- `POST /api/stripe/create-checkout-session` (authenticated vendor) creates a
  subscription checkout and attaches the vendor identity as session metadata.
- `POST /api/stripe/webhook` verifies the raw request body with
  `STRIPE_WEBHOOK_SECRET`. This route is registered before `express.json()` so
  the signature check sees the exact bytes Stripe signed.
  - `checkout.session.completed` with `payment_status: "paid"` activates
    Premium and records the session ID as an idempotency guard.
  - `customer.subscription.deleted` and `invoice.payment_failed` return the
    vendor to Free and deactivate any excess active items.

The shared helpers in `utils/subscription.js` enforce the same free-plan limit
on create, activate, and admin approval paths.
