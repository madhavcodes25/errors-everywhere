// POST the event to the TraceBack server, with a timeout and 3 retries
// using exponential backoff. 4xx responses are NOT retried (the server
// refused the event — retrying the same bytes cannot help).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postEvent(serverUrl, event, { timeoutMs = 10000, retries = 3 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return { ok: true, status: res.status, body };
      if (res.status < 500) {
        return { ok: false, status: res.status, body, permanent: true };
      }
      lastError = new Error(`server responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) {
      const backoff = 500 * Math.pow(3, attempt - 1); // 0.5s, 1.5s, 4.5s
      console.log(`[traceback] send failed (${lastError.message}) — retry ${attempt}/${retries - 1} in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  return { ok: false, error: lastError ? lastError.message : "unknown network error" };
}

module.exports = { postEvent };
