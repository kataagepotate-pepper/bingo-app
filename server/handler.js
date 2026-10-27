// API本体。Request を受け取って Response を返すだけの作りにしてあるので、
// Netlify Functions でも、PCの中のテスト用サーバーでも同じものが動く。
//
//   POST /api/games                 大会を作る
//   GET  /api/games/:id             大会の状態（CDNに1秒キャッシュ）
//   POST /api/games/:id/join        参加してカードをもらう
//   POST /api/games/:id/bingo       ビンゴ申告
//   POST /api/games/:id/host        司会の操作（draw / undo / qr / end / reopen）
//
// db は { query(text, params) => rows[], transaction(fn) } の形のものを渡す。
// transaction(fn) は fn({ query }) を1つのトランザクションの中で実行する。

import { createHash, randomBytes, randomInt as cryptoRandomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { MAX_NUMBER, MAX_WINNERS, evaluateCard, generateCard } from "./bingo.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 見間違えやすい 0/O/1/I は使わない
const MAX_PLAYERS = 1000;
const MAX_BODY = 2048;
const MAX_GAMES_PER_IP_PER_HOUR = 20;
const KEEP_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const randomCode = (len) => Array.from({ length: len }, () => CODE_CHARS[cryptoRandomInt(CODE_CHARS.length)]).join("");
const cryptoRand = () => cryptoRandomInt(2 ** 31) / 2 ** 31;

function safeEqualHex(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

// 参加者が何百人いても、CDN（Netlifyの配達網）が1秒ぶんの答えを使い回すので
// サーバーとデータベースに届くのは1秒に1回程度で済む。
const CDN_CACHE = {
  "Cache-Control": "public, max-age=0, must-revalidate", // スマホのブラウザには溜めない
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=1, stale-while-revalidate=1",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) throw new HttpError(413, "送信データが大きすぎます");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "送信データが大きすぎます");
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new HttpError(400, "送信データの形式が正しくありません");
  }
}

function cleanText(value, max, label) {
  // 見えない制御文字・文字の向きを逆にする記号などで、別人の名前に見せかけられないよう取り除く
  const s = typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim() : "";
  if (!s) throw new HttpError(400, `${label}を入れてください`);
  if ([...s].length > max) throw new HttpError(400, `${label}は${max}文字までです`);
  return s;
}

// 番号を引いてから rollSeconds 秒間（ふつうは3秒）は「抽選中（ドラムロール中）」として、最後の番号を見せない。
// どの画面（司会のスマホ・映写のPC・参加者）でも同じタイミングで番号が出るようにするため。
const VISIBLE_DRAWN = "case when g.reveal_at > now() then g.drawn[1:cardinality(g.drawn) - 1] else g.drawn end";

const STATE_SQL = `
  select g.id, g.title, g.status, to_json(${VISIBLE_DRAWN}) as drawn,
         coalesce(g.reveal_at > now(), false) as rolling,
         greatest(0, coalesce(extract(epoch from g.reveal_at - now()) * 1000, 0))::int as roll_ms,
         g.show_qr,
         (extract(epoch from g.updated_at) * 1000)::bigint::text as v,
         (select count(*) from cards c where c.game_id = g.id)::int as players,
         coalesce((select json_agg(json_build_object('name', w.name, 'drawCount', w.draw_count) order by w.id)
                   from winners w where w.game_id = g.id), '[]'::json) as winners
  from games g where g.id = $1`;

async function getState(db, id) {
  const [row] = await db.query(STATE_SQL, [id]);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    drawn: row.drawn,
    rolling: row.rolling, // true のあいだはドラムロール中（次の番号はまだ見せない）
    rollMs: row.roll_ms, // ドラムロールが終わるまでの残り時間（ミリ秒）
    showQr: row.show_qr, // 映写画面にQRコードを出すか
    players: row.players,
    winners: row.winners,
    v: Number(row.v), // 新しさの目印（古いキャッシュで画面が巻き戻らないように使う）
  };
}

async function requireHost(db, id, key) {
  const [g] = await db.query("select host_key_hash from games where id = $1", [id]);
  if (!g) throw new HttpError(404, "大会が見つかりません");
  if (typeof key !== "string" || !key || !safeEqualHex(sha256(key), g.host_key_hash)) {
    throw new HttpError(403, "司会用の合言葉が違います");
  }
}

