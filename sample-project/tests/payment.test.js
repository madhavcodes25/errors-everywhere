const { chargeCard, refund, getStripeKey } = require("../src/payment");

test("payment charges card", () => {
  const result = chargeCard({ number: "4242424242424242" }, 100);
  // Custom error instead of expect().toBe on purpose: the message (and thus
  // the Errors Everywhere error signature) stays identical no matter which machine or
  // number rounding produced the failure: "expected charge 102.9 but got 100".
  if (!result || result.charged !== 102.9) {
    throw new Error(`payment charges card: expected charge 102.9 but got ${result ? result.charged : "nothing"}`);
  }
});

test("payment rejects invalid amounts", () => {
  expect(() => chargeCard({ number: "4242424242424242" }, -5)).toThrow(/positive/);
});

test("payment requires STRIPE_KEY to be configured", () => {
  // Fails when STRIPE_KEY is missing from the environment (scenario E).
  expect(() => getStripeKey()).not.toThrow();
});

test("payment refunds a charge", () => {
  expect(refund("ch_123", 25)).toMatchObject({ ok: true, refunded: 25 });
});
