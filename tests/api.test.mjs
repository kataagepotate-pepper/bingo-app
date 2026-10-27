// サーバーの動きを確かめるテスト（PCの中のデータベースを使う）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApi } from "../server/local.js";
import { MAX_NUMBER, MAX_WINNERS, evaluateCard, generateCard, isValidCard } from "../server/bingo.js";

// テストでは待ち時間をなくすため、ドラムロールを0秒にする
const api = await createLocalApi({ dataDir: mkdtempSync(join(tmpdir(), "bingo-test-")), rollSeconds: 0 });
const call = async (method, path, body) => {
  const res = await api.fetchApi(new Request(`http://t${path}`, { method, body: body && JSON.stringify(body) }));
  return { status: res.status, headers: res.headers, data: await res.json() };
};

test("カードは毎回ルールどおり", () => {
  for (let i = 0; i < 500; i++) assert.ok(isValidCard(generateCard()));
});

test("大会を作って、参加して、番号を引いて、ビンゴ申告まで", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "テスト大会" });
  assert.match(g.id, /^[A-Z0-9]{6}$/);

  const { data: card } = await call("POST", `/api/games/${g.id}/join`, { name: "たろう" });
  assert.ok(isValidCard(card.numbers));

  // 合言葉が違うと引けない
  assert.equal((await call("POST", `/api/games/${g.id}/host`, { key: "wrong", action: "draw" })).status, 403);

  // まだビンゴじゃないのに申告 → 登録されない
  assert.equal((await call("POST", `/api/games/${g.id}/bingo`, { cardId: card.cardId, token: card.token })).data.ok, false);

  // ビンゴになるまで引く
  let state;
  do {
    state = (await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "draw" })).data;
  } while (evaluateCard(card.numbers, state.drawn).bingo === 0);
  assert.equal(new Set(state.drawn).size, state.drawn.length, "番号がダブっていない");

  // 他人のトークンでは申告できない
  assert.equal((await call("POST", `/api/games/${g.id}/bingo`, { cardId: card.cardId, token: "x" })).status, 403);

  // 10回同時に押しても1件だけ登録され、全部エラーにならない
  const results = await Promise.all(
    Array.from({ length: 10 }, () => call("POST", `/api/games/${g.id}/bingo`, { cardId: card.cardId, token: card.token })),
  );
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.rank, 1);
  }

  const res = await call("GET", `/api/games/${g.id}`);
  assert.match(res.headers.get("netlify-cdn-cache-control"), /s-maxage=1/);
});

test("司会が同時に2回押しても番号はダブらない", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "同時押し" });
  await Promise.all(Array.from({ length: 20 }, () => call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "draw" })));
  const { data } = await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "undo" });
  assert.equal(new Set(data.drawn).size, data.drawn.length);
});

test("終了した大会には参加できない", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "終了テスト" });
  await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "end" });
  assert.equal((await call("POST", `/api/games/${g.id}/join`, { name: "はなこ" })).status, 409);
});

test("同じ回線から大会を作りすぎると止まる", async () => {
  const make = () => api.fetchApi(new Request("http://t/api/games", { method: "POST", body: JSON.stringify({ title: "連続" }) }), { ip: "203.0.113.9" });
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await make()).status);
  assert.equal(statuses.filter((s) => s === 201).length, 20);
  assert.equal(statuses.at(-1), 429);
});

test("名前の見えない文字や向きを変える記号は取り除かれる", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "名前テスト" });
  const { data: card } = await call("POST", `/api/games/${g.id}/join`, { name: "た‮ろう\u0000" });
  assert.equal(card.name, "た ろう");
  assert.equal((await call("POST", `/api/games/${g.id}/bingo`, { cardId: "------------------------------------", token: "x" })).status, 400);
});

test("番号は1〜75で、列ごとの範囲を守る", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const card = generateCard();
    assert.ok(isValidCard(card));
    card.forEach((n) => seen.add(n));
  }
  assert.ok(seen.has(75) && seen.has(61) && seen.has(15) && !seen.has(76));
});

