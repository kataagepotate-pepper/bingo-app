// 本番（Netlify）用の入口。Supabase のデータベースにつなぐ。
// DATABASE_URL には Supabase の「Transaction pooler」（ポート 6543）の接続文字列を入れること。
// 普通の直接接続だと、人が集中したときに接続数の上限で落ちる。
import postgres from "postgres";
import { createHandler } from "../../server/handler.js";

let handle = null;

// 接続文字列がおかしくても、エラーの中身（内部の情報）を画面に出さないよう、
// 最初のリクエストのときに準備して、失敗したら決まったメッセージだけ返す
function getHandler() {
  if (handle) return handle;
  const sql = postgres(process.env.DATABASE_URL, {
    prepare: false, // Transaction pooler では必須
    max: 1, // 関数1つにつき接続1本で十分
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });
  handle = createHandler({
    query: (text, params = []) => sql.unsafe(text, params),
    transaction: (fn) => sql.begin((tx) => fn({ query: (text, params = []) => tx.unsafe(text, params) })),
  });
  return handle;
}

export default (req, context) => {
  try {
    return getHandler()(req, { ip: context?.ip });
  } catch (err) {
    console.error("データベースの設定エラー:", err.message);
    return new Response(JSON.stringify({ error: "サーバーの設定エラーです。管理者に連絡してください" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};

export const config = { path: "/api/*" };
