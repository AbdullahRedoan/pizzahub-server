import { Router } from "express";
import { ObjectId } from "mongodb";
import { findUserByIdentifier } from "../middleware/auth.js";

const PROTECTED_FIELDS = [
  "role",
  "subscriptionPlan",
  "subscriptionExpiresAt",
  "isBlocked",
];
const EDITABLE_FIELDS = ["name", "image", "businessName"];

export function profileRoutes(db, auth) {
  const router = Router();
  const users = db.collection("user");
  const menuItems = db.collection("menuItems");

  router.use(auth.verifyToken);

  router.get("/", (req, res) => {
    return res.json({ user: req.user });
  });

  router.patch("/", async (req, res) => {
    const body = req.body || {};

    if (PROTECTED_FIELDS.some((field) => Object.hasOwn(body, field))) {
      return res.status(403).json({
        message: "Forbidden: protected account fields cannot be modified",
      });
    }

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (typeof body[field] === "string") {
        updates[field] = body[field];
      }
    }

    const target = await findUserByIdentifier(users, req.user.id);

    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (Object.keys(updates).length > 0) {
      await users.updateOne({ _id: target._id }, { $set: updates });
    }

    const vendorNameChanged =
      updates.businessName !== undefined &&
      updates.businessName !== target.businessName &&
      (target.role === "vendor" || req.user.role === "vendor");

    if (vendorNameChanged) {
      const vendorIds = [req.user.id];
      if (ObjectId.isValid(req.user.id)) {
        vendorIds.push(new ObjectId(req.user.id));
      }
      await menuItems.updateMany(
        { vendorId: { $in: vendorIds } },
        { $set: { vendorName: updates.businessName } },
      );
    }

    const updated = await users.findOne(
      { _id: target._id },
      { projection: { password: 0 } },
    );
    return res.json({ user: updated });
  });

  return router;
}
