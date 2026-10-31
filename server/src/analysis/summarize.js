// OPTIONAL plain-English summary (Part 7).
//
// PRINCIPLE: rules + MongoDB do the detective work; the LLM only REPHRASES
// verified evidence. It never sees raw logs or secrets (the evidence object
// contains env var NAMES only), and it never decides anything:
//   1. buildEvidence() collects the facts into one small JSON.
//   2. evidenceHash = sha1(evidence) — a cached summary with the same hash is
//      returned without any new call.
//   3. If the LLM is enabled, call the provider (ONE small function, 10s
//      timeout). Its output is then VERIFIED claim by claim against the
//      evidence: every number, file name, commit sha and quoted test name
//      must exist in the evidence. Anything unverifiable -> template.
//   4. The app works FULLY with the LLM off (source: "template").

const crypto = require("crypto");
const { getRun } = require("./history");
const { buildEvidence } = require("./evidence");
const config = require("../config");

const SYSTEM_PROMPT =
  "You explain build failures to developers. Use ONLY the facts in the JSON. " +
  "Do not guess or add anything. Write at most 80 words in simple English. " +
  "Mention the run ID and the most likely culprit commit with its percentage " +
  "and confidence. End with one suggested next action.";

// --- template (always available, needs no LLM) -----------------------------
function templateFromEvidence(e) {
  if (e.status === "passed") {
    return `Run ${e.runId} passed — all ${e.tests.total} test(s) green on ${e.branch}. Nothing to investigate.`;
  }
  const parts = [`Run ${e.runId} (${e.branch}, commit ${String(e.commitSha).slice(0, 7)}) ${e.status}.`];
  for (const test of (e.failedTests || []).slice(0, 2)) {
    parts.push(`${test.name}: ${test.verdict} (confidence ${test.confidence}).`);
  }
  if (e.topCulprit) {
    parts.push(
      `Most likely culprit: ${String(e.topCulprit.sha).slice(0, 7)} "${e.topCulprit.message}" by ${e.topCulprit.author} (${e.topCulprit.matchPercent}% of the evidence).`
    );
  }
  if (e.release) {
    parts.push(`Release check: ${e.release.level} (${e.release.score}/100)${e.release.blocked ? " — release blocked" : ""}.`);
  }
  const confidence = (e.failedTests || [])[0] ? e.failedTests[0].confidence : "low";
  parts.push(`Confidence: ${confidence}.`);
  return parts.join(" ");
}

// --- safety check: verify the LLM text claim by claim ----------------------
// Every number, file name, commit sha, run id and quoted string in the text
// must exist in the evidence JSON. Returns { ok: true } or { ok: false, claim }.
function deriveAllowed(evidence) {
  const allowed = { shas: new Set(), runIds: new Set(), files: new Set(), numbers: new Set(), strings: [] };
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "object") return Object.values(node).forEach(walk);
    if (typeof node === "number") {
      allowed.numbers.add(node);
      return;
    }
    if (typeof node === "string") {
      if (/^[0-9a-f]{40}$/.test(node)) allowed.shas.add(node.toLowerCase());
      if (/^run_[0-9a-f]+$/.test(node)) allowed.runIds.add(node.toLowerCase());
      if (node.includes("/") || /\.(js|json|md|lock|yaml|yml|ts|tsx|jsx)$/i.test(node)) allowed.files.add(node);
      allowed.strings.push(node);
    }
  };
  walk(evidence);
  return allowed;
}

