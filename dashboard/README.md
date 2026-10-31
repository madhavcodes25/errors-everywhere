# Error Everywhere — dashboard

The developer-facing UI for TraceBack: every test run, recorded and explained.
Typography-led, dark by default, readable on a projector.

## Run it

```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173
```

The dashboard talks to the TraceBack server (default `http://localhost:4000`).
Start it first: `cd server && npm start`.

## Configure (one file)

`src/config/index.js` — or environment variables at dev time:

- `VITE_API_URL` — server base URL (default `http://localhost:4000`)
- `VITE_PROJECT_ID` — project shown first (default `shop-api`)
- `VITE_USE_MOCK=true` — start on the built-in sample data

"Load sample data" in the welcome flow switches to the same sample data at
runtime (stored in localStorage); switch back any time — no rebuild needed.

## What's inside

- `src/copy/strings.js` — every user-facing sentence (plain language)
- `src/copy/terms.js` — the glossary (run / commit / test / confidence…)
- `src/mock/data.js` — realistic sample data, same shapes as the API
- `src/components/` — reusable pieces (badges, states, culprit cards…)
- `src/pages/` — Timeline, Run detail, Rejected events
- `src/styles/tokens.css` — colour + type tokens (dark and light themes)

## The four questions

1. **Why did it fail?** — open a failed run: a plain verdict per test
   ("New problem: this passed last time"), with confidence and evidence.
2. **What changed?** — side-by-side with the last good run.
3. **Which commit broke it?** — Culprit Ranking: ranked commits, percentage
   bars, and the past runs behind every claim.
4. **Is it safe to release?** — the big verdict on top of the Timeline, with
   every reason and its points.
