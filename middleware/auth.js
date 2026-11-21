import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

const BEARER_PREFIX = "Bearer ";

/**
 * Better Auth writes string ids, while other collections may reference users
 * with ObjectIds. Match any of the three supported identifier shapes.
 */
export function findUserByIdentifier(users, identifier) {
  if (!identifier) return Promise.resolve(null);

  const conditions = [{ _id: identifier }];
  if (ObjectId.isValid(identifier)) {
    conditions.push({ _id: new ObjectId(identifier) });
  }
  conditions.push({ email: identifier });

  return users.findOne({ $or: conditions });
}

export function toPublicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role || "customer",
    businessName: user.businessName || "",
    subscriptionPlan: user.subscriptionPlan || "free",
    isBlocked: Boolean(user.isBlocked),
  };
}

export function createAuthMiddleware(db) {
  const users = db.collection("user");

  async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === "string" && authHeader.startsWith(BEARER_PREFIX)
        ? authHeader.slice(BEARER_PREFIX.length).trim()
        : "";

    if (!token) {
      return res.status(401).json({ message: "Missing or invalid token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Missing or invalid token" });
    }

    const identifier = decoded?.id || decoded?.email;
    if (!identifier) {
      return res.status(401).json({ message: "Missing or invalid token" });
    }

    try {
      const user = await findUserByIdentifier(users, identifier);

      if (!user) {
        return res.status(401).json({ message: "Missing or invalid token" });
      }

      // Read the live record on every request so role, plan and block changes
      // take effect without waiting for the 7-day token to expire.
      if (user.isBlocked === true) {
        return res
          .status(403)
          .json({ message: "Forbidden: account is blocked" });
      }

      req.user = toPublicUser(user);
      return next();
    } catch {
      return res.status(401).json({ message: "Missing or invalid token" });
    }
  }

  function verifyRole(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Forbidden: insufficient role permissions" });
      }
      return next();
    };
  }

  return {
    verifyToken,
    verifyRole,
    verifyAdmin: verifyRole("admin"),
    verifyVendor: verifyRole("vendor"),
    verifyCustomer: verifyRole("customer"),
  };
}
