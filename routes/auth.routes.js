import { Router } from "express";
import jwt from "jsonwebtoken";
import { findUserByIdentifier, toPublicUser } from "../middleware/auth.js";

export function authRoutes(db) {
  const router = Router();
  const users = db.collection("user");

  router.post("/jwt", async (req, res) => {
    const { email } = req.body || {};

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await findUserByIdentifier(users, email.trim());

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isBlocked === true) {
      return res.status(403).json({ message: "Account is blocked" });
    }

    const id = user._id.toString();
    const token = jwt.sign(
      { id, email: user.email, role: user.role || "customer" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({ token, user: toPublicUser(user) });
  });

  return router;
}
