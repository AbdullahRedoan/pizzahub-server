import { Router } from "express";
import { ObjectId } from "mongodb";

function findOrderById(orders, id) {
  if (!ObjectId.isValid(id)) return Promise.resolve(null);
  return orders.findOne({ _id: new ObjectId(id) });
}

/** POST /api/orders — customer checkout. */
export function ordersRoutes(db, auth) {
  const router = Router();
  const orders = db.collection("orders");
  const items = db.collection("menuItems");

  router.post("/", auth.verifyToken, auth.verifyCustomer, async (req, res) => {
    if (req.user.role !== "customer") {
      return res
        .status(403)
        .json({ message: "Forbidden: insufficient role permissions" });
    }

    const { itemId, deliveryDate, deliveryAddress, message } = req.body || {};

    if (!itemId || !deliveryDate || !deliveryAddress) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const menuItem = ObjectId.isValid(itemId)
      ? await items.findOne({ _id: new ObjectId(itemId) })
      : null;

    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    if (menuItem.status !== "approved" || menuItem.active !== true) {
      return res.status(400).json({ message: "Menu item is not available" });
    }

    if (String(menuItem.vendorId) === req.user.id) {
      return res.status(403).json({ message: "Vendors cannot order their own items" });
    }

    const duplicate = await orders.findOne({
      customerId: req.user.id,
      itemId,
      deliveryDate,
      status: { $in: ["pending", "accepted"] },
    });

    if (duplicate) {
      return res.status(409).json({
        message: "You already have an active order for this item on that delivery date.",
      });
    }

    const now = new Date();
    const order = {
      itemId,
      status: "pending",
      itemName: menuItem.itemName,
      itemPrice: menuItem.price,
      vendorId: menuItem.vendorId,
      vendorName: menuItem.vendorName,
      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      deliveryDate,
      deliveryAddress,
      message: message || "",
      createdAt: now,
      updatedAt: now,
    };

    const result = await orders.insertOne(order);
    return res.status(201).json({ order: { ...order, _id: result.insertedId } });
  });

  return router;
}

/** Customer order history and cancellation, mounted at /api/customer. */
export function customerOrderRoutes(db, auth) {
  const router = Router();
  const orders = db.collection("orders");

  router.get("/orders", auth.verifyToken, auth.verifyCustomer, async (req, res) => {
    const result = await orders
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ orders: result });
  });

  router.patch(
    "/orders/:id/cancel",
    auth.verifyToken,
    auth.verifyCustomer,
    async (req, res) => {
      const order = await findOrderById(orders, req.params.id);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (String(order.customerId) !== req.user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "pending") {
        return res
          .status(400)
          .json({ message: "Order status has already been finalized" });
      }

      await orders.updateOne(
        { _id: order._id },
        { $set: { status: "cancelled", updatedAt: new Date() } },
      );

      const updated = await orders.findOne({ _id: order._id });
      return res.json({ order: updated });
    },
  );

  return router;
}

/** Vendor order inbox and status updates, mounted at /api/vendor. */
export function vendorOrderRoutes(db, auth) {
  const router = Router();
  const orders = db.collection("orders");

  router.get("/orders", auth.verifyToken, auth.verifyVendor, async (req, res) => {
    const result = await orders
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json({ orders: result });
  });

  router.patch(
    "/orders/:id/status",
    auth.verifyToken,
    auth.verifyVendor,
    async (req, res) => {
      const { status } = req.body || {};

      if (status !== "accepted" && status !== "rejected") {
        return res.status(400).json({ message: "Invalid status" });
      }

      const order = await findOrderById(orders, req.params.id);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (String(order.vendorId) !== req.user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "pending") {
        return res
          .status(400)
          .json({ message: "Order status has already been finalized" });
      }

      await orders.updateOne(
        { _id: order._id },
        { $set: { status, updatedAt: new Date() } },
      );

      const updated = await orders.findOne({ _id: order._id });
      return res.json({ order: updated });
    },
  );

  return router;
}
