import { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

const PREMIUM_PRODUCT_NAME = "PizzaHub Vendor Premium Plan";
const PREMIUM_PRICE_CENTS = 2900;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierConditions(identifier) {
  if (!identifier) return [];
  const value = String(identifier);
  const conditions = [{ _id: value }];
  if (ObjectId.isValid(value)) conditions.push({ _id: new ObjectId(value) });
  conditions.push({ email: value });
  return conditions;
}

function emailConditions(email) {
  const value = String(email || "").trim();
  if (!value) return [];
  return [
    { email: value },
    { email: { $regex: `^${escapeRegex(value)}$`, $options: "i" } },
  ];
}

function menuItemFilter(vendorId, vendorEmail) {
  const conditions = [];
  const id = String(vendorId || "").trim();

  if (id) {
    conditions.push({ vendorId: id });
    if (ObjectId.isValid(id)) conditions.push({ vendorId: new ObjectId(id) });
  }

  const email = String(vendorEmail || "").trim();
  if (email) {
    conditions.push({ vendorEmail: email });
    conditions.push({
      vendorEmail: { $regex: `^${escapeRegex(email)}$`, $options: "i" },
    });
  }

  return conditions.length
    ? { $or: conditions }
    : { vendorId: "__no_matching_vendor__" };
}

async function findVendor(users, vendorId, vendorEmail) {
  const conditions = [
    ...identifierConditions(vendorId),
    ...emailConditions(vendorEmail),
  ];

  if (!conditions.length) return null;
  return users.findOne({ $or: conditions });
}

/**
 * Premium is activated ONLY here, from a verified Stripe webhook event.
 * The transaction keyed by stripeSessionId is the idempotency guard.
 */
export async function upgradeVendorForSession(db, session) {
  const users = db.collection("user");
  const menuItems = db.collection("menuItems");
  const transactions = db.collection("transactions");

  const vendorId = session?.metadata?.vendorId;
  const vendorEmail =
    session?.metadata?.vendorEmail || session?.customer_details?.email || "";

  if (!session?.id) {
    return { upgraded: false, alreadyProcessed: false, vendorId, vendorEmail };
  }

  const alreadyProcessed = Boolean(
    await transactions.findOne({ stripeSessionId: session.id }),
  );

  const vendor = await findVendor(users, vendorId, vendorEmail);
  const resolvedVendorId = vendor?._id ?? vendorId;
  const resolvedVendorEmail = vendor?.email || vendorEmail;

  await menuItems.updateMany(
    menuItemFilter(resolvedVendorId, resolvedVendorEmail),
    { $set: { vendorPremium: true, updatedAt: new Date() } },
  );

  if (!vendor) {
    console.warn(
      `[Stripe Webhook] No vendor found for session ${session.id} ` +
        `(vendorId=${vendorId || "none"}, vendorEmail=${vendorEmail || "none"})`,
    );
    return { upgraded: false, alreadyProcessed: false, vendorId, vendorEmail };
  }

  // Re-applying the $set is harmless and repairs any partial prior attempt.
  await users.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        stripeCustomerId: session.customer || null,
        stripeSubscriptionId: session.subscription || null,
        updatedAt: new Date(),
      },
    },
  );

  if (alreadyProcessed) {
    console.log(
      `[Stripe Webhook] Session ${session.id} already recorded; premium plan re-checked for ${resolvedVendorEmail || resolvedVendorId}`,
    );
    return {
      upgraded: true,
      alreadyProcessed: true,
      vendorId: resolvedVendorId,
      vendorEmail: resolvedVendorEmail,
    };
  }

  const transactionWrite = await transactions.updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        vendorId: String(resolvedVendorId),
        vendorName: vendor.businessName || vendor.name || "",
        vendorEmail: resolvedVendorEmail,
        plan: "Premium",
        amount: (session.amount_total || PREMIUM_PRICE_CENTS) / 100,
        currency: (session.currency || "usd").toUpperCase(),
        status: "succeeded",
        stripeSessionId: session.id,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  console.log(
    `[Stripe Webhook] Upgraded vendor ${resolvedVendorEmail || resolvedVendorId} to premium`,
  );

  return {
    upgraded: true,
    alreadyProcessed: transactionWrite.upsertedCount === 0,
    vendorId: resolvedVendorId,
    vendorEmail: resolvedVendorEmail,
  };
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

      // Never accept ownership from the request body: only the authenticated
      // vendor may start a checkout for their own account.
      const vendorId = String(req.user?._id ?? req.user.id ?? "");
      const vendorEmail = req.user.email;
      const billingMetadata = { vendorId, vendorEmail };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: PREMIUM_PRICE_CENTS,
              recurring: { interval: "month" },
              product_data: { name: PREMIUM_PRODUCT_NAME },
            },
            quantity: 1,
          },
        ],
        metadata: billingMetadata,
        subscription_data: { metadata: billingMetadata },
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

      if (session.payment_status !== "paid") {
        console.warn(
          `[Stripe Webhook] Ignoring unpaid checkout session ${session.id}`,
        );
        return res.json({ received: true });
      }

      try {
        await upgradeVendorForSession(db, session);
      } catch (error) {
        console.error("[Stripe Webhook] Could not apply premium upgrade", error);
        return res.status(500).json({ message: "Could not apply upgrade" });
      }
    }

    return res.json({ received: true });
  };
}
