import "dotenv/config";
import { MongoClient } from "mongodb";

// Same connection string, database, and collection as index.js.
const client = new MongoClient(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.h7zvbxe.mongodb.net/`,
);

const DATABASE_NAME = "pizzahubdb";
const APPROVED_ITEM_THRESHOLD = 6;

const FORNO_VERDE = {
    vendorId: "65b1000000000000000000a1",
    vendorName: "Forno Verde",
    vendorPremium: false,
};

const NONNA_TABLE = {
    vendorId: "65b1000000000000000000a2",
    vendorName: "Nonna's Table",
    vendorPremium: true,
};

/**
 * Eight approved items cover all six canonical categories. The final item is
 * left pending so the admin moderation queue always has something to review.
 * `seedKey` makes every insert safely repeatable.
 */
const SEED_ITEMS = [
    {
        seedKey: "seed-v1:margherita-classica",
        itemName: "Margherita Classica",
        category: "Classic Pizzas",
        description:
            "San Marzano tomato, fior di latte, fresh basil, and a slow-fermented Neapolitan crust.",
        price: 13,
        location: "Dhanmondi, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1200&q=80",
        ],
        ...FORNO_VERDE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:neapolitan-marinara",
        itemName: "Neapolitan Marinara",
        category: "Classic Pizzas",
        description:
            "A simple, honest classic: crushed tomato, garlic, oregano, basil, and extra virgin olive oil.",
        price: 11,
        location: "Dhanmondi, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80",
        ],
        ...FORNO_VERDE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:burrata-garden",
        itemName: "Burrata & Garden Basil",
        category: "Vegetarian Pizzas",
        description:
            "Creamy burrata, cherry tomatoes, sweet peppers, and a handful of garden basil.",
        price: 16,
        location: "Gulshan, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1200&q=80",
        ],
        ...NONNA_TABLE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:roasted-mushroom-thyme",
        itemName: "Roasted Mushroom & Thyme",
        category: "Vegetarian Pizzas",
        description:
            "Wild mushrooms, thyme, caramelized onion, and a delicate smear of garlic cream.",
        price: 15,
        location: "Gulshan, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=1200&q=80",
        ],
        ...NONNA_TABLE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:smoky-pepperoni-fire",
        itemName: "Smoky Pepperoni Fire",
        category: "Meat Lovers",
        description:
            "Double pepperoni, smoked mozzarella, spicy honey, and a dusting of chili flakes.",
        price: 18,
        location: "Banani, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=1200&q=80",
        ],
        ...FORNO_VERDE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:truffle-honey-fig",
        itemName: "Truffle Honey & Fig",
        category: "Specialty / Gourmet Pizzas",
        description:
            "Black truffle cream, fresh figs, prosciutto, and a drizzle of truffle honey.",
        price: 22,
        location: "Gulshan, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=1200&q=80",
        ],
        ...NONNA_TABLE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:wood-fired-garlic-knots",
        itemName: "Wood-Fired Garlic Knots",
        category: "Sides & Appetizers",
        description:
            "Freshly baked knots tossed in garlic butter, parsley, and parmesan with a marinara dip.",
        price: 7,
        location: "Dhanmondi, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
        ],
        ...FORNO_VERDE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:honey-lavender-gelato",
        itemName: "Honey Lavender Gelato",
        category: "Beverages & Desserts",
        description:
            "Small-batch gelato folded with wildflower honey and a gentle hint of lavender.",
        price: 6,
        location: "Gulshan, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1200&q=80",
        ],
        ...NONNA_TABLE,
        status: "approved",
        active: true,
    },
    {
        seedKey: "seed-v1:smoked-salmon-capers",
        itemName: "Smoked Salmon & Capers",
        category: "Specialty / Gourmet Pizzas",
        description:
            "Awaiting admin review: smoked salmon, capers, red onion, crème fraîche, and dill.",
        price: 24,
        location: "Banani, Dhaka",
        images: [
            "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=1200&q=80",
        ],
        ...NONNA_TABLE,
        status: "pending",
        active: false,
    },
];

async function seed() {
    if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
        throw new Error(
            "Missing DB_USER or DB_PASSWORD. Add them to pizzahub-server/.env before seeding.",
        );
    }

    try {
        await client.connect();
        const items = client.db(DATABASE_NAME).collection("menuItems");
        const approvedCount = await items.countDocuments({ status: "approved" });

        if (approvedCount >= APPROVED_ITEM_THRESHOLD) {
            console.log(
                `Seed skipped: ${approvedCount} approved items already exist (threshold: ${APPROVED_ITEM_THRESHOLD}).`,
            );
            return;
        }

        const operations = SEED_ITEMS.map((item) => ({
            updateOne: {
                filter: { seedKey: item.seedKey },
                update: {
                    $setOnInsert: {
                        ...item,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                },
                upsert: true,
            },
        }));

        const result = await items.bulkWrite(operations);
        console.log(
            `Seed complete: inserted ${result.upsertedCount} of ${SEED_ITEMS.length} sample items (8 approved, 1 pending).`,
        );
        console.log(
            `Approved items now in the catalog: ${await items.countDocuments({ status: "approved" })}.`,
        );
    } finally {
        await client.close();
    }
}

seed().catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
});
