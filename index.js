import express from "express";
import cors from "cors";
import 'dotenv/config';
import { MongoClient } from "mongodb";
import { createAuthMiddleware } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.routes.js";
import { menuRoutes, vendorMenuRoutes } from "./routes/menu.routes.js";
import { ordersRoutes, customerOrderRoutes, vendorOrderRoutes } from "./routes/orders.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { profileRoutes } from "./routes/profile.routes.js";
import { stripeRoutes, stripeWebhookHandler } from "./routes/stripe.routes.js";

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());

const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.h7zvbxe.mongodb.net/`);


export async function connectToMongoDB() {
    try {
        await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
} catch (err) {
    console.dir(err);
}
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("pizzahubdb");
const users = database.collection("user");

// The Stripe webhook needs the exact raw bytes to verify its signature, so it
// must be registered before express.json() parses any request bodies.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler(database),
);

app.use(express.json());

// Auth + role middleware, then route factories that share the same db handle.
const auth = createAuthMiddleware(database);
app.use("/api/auth", authRoutes(database));
app.use("/api/admin", adminRoutes(database, auth));
app.use("/api/profile", profileRoutes(database, auth));
app.use("/api/stripe", stripeRoutes(database, auth));
app.use("/api/menu-items", menuRoutes(database, auth));
app.use("/api/vendor", vendorMenuRoutes(database, auth));
app.use("/api/vendor", vendorOrderRoutes(database, auth));
app.use("/api/customer", customerOrderRoutes(database, auth));
app.use("/api/orders", ordersRoutes(database, auth));


app.get("/", (req, res) => {
  res.send("PizzaHub server is running");
});

app.get("/users", async (req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
});

app.listen(port, () => {
  console.log(`PizzaHub is running on port: ${port}`);
});