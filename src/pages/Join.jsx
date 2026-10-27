import { useEffect, useRef, useState } from "react";
import { api, cardKeyName, store } from "../api.js";
import { FREE, MAX_WINNERS, evaluateCard, isValidCard } from "../../server/bingo.js";
import { makeCardImage } from "../cardImage.js";
import * as sound from "../sound.js";
import { Ball, BingoCard, Confetti, Logo, WinnerList } from "../components.jsx";
import { useGameState } from "../useGameState.js";

// 参加者のスマホ画面
export default function Join({ id }) {
  const [card, setCard] = useState(() => {
    const saved = store.get(cardKeyName(id));
    return saved && isValidCard(saved.numbers) ? saved : null;
  });
  const { state, error, refresh } = useGameState(id, 1000);

  if (error && !state) return <Message text={error} />;
  if (!state) return <Message text="読み込み中…" />;
  if (!card) return <JoinForm id={id} state={state} onJoined={setCard} />;
  return <Player id={id} state={state} card={card} error={error} refresh={refresh} />;
}

function JoinForm({ id, state, onJoined }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    sound.unlock();
    setBusy(true);
    setErr("");
    // 一斉に押されて混んでいるときのために、失敗したら少し待って自動でやり直す
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const c = await api.join(id, name);
        store.set(cardKeyName(id), c);
        onJoined(c);
        return;
      } catch (e2) {
        if (e2.status && e2.status < 500) {
          setErr(e2.message);
          break;
        }
        if (attempt === 3) setErr(e2.message);
        else await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 800));
      }
    }
    setBusy(false);
  }

  return (
    <div className="page join">
      <header className="topbar">
        <Logo small />
      </header>
      <main className="join-main">
        <p className="tag">ビンゴ大会に参加</p>
        <h1 className="join-title">{state.title}</h1>
        {state.status === "ended" ? (
          <p className="panel">この大会は終了しました。</p>
        ) : (
          <form className="panel create" onSubmit={submit}>
            <label htmlFor="name">ニックネーム</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：たろう" maxLength={20} required autoComplete="nickname" />
            <p className="muted small">ビンゴしたとき、スクリーンにこの名前が出ます</p>
            <button className="btn btn-primary btn-lg" disabled={busy || !name.trim()}>
              {busy ? "カードを配っています…" : "カードをもらう"}
            </button>
            {err && <p className="error">{err}</p>}
          </form>
        )}
      </main>
    </div>
  );
}

