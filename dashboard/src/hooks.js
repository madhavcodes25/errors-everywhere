// Two small hooks: useApi (loading/error/data + retry) and useRunStream
// (live SSE runs + notices, with the connection state for the banner).

import { useEffect, useRef, useState } from "react";
import { API_BASE, getDataSource } from "./config/index.js";

export function useApi(fetcher, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(fetcher)
      .then((body) => {
        if (!alive) return;
        setData(body);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { data, loading, error, retry: () => setAttempt((a) => a + 1) };
}

// Subscribes to GET /stream. onRun fires for every new run, onNotice for
// realtime notices (duplicates, rejected events). In mock mode the stream
// reports "open" without connecting.
export function useRunStream(onRun, onNotice) {
  const [state, setState] = useState("connecting"); // connecting | open | closed
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;

  useEffect(() => {
    if (getDataSource() === "mock") {
      const t = setTimeout(() => setState("open"), 300);
      return () => clearTimeout(t);
    }
    const source = new EventSource(`${API_BASE}/stream`);
    source.addEventListener("open", () => setState("open"));
    source.addEventListener("error", () => setState("closed")); // EventSource retries on its own
    source.addEventListener("run", (event) => {
      try {
        onRunRef.current(JSON.parse(event.data));
      } catch {
        /* malformed frame — ignore */
      }
    });
    source.addEventListener("notice", (event) => {
      try {
        onNoticeRef.current(JSON.parse(event.data));
      } catch {
        /* malformed frame — ignore */
      }
    });
    return () => source.close();
  }, []);

  return state;
}
