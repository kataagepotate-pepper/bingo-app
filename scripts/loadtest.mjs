// 500人がいっせいに参加して、5秒ごとに状態を見に来る状況を再現する負荷テスト。
// 先に別のターミナルで npm start を動かしておくこと。
//   npm run loadtest                    → http://localhost:8787 に500人
//   npm run loadtest -- https://xxx.netlify.app 500 → 本番に対して
import { evaluateCard } from "../server/bingo.js";

const BASE = process.argv[2] || "http://localhost:8787";
const PLAYERS = Number(process.argv[3] || 500);
const DURATION_MS = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lat = { join: [], state: [], bingo: [] };
let errors = 0;
async function call(kind, method, path, body) {
  const t = performance.now();
  try {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json();
    lat[kind]?.push(performance.now() - t);
    if (!res.ok) throw new Error(`${res.status} ${data.error}`);
    return data;
  } catch (e) {
    errors++;
    if (errors <= 5) console.log(`  エラー(${kind}):`, e.message);
    return null;
  }
}
const pct = (arr, p) => (arr.length ? Math.round([...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)]) : 0);

const game = await call("x", "POST", "/api/games", { title: "負荷テスト" });
console.log(`大会 ${game.id} に ${PLAYERS}人が10秒以内に参加します…`);
const end = Date.now() + DURATION_MS;
let winners = 0;

async function player(i) {
  await sleep(Math.random() * 10_000); // QRを読む時間がばらける
  let card = null;
  for (let a = 0; a < 4 && !card; a++) card = await call("join", "POST", `/api/games/${game.id}/join`, { name: `参加者${i}` });
  if (!card) return;
  let claimed = false;
  while (Date.now() < end) {
    const s = await call("state", "GET", `/api/games/${game.id}`);
    if (s && !claimed && evaluateCard(card.numbers, s.drawn).bingo) {
      const r = await call("bingo", "POST", `/api/games/${game.id}/bingo`, { cardId: card.cardId, token: card.token });
      if (r?.ok) { claimed = true; winners++; }
    }
    await sleep(5000 + Math.random() * 500);
  }
}

async function host() {
  await sleep(12_000);
  while (Date.now() < end) {
    await call("x", "POST", `/api/games/${game.id}/host`, { key: game.hostKey, action: "draw" });
    await sleep(3500); // 番号を引いたあと3秒は抽選中（ドラムロール）なので、それより長く待つ
  }
}

const t0 = Date.now();
await Promise.all([host(), ...Array.from({ length: PLAYERS }, (_, i) => player(i))]);
const final = await call("x", "GET", `/api/games/${game.id}`);
const total = lat.join.length + lat.state.length + lat.bingo.length;
console.log(`\n=== 結果（${Math.round((Date.now() - t0) / 1000)}秒） ===`);
console.log(`リクエスト合計: ${total}  エラー: ${errors}`);
console.log(`参加: ${lat.join.length}件  中央値 ${pct(lat.join, 0.5)}ms / 遅い方5% ${pct(lat.join, 0.95)}ms`);
console.log(`状態取得: ${lat.state.length}件  中央値 ${pct(lat.state, 0.5)}ms / 遅い方5% ${pct(lat.state, 0.95)}ms`);
console.log(`ビンゴ申告: ${lat.bingo.length}件  中央値 ${pct(lat.bingo, 0.5)}ms / 遅い方5% ${pct(lat.bingo, 0.95)}ms`);
console.log(`サーバー上の参加者 ${final.players}人 / 当選者 ${final.winners.length}人（申告成功 ${winners}人）`);