function Player({ id, state, card, error, refresh }) {
  const { bingo, reach, winning, isHit } = evaluateCard(card.numbers, state.drawn);
  const [result, setResult] = useState(() => store.get(`${cardKeyName(id)}-result`));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const last = state.drawn[state.drawn.length - 1];
  const lastHit = last && card.numbers.includes(last);
  const hits = card.numbers.filter((n, i) => n !== FREE && isHit(i)).length;
  const prev = useRef(null);
  const ended = state.status === "ended";
  const [soundOn, setSoundOn] = useState(() => store.get("bingo-sound-phone") !== false);
  const [audioReady, setAudioReady] = useState(sound.isReady());

  useEffect(() => {
    sound.preload(["hit", "reach", "bingo"]);
    const onFirst = () => {
      sound.unlock();
      setTimeout(() => setAudioReady(sound.isReady()), 100);
    };
    addEventListener("pointerdown", onFirst);
    return () => removeEventListener("pointerdown", onFirst);
  }, []);

  // 効果音：一番大事なものを1つだけ鳴らす（ビンゴ ＞ リーチ ＞ 穴が空いた）
  useEffect(() => {
    const before = prev.current;
    prev.current = { hits, reach, bingo };
    if (!before) return; // 開いた時点の状態では鳴らさない
    if (bingo > before.bingo) {
      if (soundOn) sound.play("bingo");
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } else if (reach > before.reach) {
      if (soundOn) sound.play("reach");
    } else if (hits > before.hits) {
      if (soundOn) sound.play("hit");
    }
  }, [hits, reach, bingo, soundOn]);

  function toggleSound() {
    sound.unlock();
    setTimeout(() => setAudioReady(sound.isReady()), 100);
    setSoundOn((on) => {
      store.set("bingo-sound-phone", !on);
      return !on;
    });
  }

  let soundLabel = "🔇 音なし";
  if (soundOn) soundLabel = audioReady ? "🔊 音あり" : "🔈 タップで音ON";

  async function claim() {
    setBusy(true);
    setMsg("");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await api.bingo(id, card.cardId, card.token);
        if (r.ok) {
          setResult(r);
          store.set(`${cardKeyName(id)}-result`, r);
        } else setMsg(r.message);
        break;
      } catch (e) {
        if ((e.status && e.status < 500) || attempt === 3) {
          setMsg(e.message);
          break;
        }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    setBusy(false);
  }

  return (
    <div className="page player">
      {result && <Confetti />}
      <header className="player-top">
        <div>
          <p className="player-game">{state.title}</p>
          <p className="player-name">{card.name} さんのカード</p>
        </div>
        <div className="player-last">
          <div className="player-tools">
            <button className="refresh" onClick={toggleSound} aria-pressed={soundOn}>
              {soundLabel}
            </button>
            <button className="refresh" onClick={refresh} aria-label="最新の番号に更新">
              ↻ 更新
            </button>
          </div>
          {last ? <Ball key={last} n={last} size="md" pop /> : <span className="ball ball-md empty">?</span>}
          <small>{state.drawn.length}個目</small>
        </div>
      </header>

      {error && <p className="banner">{error}</p>}

      {ended && <EndPanel state={state} result={result} />}

      {last && lastHit && !result && !ended && <p className="toast">あった！ {last} をマークしました</p>}

      <BingoCard numbers={card.numbers} isHit={isHit} winning={winning} />

      <div className="player-status">
        {result ? (
          <div className="won">
            <p className="won-big">BINGO!</p>
            <p>{result.rank}番目のビンゴです 🎉 司会の案内を待ってね</p>
          </div>
        ) : ended ? null : bingo > 0 ? (
          <button className="btn btn-primary btn-xl bingo-btn" onClick={claim} disabled={busy}>
            {busy ? "確認中…" : "ビンゴ！を申告する"}
          </button>
        ) : reach > 0 ? (
          <p className="reach">リーチ ×{reach}</p>
        ) : (
          <p className="muted">番号が出ると自動でマークされます</p>
        )}
        {msg && <p className="error">{msg}</p>}
      </div>

      {state.winners.length > 0 && (
        <section className="panel">
          <h2 className="small-h">ビンゴした人</h2>
          <WinnerList winners={state.winners} compact />
        </section>
      )}
      {ended && <CardDownload id={id} state={state} card={card} isHit={isHit} winning={winning} result={result} />}

      <p className="muted small center-text">画面を閉じても、このスマホで開き直せば同じカードに戻れます</p>
    </div>
  );
}

function Message({ text }) {
  return (
    <div className="page center">
      <Logo />
      <p className="center-msg">{text}</p>
    </div>
  );
}

function EndPanel({ state, result }) {
  const full = state.winners.length >= MAX_WINNERS;
  return (
    <section className="end-panel">
      <p className="end-big">ビンゴ大会 終了！</p>
      <p>{full ? `当選者が${MAX_WINNERS}人に達しました。` : "司会者が大会を終了しました。"}</p>
      <p>{result ? `あなたは${result.rank}番目のビンゴでした 🎉` : "参加ありがとうございました！"}</p>
    </section>
  );
}

function CardDownload({ id, state, card, isHit, winning, result }) {
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    try {
      setSrc(
        await makeCardImage({
          title: state.title,
          name: card.name,
          numbers: card.numbers,
          isHit,
          winning,
          drawnCount: state.drawn.length,
          resultText: result ? `${result.rank}番目にBINGO！` : "参加ありがとう！",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  // スマホでは共有メニュー（「画像を保存」「写真に保存」が選べる）を開く。使えなければ普通にダウンロード
  async function save() {
    const fileName = `bingo-${id}.png`;
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: state.title });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // 共有メニューを閉じただけ
    }
    const a = document.createElement("a");
    a.href = src;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <section className="panel download">
      <h2 className="small-h">カードを画像で保存</h2>
      {src ? (
        <>
          <img src={src} alt="ビンゴカードの画像" className="card-image" />
          <button className="btn btn-primary btn-lg" onClick={save}>
            画像を保存
          </button>
          <p className="muted small">うまく保存できないときは、画像を長押しして「写真に保存」してね</p>
        </>
      ) : (
        <button className="btn btn-primary btn-lg" onClick={make} disabled={busy}>
          {busy ? "画像を作っています…" : "カードを画像にする"}
        </button>
      )}
    </section>
  );
}