async function createGame(db, body, ip) {
  const title = cleanText(body.title, 40, "大会の名前");

  // 誰でも大会を作れるので、同じ回線からの作りすぎを止める（データベースが埋まるのを防ぐ）
  const ipHash = ip ? sha256(`bingo:${ip}`) : null;
  if (ipHash) {
    const [r] = await db.query(
      "select count(*)::int as n from games where creator_ip_hash = $1 and created_at > now() - interval '1 hour'",
      [ipHash],
    );
    if (r.n >= MAX_GAMES_PER_IP_PER_HOUR) throw new HttpError(429, "大会を作りすぎています。しばらく待ってからお試しください");
  }
  // 古い大会（参加者の名前を含む）は自動で消す
  await db.query(`delete from games where created_at < now() - interval '${KEEP_DAYS} days'`);

  const hostKey = randomBytes(18).toString("base64url");
  for (let i = 0; i < 5; i++) {
    const id = randomCode(6);
    const rows = await db.query(
      `insert into games (id, title, host_key_hash, creator_ip_hash) values ($1, $2, $3, $4)
       on conflict (id) do nothing returning id`,
      [id, title, sha256(hostKey), ipHash],
    );
    if (rows.length) return json({ id, hostKey }, 201);
  }
  throw new HttpError(503, "混み合っています。もう一度お試しください");
}

async function join(db, id, body) {
  const name = cleanText(body.name, 20, "名前");
  const [g] = await db.query(
    "select status, (select count(*) from cards c where c.game_id = $1)::int as players from games where id = $1",
    [id],
  );
  if (!g) throw new HttpError(404, "大会が見つかりません");
  if (g.status !== "open") throw new HttpError(409, "この大会は終了しています");
  if (g.players >= MAX_PLAYERS) throw new HttpError(409, "参加者が上限に達しています");

  const cardId = randomUUID();
  const token = randomBytes(18).toString("base64url");
  const numbers = generateCard(cryptoRand);
  await db.query(
    "insert into cards (id, game_id, name, numbers, token_hash) values ($1, $2, $3, $4::smallint[], $5)",
    [cardId, id, name, `{${numbers.join(",")}}`, sha256(token)],
  );
  return json({ cardId, token, name, numbers }, 201);
}

async function claimBingo(db, id, body) {
  const { cardId, token } = body;
  if (typeof cardId !== "string" || !UUID_RE.test(cardId) || typeof token !== "string") {
    throw new HttpError(400, "カード情報が正しくありません");
  }
  const [card] = await db.query(
    `select c.name, c.token_hash, to_json(c.numbers) as numbers, to_json(${VISIBLE_DRAWN}) as drawn
     from cards c join games g on g.id = c.game_id where c.id = $1 and c.game_id = $2`,
    [cardId, id],
  );
  if (!card || !safeEqualHex(sha256(token), card.token_hash)) throw new HttpError(403, "カードが確認できません");

  const { bingo } = evaluateCard(card.numbers, card.drawn);
  if (bingo === 0) return json({ ok: false, message: "まだビンゴになっていません" });

  // 申告は大会ごとに1件ずつ順番に処理する（同時に来ても当選者がちょうど MAX_WINNERS 人で止まるように）
  const result = await db.transaction(async (tx) => {
    const [g] = await tx.query("select status from games where id = $1 for update", [id]);
    const [mine] = await tx.query("select id from winners where game_id = $1 and card_id = $2", [id, cardId]);
    // 同じカードで何度押されても（連打・電波の再送）1件だけ登録し、エラーにはしない
    if (!mine) {
      const [{ n }] = await tx.query("select count(*)::int as n from winners where game_id = $1", [id]);
      if (g.status !== "open" || n >= MAX_WINNERS) return { full: true };
      await tx.query("insert into winners (game_id, card_id, name, draw_count) values ($1, $2, $3, $4)", [
        id,
        cardId,
        card.name,
        card.drawn.length,
      ]);
      // MAX_WINNERS 人目が出たら、その場で大会を終了にする
      await tx.query("update games set updated_at = now(), status = case when $2::boolean then 'ended' else status end where id = $1", [
        id,
        n + 1 >= MAX_WINNERS,
      ]);
    }
    const [r] = await tx.query(
      `select count(*)::int as rank from winners
       where game_id = $1 and id <= (select id from winners where game_id = $1 and card_id = $2)`,
      [id, cardId],
    );
    return { rank: r.rank, alreadyClaimed: !!mine };
  });

  if (result.full) return json({ ok: false, message: `当選者が${MAX_WINNERS}人に達したため、ビンゴ大会は終了しました` });
  return json({ ok: true, ...result });
}

