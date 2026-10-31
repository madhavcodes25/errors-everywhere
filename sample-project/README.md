# shop-api (sample project for TraceBack)

A tiny e-commerce API core used as the sample project for **TraceBack**, the
flight recorder for builds. It is intentionally small — pure modules plus
Jest tests — so demo scenarios can break things on purpose and TraceBack can
explain what happened.

## Modules

- `src/cart.js` — cart helpers (add, remove, count)
- `src/discount.js` — percentage and tiered discounts
- `src/payment.js` — charges, refunds, configuration checks
- `src/auth.js` — token issuing/verification and password hashing

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
npm test
```

## Environment variables

`DATABASE_URL` and `STRIPE_KEY` are required. TraceBack records only their
names, never their values.
