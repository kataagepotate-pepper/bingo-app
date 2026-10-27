// PCの中で試すためのAPIサーバー部品。
// 本物のPostgreSQLの代わりに PGlite（PCの中で動くPostgreSQL）を使い、
// Netlify の CDN キャッシュ（1秒）も真似するので、本番に近い動きを確かめられる。
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHandler } from "./handler.js";

export async function createLocalApi({ dataDir = "./.localdb", rollSeconds = 3 } = {}) {
  const pg = new PGlite(dataDir);
  await pg.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));

  // PGlite は1本の接続しか持てないので、問い合わせを順番待ちにする
  let chain = Promise.resolve();
  const enqueue = (work) => {
    const run = chain.then(work);
    chain = run.catch(() => {});
    return run;
  };
  const query = (text, params = []) => enqueue(() => pg.query(text, params)).then((r) => r.rows);
  const transaction = (fn) =>
    enqueue(() => pg.transaction((tx) => fn({ query: (text, params = []) => tx.query(text, params).then((r) => r.rows) })));
  const handle = createHandler({ query, transaction }, { rollSeconds });

  // CDNキャッシュのまね：Netlify-CDN-Cache-Control の s-maxage 秒だけ同じ答えを返す
  const cache = new Map();
  const inflight = new Map();
  const stats = { requests: 0, originHits: 0 };

  async function fetchApi(request, meta = {}) {
    stats.requests++;
    const key = request.method === "GET" ? request.url : null;
    if (key) {
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.toResponse();
      if (inflight.has(key)) return (await inflight.get(key)).toResponse();
    }
    const work = (async () => {
      stats.originHits++;
      const res = await handle(request, meta);
      const body = await res.arrayBuffer();
      const headers = new Headers(res.headers);
      const m = /s-maxage=(\d+)/.exec(headers.get("netlify-cdn-cache-control") || "");
      const entry = {
        expires: Date.now() + (m ? Number(m[1]) * 1000 : 0),
        toResponse: () => new Response(body, { status: res.status, headers }),
      };
      if (key && m) cache.set(key, entry);
      return entry;
    })();
    if (key) inflight.set(key, work);
    try {
      return (await work).toResponse();
    } finally {
      if (key) inflight.delete(key);
    }
  }

  // Node の http サーバーにつなぐための変換
  async function middleware(req, res, next) {
    if (!req.url.startsWith("/api/")) return next();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await fetchApi(request, { ip: req.socket.remoteAddress });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return { middleware, fetchApi, stats, close: () => pg.close() };
}