// 番号を引く。サーバー（アメリカ）とデータベース（ソウル）が離れていて1往復が重いので、
// 合言葉の確認・番号選び・保存・最新の状態の取得を、データベースへの1回の問い合わせで済ませる。
// 大会の行をロック（for update）するので、司会が2つの画面で同時に押しても番号はダブらない。
const drawSql = (rollSeconds) => `
  with g as (
    select id, drawn from games
    where id = $1 and host_key_hash = $2 and status = 'open' and (reveal_at is null or reveal_at <= now())
    for update
  ), pick as (
    select n::smallint as n from g, generate_series(1, $3::int) as n
    where not (n::smallint = any (g.drawn))
    order by random() limit 1
  ), upd as (
    update games set drawn = array_append(games.drawn, pick.n), updated_at = now(),
      reveal_at = now() + make_interval(secs => ${Number(rollSeconds)}),
      show_qr = case when cardinality(games.drawn) = 0 then false else games.show_qr end
    from pick where games.id = $1
    returning games.id, games.title, games.status, games.drawn, games.updated_at, games.show_qr
  )
  select u.id, u.title, u.status, to_json(${rollSeconds > 0 ? "u.drawn[1:cardinality(u.drawn) - 1]" : "u.drawn"}) as drawn,
         ${rollSeconds > 0} as rolling, ${Math.round(rollSeconds * 1000)} as roll_ms, u.show_qr,
         (extract(epoch from u.updated_at) * 1000)::bigint::text as v,
         (select count(*) from cards c where c.game_id = u.id)::int as players,
         coalesce((select json_agg(json_build_object('name', w.name, 'drawCount', w.draw_count) order by w.id)
                   from winners w where w.game_id = u.id), '[]'::json) as winners
  from upd u`;

async function draw(db, id, key, rollSeconds) {
  const [row] = await db.query(drawSql(rollSeconds), [id, sha256(typeof key === "string" ? key : ""), MAX_NUMBER]);
  if (row) {
    const { roll_ms, show_qr, ...rest } = row;
    return json({ ...rest, rollMs: roll_ms, showQr: show_qr, v: Number(row.v) });
  }
  // 引けなかったときだけ理由を調べる
  await requireHost(db, id, key);
  const [g] = await db.query(
    "select status, cardinality(drawn)::int as n, coalesce(reveal_at > now(), false) as rolling from games where id = $1",
    [id],
  );
  if (g.status !== "open") throw new HttpError(409, "大会は終了しています");
  if (g.rolling) throw new HttpError(409, "いま抽選中です。番号が出るまで待ってください");
  if (g.n >= MAX_NUMBER) throw new HttpError(409, "すべての番号を引き終わりました");
  throw new HttpError(503, "混み合っています。もう一度押してください");
}

async function hostAction(db, id, body, rollSeconds) {
  const action = body.action;
  if (action === "draw") return draw(db, id, body.key, rollSeconds);

  await requireHost(db, id, body.key);
  if (action === "undo") {
    await db.query(
      `update games set drawn = drawn[1:cardinality(drawn) - 1], reveal_at = null, updated_at = now()
       where id = $1 and cardinality(drawn) > 0`,
      [id],
    );
  } else if (action === "qr") {
    // 映写画面のQRコードを出す／隠す
    await db.query("update games set show_qr = $2::boolean, updated_at = now() where id = $1", [id, body.value === true]);
  } else if (action === "end" || action === "reopen") {
    await db.query("update games set status = $2, updated_at = now() where id = $1", [
      id,
      action === "end" ? "ended" : "open",
    ]);
  } else {
    throw new HttpError(400, "不明な操作です");
  }
  return json(await getState(db, id));
}

// options.rollSeconds：ドラムロールの秒数（テストでは0にして待ち時間をなくす）
export function createHandler(db, { rollSeconds = 3 } = {}) {
  // meta.ip は接続元のIPアドレス（大会の作りすぎ防止にだけ使う）
  return async function handle(req, meta = {}) {
    try {
      const url = new URL(req.url);
      const m = url.pathname.match(/\/api\/(.*)$/);
      const parts = (m ? m[1] : "").split("/").filter(Boolean);
      const method = req.method.toUpperCase();

      if (parts[0] !== "games") throw new HttpError(404, "見つかりません");

      if (parts.length === 1 && method === "POST") return await createGame(db, await readBody(req), meta.ip);

      const id = (parts[1] || "").toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(id)) throw new HttpError(404, "大会が見つかりません");

      if (parts.length === 2 && method === "GET") {
        const state = await getState(db, id);
        if (!state) return json({ error: "大会が見つかりません" }, 404, CDN_CACHE);
        return json(state, 200, CDN_CACHE);
      }
      if (parts.length === 3 && method === "POST") {
        const body = await readBody(req);
        if (parts[2] === "join") return await join(db, id, body);
        if (parts[2] === "bingo") return await claimBingo(db, id, body);
        if (parts[2] === "host") return await hostAction(db, id, body, rollSeconds);
      }
      throw new HttpError(404, "見つかりません");
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "サーバーでエラーが起きました。少し待ってもう一度お試しください" }, 500);
    }
  };
}
