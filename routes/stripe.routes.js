import { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { findUserByIdentifier } from "../middleware/auth.js";

const PREMIUM_PRODUCT_NAME = "PizzaHub Vendor Premium Plan";
const DEFAULT_PRICE_USD = 29;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function premiumPriceCents() {
  const configured = Number(process.env.STRIPE_PREMIUM_PRICE_USD || DEFAULT_PRICE_USD);
  return Number.isFinite(configured) && configured > 0
    ? Math.round(configured * 100)
    : DEFAULT_PRICE_USD * 100;
}

function vendorIdFilter(vendorId) {
  const values = [vendorId];
  if (ObjectId.isValid(vendorId)) values.push(new ObjectId(vendorId));
  return { vendorId: { $in: values } };
}

/** Checkout session creation for vendors upgrading to Premium. */
export function stripeRoutes(db, auth) {
  const router = Router();

  router.post(
    "/create-checkout-session",
    auth.verifyToken,
    auth.verifyVendor,
    async (req, res) => {
      if (req.user.subscriptionPlan === "premium") {
        return res
          .status(400)
          .json({ message: "Your kitchen is already on the Premium plan" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res
          .status(503)
          .json({ message: "Stripe is not configured on the server yet" });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: premiumPriceCents(),
              product_data: { name: PREMIUM_PRODUCT_NAME },
            },
            quantity: 1,
          },
        ],
        metadata: {
          vendorId: req.user.id,
          vendorEmail: req.user.email,
          vendorName: req.user.businessName || req.user.name,
          plan: "premium",
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
      });

      return res.json({ url: session.url, sessionId: session.id });
    },
  );

  return router;
}

/**
 * Raw-body webhook handler. Mount with express.raw({ type: "application/json" })
 * before express.json() so the signature is verified against the exact bytes.
 */
export function stripeWebhookHandler(db) {
  const users = db.collection("user");
  const menuItems = db.collection("menuItems");
  const transactions = db.collection("transactions");

  return async (req, res) => {
    const sig = req.headers["stripe-signature"];

    if (!sig || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      return res.status(400).json({ message: "Invalid signature" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vendorId = session.metadata?.vendorId;

      if (vendorId) {
        const alreadyProcessed = await transactions.findOne({
          stripeSessionId: session.id,
        });

        if (!alreadyProcessed) {
          const vendor = await findUserByIdentifier(users, vendorId);
          const subscriptionExpiresAt = new Date(Date.now() + ONE_YEAR_MS);

          if (vendor) {
            await users.updateOne(
              { _id: vendor._id },
              {
                $set: {
                  subscriptionPlan: "premium",
                  subscriptionExpiresAt,
                },
              },
            );
          }

          await menuItems.updateMany(vendorIdFilter(vendorId), {
            $set: { vendorPremium: true },
          });

          await transactions.insertOne({
            vendorId,
            vendorName: session.metadata?.vendorName || "",
            plan: "premium",
            amount: (session.amount_total || 2900) / 100,
            currency: (session.currency || "usd").toUpperCase(),
            stripeSessionId: session.id,
            status: "succeeded",
            createdAt: new Date(),
          });
        }
      }
    }

    return res.json({ received: true });
  };
}
