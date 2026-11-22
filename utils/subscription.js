import { ObjectId } from "mongodb";

export const FREE_PLAN_ITEM_LIMIT = 3;
export const FREE_PLAN_LIMIT_CODE = "FREE_PLAN_LIMIT";
export const FREE_PLAN_LIMIT_MESSAGE =
  "Free plan allows a maximum of 3 active menu items. Upgrade to Premium for unlimited active items.";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isPremiumPlan(plan) {
  return String(plan || "").toLowerCase() === "premium";
}

/**
 * Vendor references are stored as strings in most collections but can be
 * ObjectIds elsewhere, so always match both shapes plus the vendor email.
 */
export function menuItemOwnerFilter(vendorId, vendorEmail) {
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

async function activeItemCount(menuItems, filter, excludeId) {
  const query = { ...filter, active: true };
  if (excludeId) query._id = { $ne: excludeId };
  return menuItems.countDocuments(query);
}

/** Shared gate for create/activate/approve paths. */
export async function checkFreePlanLimit(
  menuItems,
  { vendorId, vendorEmail, plan, excludeId },
) {
  if (isPremiumPlan(plan)) return { allowed: true, activeCount: 0 };

  const activeCount = await activeItemCount(
    menuItems,
    menuItemOwnerFilter(vendorId, vendorEmail),
    excludeId,
  );

  return { allowed: activeCount < FREE_PLAN_ITEM_LIMIT, activeCount };
}

/** Keep only the 3 newest active items after a Premium cancellation. */
export async function trimActiveItemsToFreeLimit(menuItems, filter) {
  const activeItems = await menuItems
    .find({ ...filter, active: true })
    .sort({ createdAt: -1 })
    .toArray();

  const excess = activeItems.slice(FREE_PLAN_ITEM_LIMIT);
  if (excess.length === 0) return 0;

  await menuItems.updateMany(
    { _id: { $in: excess.map((item) => item._id) } },
    { $set: { active: false, updatedAt: new Date() } },
  );

  return excess.length;
}
