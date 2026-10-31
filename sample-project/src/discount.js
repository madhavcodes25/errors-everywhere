// Discount rules for the shop. Pure functions so tests are fast and
// deterministic. Two bug targets live here for demo scenarios:
//   - applyDiscount rounding (a floor-vs-round floating point trap)
//   - tier boundaries (>= vs > off-by-one)

// Apply a percentage discount (0-100) and round to 2 decimals, half up.
function applyDiscount(amount, percent) {
  if (percent < 0 || percent > 100) {
    throw new Error("discount percent must be between 0 and 100");
  }
  const discounted = amount * (1 - percent / 100);
  return Math.round(discounted * 100) / 100;
}

// Volume discount: bigger carts earn bigger percentages.
// BUG-TARGET: demo scenarios tweak these boundaries (>= becomes >).
function tierDiscountPercent(cartTotal) {
  if (cartTotal >= 500) return 15;
  if (cartTotal >= 200) return 10;
  if (cartTotal >= 50) return 5;
  return 0;
}

module.exports = { applyDiscount, tierDiscountPercent };
