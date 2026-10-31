// Payment logic. The Stripe SDK would be used by the real API server; these
// pure helpers model the money math so tests stay fast and network-free.

// Card processing fee (2.9%), the way Stripe prices card charges.
// BUG-TARGET: demo scenarios replace this line to drop the fee.
const FEE_RATE = 0.029;

// "Charge" a card: validate inputs, compute the amount including the fee.
function chargeCard(card, amount) {
  if (!card || typeof card.number !== "string") {
    throw new Error("a card with a number is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  const fee = Math.round(amount * FEE_RATE * 100) / 100;
  const charged = Math.round((amount + fee) * 100) / 100;
  return { ok: true, charged, fee, currency: "usd" };
}

// Refund part of an earlier charge.
function refund(chargeId, amount) {
  if (!chargeId) throw new Error("charge id is required");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("refund amount must be a positive number");
  }
  return { ok: true, refunded: amount, chargeId };
}

// Configuration check: STRIPE_KEY must be present in the environment.
// Values are never logged — only the NAME is reported when missing.
function getStripeKey() {
  const key = process.env.STRIPE_KEY;
  if (!key) throw new Error("STRIPE_KEY is not configured");
  return key;
}

module.exports = { chargeCard, refund, getStripeKey };