function verifyLlmText(text, evidence) {
  const allowed = deriveAllowed(evidence);
  let rest = String(text);

  // 1) run ids (removed first so their hex isn't mistaken for shas/numbers)
  for (const match of rest.matchAll(/\brun_[0-9a-f]{4,}\b/gi)) {
    const id = match[0].toLowerCase();
    const ok = [...allowed.runIds].some((r) => r === id || r.startsWith(id));
    if (!ok) return { ok: false, claim: id };
  }
  rest = rest.replace(/\brun_[0-9a-f]{4,}\b/gi, " ");

  // 2) commit shas (7-40 hex; must be a prefix of a known sha)
  for (const match of rest.matchAll(/\b[0-9a-f]{7,40}\b/gi)) {
    const sha = match[0].toLowerCase();
    if (![...allowed.shas].some((s) => s.startsWith(sha))) return { ok: false, claim: sha };
  }
  rest = rest.replace(/\b[0-9a-f]{7,40}\b/gi, " ");

  // 3) file names (path-like tokens, then known extensions)
  for (const match of rest.matchAll(/\b[\w@.-]*(?:\/[\w@.-]+)+\b/g)) {
    const file = match[0];
    const ok = [...allowed.files].some((s) => s === file || s.endsWith("/" + file) || s.includes(file));
    if (!ok) return { ok: false, claim: file };
  }
  for (const match of rest.matchAll(/\b[\w@-]+\.(?:js|json|md|lock|yaml|yml|ts|tsx|jsx)\b/gi)) {
    const file = match[0];
    const ok = [...allowed.files].some((s) => s === file || s.endsWith(file) || s.includes(file));
    if (!ok) return { ok: false, claim: file };
  }
  rest = rest
    .replace(/\b[\w@.-]*(?:\/[\w@.-]+)+\b/g, " ")
    .replace(/\b[\w@-]+\.(?:js|json|md|lock|yaml|yml|ts|tsx|jsx)\b/gi, " ");

  // 4) quoted strings (test names, commit messages the LLM might quote)
  for (const match of rest.matchAll(/"([^"]{2,120})"/g)) {
    const quote = match[1];
    if (!allowed.strings.some((s) => s.includes(quote))) return { ok: false, claim: `"${quote}"` };
  }
  rest = rest.replace(/"[^"]{2,120}"/g, " ");

  // 5) numbers (percentages, counts, scores — all must exist in the evidence)
  for (const match of rest.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(match[0]);
    if (!allowed.numbers.has(n)) return { ok: false, claim: String(n) };
  }

  return { ok: true };
}

// --- provider call: ONE small, swappable function ---------------------------
// Reads config.llm at call time. Never logs the key. 10 second timeout.
async function callProvider(evidence) {
  const { provider, model, apiKey, baseUrl } = config.llm;
  const userContent = JSON.stringify(evidence);
  const signal = AbortSignal.timeout(10 * 1000);

  if (provider === "openai") {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`provider responded HTTP ${res.status}`);
    const body = await res.json();
    const text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!text) throw new Error("provider returned no content");
    return text;
  }

  if (provider === "anthropic") {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`provider responded HTTP ${res.status}`);
    const body = await res.json();
    const text = body.content && body.content[0] && body.content[0].text;
    if (!text) throw new Error("provider returned no content");
    return text;
  }

  throw new Error(`unknown MODEL_PROVIDER "${provider}" (use "openai" or "anthropic")`);
}

// Try the LLM path; return { text } on success, null when disabled/failed/
// rejected (caller falls back to the template). Never throws.
async function tryLlmSummary(evidence) {
  if (!config.llm.enabled) return null; // feature off
  if (!config.llm.apiKey) return null; // no key -> template (per the contract)
  try {
    const raw = await callProvider(evidence);
    const check = verifyLlmText(raw, evidence);
    if (!check.ok) {
      console.warn(`[summary] LLM output rejected by the safety check — unverifiable claim: ${check.claim}`);
      return null;
    }
    return { text: String(raw).trim() };
  } catch (err) {
    // err.message never contains the key (fetch/HTTP errors only)
    console.warn(`[summary] LLM call failed — falling back to the template: ${err.message}`);
    return null;
  }
}

// --- HTTP-facing entry point ------------------------------------------------
async function generateSummary(collections, runId, { force = false } = {}) {
  const run = await getRun(collections, runId);
  if (!run) return { code: 404, body: { error: `run not found: ${runId}` } };

  const evidence = await buildEvidence(collections, runId);
  const evidenceHash = crypto.createHash("sha1").update(JSON.stringify(evidence)).digest("hex");

  // Cache: same evidence -> same summary, no new LLM call.
  if (!force && run.summary && run.summary.evidenceHash === evidenceHash) {
    return { code: 200, body: { runId, summary: run.summary, cached: true } };
  }

  const llm = await tryLlmSummary(evidence);
  const summary = {
    text: llm ? llm.text : templateFromEvidence(evidence),
    evidenceHash,
    generatedAt: new Date(),
    source: llm ? "llm" : "template",
  };
  await collections.runs.updateOne({ _id: runId }, { $set: { summary } });
  return { code: 200, body: { runId, summary, cached: false } };
}

module.exports = { generateSummary, templateFromEvidence, verifyLlmText, tryLlmSummary, SYSTEM_PROMPT };
