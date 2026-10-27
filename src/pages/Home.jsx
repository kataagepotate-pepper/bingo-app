import { useState } from "react";
import { api, hostKeyName, store } from "../api.js";
import { Logo } from "../components.jsx";
import { navigate } from "../main.jsx";

export default function Home() {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recent = store.get("bingo-recent") || [];

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id, hostKey } = await api.createGame(title);
      store.set(hostKeyName(id), hostKey);
      store.set("bingo-recent", [{ id, title: title.trim() }, ...recent.filter((r) => r.id !== id)].slice(0, 5));
      navigate(`/host/${id}#key=${hostKey}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="page home">
      <header className="topbar">
        <Logo />
      </header>
      <main className="home-main">
        <section className="hero">
          <p className="tag">アプリも登録もいらない</p>
          <h1>
            QRを映せば、
            <br />
            <em>会場ぜんぶが</em>
            <br />
            ビンゴカード。
          </h1>
          <p className="lead">大会を作ると司会画面が開きます。スクリーンにQRコードを映すだけで、参加者のスマホにその人だけのカードが配られます。</p>

          <form className="create panel" onSubmit={create}>
            <label htmlFor="title">大会の名前</label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：学園祭 ビンゴ大会"
              maxLength={40}
              required
            />
            <button className="btn btn-primary btn-lg" disabled={busy || !title.trim()}>
              {busy ? "作っています…" : "大会をはじめる"}
            </button>
            {error && <p className="error">{error}</p>}
          </form>

          {recent.length > 0 && (
            <div className="recent">
              <p>このPCで作った大会</p>
              {recent.map((r) => (
                <a key={r.id} href={`/host/${r.id}`} className="chip">
                  {r.title} <small>{r.id}</small>
                </a>
              ))}
            </div>
          )}
        </section>

        <ol className="steps">
          <li>
            <b>1</b>
            <div>
              <h3>QRを映す</h3>
              <p>司会画面をプロジェクターに。参加者はカメラで読むだけ。</p>
            </div>
          </li>
          <li>
            <b>2</b>
            <div>
              <h3>名前を入れてカードGET</h3>
              <p>引いた番号はスマホ側で自動マーク。見逃しなし。</p>
            </div>
          </li>
          <li>
            <b>3</b>
            <div>
              <h3>ビンゴはサーバーが判定</h3>
              <p>当選者は早い順に司会画面へ。うそ申告はできません。</p>
            </div>
          </li>
        </ol>
      </main>
    </div>
  );
}
