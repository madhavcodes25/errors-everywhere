const { applyDiscount, tierDiscountPercent } = require("../src/discount");

test("applies a percentage discount with correct rounding", () => {
  // 42.15 * 0.8 = 33.72. A floor()-based rounding yields 33.71 (classic
  // floating point trap) — exactly the bug the seeded history once had.
  expect(applyDiscount(42.15, 20)).toBe(33.72);
});

test("rejects discount percentages outside 0-100", () => {
  expect(() => applyDiscount(100, 150)).toThrow(/between 0 and 100/);
});

test("applies tier discounts for larger carts", () => {
  // Loop + custom error (instead of many expect().toBe calls) so the failure
  // message — and therefore the Errors Everywhere error signature — is stable.
  for (const [total, expected] of [[50, 5], [200, 10], [500, 15], [30, 0]]) {
    const actual = tierDiscountPercent(total);
    if (actual !== expected) {
      throw new Error(`tier discount for total ${total} should be ${expected}% but got ${actual}%`);
    }
  }
});