test("30人が同時に申告しても当選は20人ちょうどで、大会が自動で終わる", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "20人で終了" });
  const cards = [];
  for (let i = 0; i < 30; i++) cards.push((await call("POST", `/api/games/${g.id}/join`, { name: `人${i}` })).data);
  for (let i = 0; i < MAX_NUMBER; i++) await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "draw" });

  const results = await Promise.all(cards.map((c) => call("POST", `/api/games/${g.id}/bingo`, { cardId: c.cardId, token: c.token })));
  assert.ok(results.every((r) => r.status === 200), "エラーにはならない");
  const ok = results.filter((r) => r.data.ok);
  assert.equal(ok.length, MAX_WINNERS);
  assert.deepEqual(ok.map((r) => r.data.rank).sort((a, b) => a - b), Array.from({ length: MAX_WINNERS }, (_, i) => i + 1));

  const { data: s } = await call("GET", `/api/games/${g.id}?fresh=1`);
  assert.equal(s.winners.length, MAX_WINNERS);
  assert.equal(s.status, "ended");

  // 当選済みの人がもう一度押しても順位はそのまま
  const again = await call("POST", `/api/games/${g.id}/bingo`, { cardId: ok[0] && cards[results.indexOf(ok[0])].cardId, token: cards[results.indexOf(ok[0])].token });
  assert.equal(again.data.ok, true);
  assert.equal(again.data.alreadyClaimed, true);
});

test("番号を引く：合言葉違い・終了後・全部引いた後はちゃんと断る", async () => {
  const { data: g } = await call("POST", "/api/games", { title: "引く処理" });
  const draw = (key = g.hostKey) => call("POST", `/api/games/${g.id}/host`, { key, action: "draw" });
  assert.equal((await draw("wrong")).status, 403);
  let last;
  for (let i = 0; i < MAX_NUMBER; i++) last = await draw();
  assert.equal(last.status, 200);
  assert.equal(new Set(last.data.drawn).size, MAX_NUMBER);
  assert.equal(typeof last.data.v, "number");
  const over = await draw();
  assert.equal(over.status, 409);
  assert.match(over.data.error, /すべての番号/);
  await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "undo" });
  await call("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "end" });
  assert.match((await draw()).data.error, /終了/);
});

test("抽選中（ドラムロール中）は番号が見えず、次も引けない。時間がたつと番号が出る", async () => {
  const slow = await createLocalApi({ dataDir: mkdtempSync(join(tmpdir(), "bingo-roll-")), rollSeconds: 1 });
  const c2 = async (method, path, body) => {
    const res = await slow.fetchApi(new Request(`http://t${path}?${Math.random()}`, { method, body: body && JSON.stringify(body) }));
    return { status: res.status, data: await res.json() };
  };
  const { data: g } = await c2("POST", "/api/games", { title: "抽選中テスト" });
  assert.equal((await c2("GET", `/api/games/${g.id}`)).data.showQr, true, "始まる前はQRを出す");

  const first = await c2("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "draw" });
  assert.equal(first.data.rolling, true);
  assert.equal(first.data.drawn.length, 0, "抽選中は番号を見せない");
  assert.equal(first.data.showQr, false, "1つ目を引いたらQRは自動で隠れる");
  assert.equal((await c2("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "draw" })).status, 409, "抽選中は次を引けない");

  await new Promise((r) => setTimeout(r, 1200));
  const after = (await c2("GET", `/api/games/${g.id}`)).data;
  assert.equal(after.rolling, false);
  assert.equal(after.drawn.length, 1, "時間がたつと番号が出る");

  await c2("POST", `/api/games/${g.id}/host`, { key: g.hostKey, action: "qr", value: true });
  assert.equal((await c2("GET", `/api/games/${g.id}`)).data.showQr, true, "司会がQRをまた出せる");
  await slow.close();
});
