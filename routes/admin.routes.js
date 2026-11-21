import { Router } from "express";
import { ObjectId } from "mongodb";
import { findUserByIdentifier } from "../middleware/auth.js";

const VALID_ROLES = ["customer", "vendor", "admin"];
const VALID_STATUSES = ["approved", "rejected", "pending"];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findById(collection, id) {
  if (!ObjectId.isValid(id)) return Promise.resolve(null);
  return collection.findOne({ _id: new ObjectId(id) });
}

export function adminRoutes(db, auth) {
  const router = Router();
  const users = db.collection("user");
  const menuItems = db.collection("menuItems");
  const transactions = db.collection("transactions");

  router.use(auth.verifyToken, auth.verifyAdmin);

  router.get("/overview", async (req, res) => {
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalMenuItems,
      pendingMenuItems,
      totalTransactions,
      revenue,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ role: "vendor" }),
      users.countDocuments({ role: "customer" }),
      menuItems.countDocuments({}),
      menuItems.countDocuments({ status: "pending" }),
      transactions.countDocuments({}),
      transactions
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$amount", 0] } },
            },
          },
        ])
        .toArray(),
    ]);

    return res.json({
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        totalTransactions,
        totalRevenue: revenue[0]?.total || 0,
      },
    });
  });

  router.get("/users", async (req, res) => {
    const filter = {};
    const { search, role } = req.query;

    if (typeof search === "string" && search.trim()) {
      const pattern = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    if (VALID_ROLES.includes(role)) {
      filter.role = role;
    }

    const result = await users
      .find(filter, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ users: result });
  });

  router.patch("/users/:id/block", async (req, res) => {
    const target = await findUserByIdentifier(users, req.params.id);

    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (target._id.toString() === req.user.id) {
      return res
        .status(400)
        .json({ message: "You cannot block your own admin account" });
    }

    const isBlocked =
      typeof req.body?.isBlocked === "boolean"
        ? req.body.isBlocked
        : !Boolean(target.isBlocked);

    await users.updateOne({ _id: target._id }, { $set: { isBlocked } });

    const updated = await users.findOne(
      { _id: target._id },
      { projection: { password: 0 } },
    );
    return res.json({ user: updated });
  });

  router.get("/menu-items", async (req, res) => {
    const result = await menuItems.find({}).sort({ createdAt: -1 }).toArray();
    return res.json({ items: result });
  });

  router.patch("/menu-items/:id/status", async (req, res) => {
    const { status } = req.body || {};

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const item = await findById(menuItems, req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const active = status === "approved";
    await menuItems.updateOne(
      { _id: item._id },
      { $set: { status, active, updatedAt: new Date() } },
    );

    const updated = await menuItems.findOne({ _id: item._id });
    return res.json({ item: updated });
  });

  router.delete("/menu-items/:id", async (req, res) => {
    const item = await findById(menuItems, req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    await menuItems.deleteOne({ _id: item._id });
    return res.json({ message: "Menu item deleted by admin" });
  });

  router.get("/transactions", async (req, res) => {
    const result = await transactions.find({}).sort({ createdAt: -1 }).toArray();
    return res.json({ transactions: result });
  });

  return router;
}
