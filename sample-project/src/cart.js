// Cart helpers. A cart is a plain array of { sku, price, qty } items.
// lodash's sumBy is used for counting — one of the "real dependencies"
// the sample project ships with.

const { sumBy } = require("lodash");

// Add an item (or merge quantities if the sku is already in the cart).
function addToCart(cart, sku, price, qty = 1) {
  if (qty < 1) throw new Error("qty must be at least 1");
  const existing = cart.find((item) => item.sku === sku);
  if (existing) existing.qty += qty;
  else cart.push({ sku, price, qty });
  return cart;
}

// Remove an item by sku; throws if the sku is not in the cart.
function removeFromCart(cart, sku) {
  const index = cart.findIndex((item) => item.sku === sku);
  if (index === -1) throw new Error(`sku not in cart: ${sku}`);
  cart.splice(index, 1);
  return cart;
}

// Total number of units across all items.
function cartItemCount(cart) {
  return sumBy(cart, "qty");
}

module.exports = { addToCart, removeFromCart, cartItemCount };
