import { Router } from "express";
import { ObjectId } from "mongodb";
import {
  FREE_PLAN_LIMIT_CODE,
  FREE_PLAN_LIMIT_MESSAGE,
  checkFreePlanLimit,
  isPremiumPlan,
} from "../utils/subscription.js";

const PREMIUM_FIRST_SORT = { vendorPremium: -1, createdAt: -1 };
const FEATURED_LIMIT = 6;
const UPDATABLE_FIELDS = [
  "itemName",
  "category",
  "description",
  "price",
  "location",
  "images",
  "active",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Premium kitchens always lead, including featured and price-sorted browsing.
function sortFor(sort) {
  if (sort === "asc") return { vendorPremium: -1, price: 1 };
  if (sort === "desc") return { vendorPremium: -1, price: -1 };
  return PREMIUM_FIRST_SORT;
}

function findItemById(items, id) {
  if (!ObjectId.isValid(id)) return Promise.resolve(null);
  return items.findOne({ _id: new ObjectId(id) });
}

/** Public browse + owner/admin single-item lookup. */
export function menuRoutes(db, auth) {
  const router = Router();
  const items = db.collection("menuItems");

  router.get("/", async (req, res) => {
    const { search, category, location, sort } = req.query;
    const filter = { status: "approved", active: true };

    if (typeof search === "string" && search.trim()) {
      const pattern = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ itemName: pattern }, { description: pattern }];
    }

    if (typeof category === "string" && category && category !== "ALL") {
      filter.category = category;
    }

    if (typeof location === "string" && location.trim() && location !== "ALL") {
      filter.location = new RegExp(escapeRegex(location.trim()), "i");
    }

    let cursor = items.find(filter).sort(sortFor(sort));
    if (req.query.featured === "true") {
      cursor = cursor.limit(FEATURED_LIMIT);
    }

    const result = await cursor.toArray();
    return res.json({ items: result });
  });

  router.get("/:id", auth.verifyToken, async (req, res) => {
    const item = await findItemById(items, req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const isOwnerOrAdmin =
      req.user.role === "admin" || String(item.vendorId) === req.user.id;

    if (!isOwnerOrAdmin && (item.status !== "approved" || item.active !== true)) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    return res.json(item);
  });

  return router;
}

/** Vendor-owned menu item management, mounted at /api/vendor. */
export function vendorMenuRoutes(db, auth) {
  const router = Router();
  const items = db.collection("menuItems");

  router.get("/menu-items", auth.verifyToken, auth.verifyVendor, async (req, res) => {
    const result = await items
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ items: result });
  });

  router.post("/menu-items", auth.verifyToken, auth.verifyVendor, async (req, res) => {
    const { itemName, category, description, price, location, images } =
      req.body || {};

    const missing =
      !itemName ||
      !category ||
      !description ||
      price === undefined ||
      price === null ||
      !location ||
      !Array.isArray(images) ||
      images.length === 0 ||
      images.some((image) => typeof image !== "string" || !image.trim());

    if (missing) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ message: "Price must be a positive number" });
    }

    const { allowed } = await checkFreePlanLimit(items, {
      vendorId: req.user.id,
      vendorEmail: req.user.email,
      plan: req.user.subscriptionPlan,
    });

    if (!allowed) {
      return res.status(403).json({
        code: FREE_PLAN_LIMIT_CODE,
        message: FREE_PLAN_LIMIT_MESSAGE,
      });
    }

    const now = new Date();
    const item = {
      itemName,
      category,
      description,
      price: numericPrice,
      location,
      images,
      vendorId: req.user.id,
      vendorName: req.user.businessName || req.user.name,
      vendorPremium: isPremiumPlan(req.user.subscriptionPlan),
      status: "pending",
      active: false,
      createdAt: now,
      updatedAt: now,
    };

    const result = await items.insertOne(item);
    return res.status(201).json({ item: { ...item, _id: result.insertedId } });
  });

  router.patch(
    "/menu-items/:id",
    auth.verifyToken,
    auth.verifyVendor,
    async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const objectId = new ObjectId(req.params.id);
      const item = await items.findOne({ _id: objectId });

      if (!item) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      if (String(item.vendorId) !== req.user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (req.body?.active === true && item.active !== true) {
        const { allowed } = await checkFreePlanLimit(items, {
          vendorId: req.user.id,
          vendorEmail: req.user.email,
          plan: req.user.subscriptionPlan,
          excludeId: objectId,
        });

        if (!allowed) {
          return res.status(403).json({
            code: FREE_PLAN_LIMIT_CODE,
            message: FREE_PLAN_LIMIT_MESSAGE,
          });
        }

        if (item.status !== "approved") {
          return res.status(403).json({
            message: "Only approved menu items can be activated",
          });
        }
      }

      const updates = {};
      for (const field of UPDATABLE_FIELDS) {
        if (req.body?.[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (updates.price !== undefined) {
        const numericPrice = Number(updates.price);
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
          return res.status(400).json({ message: "Price must be a positive number" });
        }
        updates.price = numericPrice;
      }

      updates.updatedAt = new Date();
      await items.updateOne({ _id: objectId }, { $set: updates });

      const updated = await items.findOne({ _id: objectId });
      return res.json({ item: updated });
    },
  );

  router.delete(
    "/menu-items/:id",
    auth.verifyToken,
    auth.verifyVendor,
    async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const objectId = new ObjectId(req.params.id);
      const item = await items.findOne({ _id: objectId });

      if (!item) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      if (String(item.vendorId) !== req.user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await items.deleteOne({ _id: objectId });
      return res.json({ message: "Menu item deleted" });
    },
  );

  return router;
}
