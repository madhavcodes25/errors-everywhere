const { addToCart, removeFromCart, cartItemCount } = require("../src/cart");

test("adds a new item to the cart", () => {
  const cart = addToCart([], "MUG-1", 9.99, 2);
  expect(cart).toEqual([{ sku: "MUG-1", price: 9.99, qty: 2 }]);
});

test("merges quantities when the same sku is added twice", () => {
  let cart = addToCart([], "MUG-1", 9.99, 1);
  cart = addToCart(cart, "MUG-1", 9.99, 3);
  expect(cartItemCount(cart)).toBe(4);
});

test("removes an item from the cart", () => {
  let cart = addToCart([], "MUG-1", 9.99);
  cart = addToCart(cart, "TSHIRT-2", 19.5);
  removeFromCart(cart, "MUG-1");
  expect(cartItemCount(cart)).toBe(1);
});

test("throws when removing an unknown sku", () => {
  expect(() => removeFromCart([], "NOPE-1")).toThrow(/not in cart/);
});
