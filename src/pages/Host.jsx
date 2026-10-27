import { useEffect, useRef, useState } from "react";
import { api, hostKeyName, store } from "../api.js";
import { useGameState } from "../useGameState.js";
import { COLUMNS, MAX_NUMBER, MAX_WINNERS, columnOf, numbersInColumn } from "../../server/bingo.js";
import { QrCode } from "../components.jsx";
import { useShow } from "../useShow.js";
import * as sound from "../sound.js";
import Stage from "./Stage.jsx";
import "../fes.css";
import "../fes-remote.css";

// スマホ（画面が狭い・指で操作する端末）なら、司会用のリモコン画面にする
function useIsPhone() {
  const query = "(max-width: 820px), (pointer: coarse) and (max-width: 1100px)";
  const [phone, setPhone] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt("コピーしてください", text);
    return false;
  }
}

// 司会画面（screenOnly のときはボタンなしの映写専用画面）
export default function Host({ id, screenOnly = false }) {
  const [key, setKey] = useState(() => {
    if (screenOnly) return null;
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("key");
    if (fromHash) {
      store.set(hostKeyName(id), fromHash);
      // 合言葉がアドレスバーに残ったままプロジェクターに映らないよう消しておく
      history.replaceState(null, "", location.pathname);
      return fromHash;
    }
    return store.get(hostKeyName(id));
  });
  // 司会と映写の画面は1秒ごとに、キャッシュを通さず最新を取る
  const { state, error, accept } = useGameState(id, 1000, { fresh: true });
  const [pending, setPending] = useState(false); // 「引く」を押してから答えが来るまで
  const [actionError, setActionError] = useState("");
  const [soundOn, setSoundOn] = useState(() => store.get("bingo-sound") !== false);
  const busy = useRef(false);
  const isPhone = useIsPhone();
  const isHost = !screenOnly && !!key;
  const joinUrl = `${location.origin}/join/${id}`;
  const hostUrl = `${location.origin}/host/${id}#key=${key}`;
  const screenUrl = `${location.origin}/screen/${id}`;

  async function act(action, value) {
    if (busy.current) return;
    busy.current = true;
    setActionError("");
    if (action === "draw") setPending(true);
    try {
      accept(await api.host(id, key, action, value));
    } catch (e) {
      setActionError(e.message);
      if (e.status === 403) setKey(null);
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  function toggleSound() {
    sound.unlock();
    setSoundOn((on) => {
      store.set("bingo-sound", !on);
      return !on;
    });
  }

  if (error && !state) return <Message text={error} />;
  if (!state) return <Message text="読み込み中…" />;

  const ctx = { id, state, act, pending, actionError, joinUrl, hostUrl, screenUrl, soundOn, toggleSound };
  if (isHost && isPhone) return <Remote {...ctx} />;
  return <Projector {...ctx} isHost={isHost} screenOnly={screenOnly} error={error} />;
}

// ---- PC：映写画面＋（司会なら）マウスを動かしたときだけ出るボタン ----
function Projector({ state, act, pending, actionError, joinUrl, hostUrl, screenUrl, soundOn, toggleSound, isHost, screenOnly, error }) {
  const [showControls, setShowControls] = useState(false);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState("");
  const [audioReady, setAudioReady] = useState(sound.isReady());
  const hideTimer = useRef();
  const drawn = state.drawn;
  const rolling = state.rolling || pending;
  const ended = state.status === "ended";
  const full = state.winners.length >= MAX_WINNERS;

  function say(text) {
    setToast(text);
    clearTimeout(say.t);
    say.t = setTimeout(() => setToast(""), 1800);
  }

  // マウスを動かしたら2.5秒だけボタンを出す（Hキーで出さないように固定）
  useEffect(() => {
    if (!isHost) return;
    const onMove = () => {
      if (locked) return;
      setShowControls(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (!document.querySelector(".fs-controls:hover")) setShowControls(false);
      }, 2500);
    };
    addEventListener("mousemove", onMove);
    return () => removeEventListener("mousemove", onMove);
  }, [isHost, locked]);

  // 最初のクリック・キーで音を使えるようにする
  useEffect(() => {
    const onFirst = () => {
      sound.unlock();
      setTimeout(() => setAudioReady(sound.isReady()), 150);
    };
    addEventListener("pointerdown", onFirst);
    addEventListener("keydown", onFirst);
    return () => {
      removeEventListener("pointerdown", onFirst);
      removeEventListener("keydown", onFirst);
    };
  }, []);

  // キー操作：Space 引く / Q QRコード / F 全画面 / H ボタンを隠す
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea")) return;
      if (e.code === "KeyF") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
      }
      if (!isHost) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!rolling && !ended) act("draw");
      } else if (e.code === "KeyQ") {
        act("qr", !state.showQr);
      } else if (e.code === "KeyH") {
        setLocked((l) => {
          if (!l) setShowControls(false);
          say(l ? "ボタンを表示します" : "ボタンを隠しました（もう一度 H で元に戻ります）");
          return !l;
        });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const classes = ["fes"];
  if (showControls) classes.push("show-controls");
  else if (isHost) classes.push("hide-cursor");

  return (
    <div className={classes.join(" ")}>
      <Stage state={state} joinUrl={joinUrl} soundOn={soundOn} pendingRoll={pending} />

      {error && <p className="fs-error">{error}</p>}
      {!audioReady && soundOn && <p className="fs-hint">画面をクリックすると音が出ます</p>}
      {toast && <p className="fs-toast">{toast}</p>}

      {isHost && (
        <div className="fs-controls">
          <button className="fs-btn main" onClick={() => act("draw")} disabled={rolling || ended || drawn.length >= MAX_NUMBER}>
            番号を引く<kbd>Space</kbd>
          </button>
          <button className="fs-btn" onClick={() => act("qr", !state.showQr)}>
            QR{state.showQr ? "を隠す" : "を出す"}
            <kbd>Q</kbd>
          </button>
          <button
            className="fs-btn"
            onClick={() => {
              const n = drawn[drawn.length - 1];
              if (n && confirm(`最後に引いた「${columnOf(n)}の${n}」を取り消しますか？`)) act("undo");
            }}
            disabled={!drawn.length || rolling}
          >
            1つ戻す
          </button>
          <button className="fs-btn" onClick={toggleSound}>
            音：{soundOn ? "あり" : "なし"}
          </button>
          <button className="fs-btn" onClick={() => open(screenUrl, "_blank")} title="PCを2画面にして、プロジェクター側にだけ映すとき用">
            映写用の画面
          </button>
          <button className="fs-btn" onClick={() => copyText(hostUrl).then((ok) => ok && say("司会用URLをコピーしました（人に送らないでね）"))}>
            司会用URLをコピー
          </button>
          {!full &&
            (ended ? (
              <button className="fs-btn" onClick={() => act("reopen")}>
                大会を再開
              </button>
            ) : (
              <button className="fs-btn danger" onClick={() => confirm("大会を終了しますか？（新しい参加ができなくなります）") && act("end")}>
                大会を終了
              </button>
            ))}
          {actionError && <span className="fs-btn danger">{actionError}</span>}
        </div>
      )}

      {!screenOnly && !isHost && <p className="fs-error">司会用の合言葉が見つからないので、見るだけのモードです。</p>}
    </div>
  );
}

// ---- スマホ：司会用のリモコン画面（スマホからも音が出る。QRコードを大きく見せられる） ----
function Remote({ state, act, pending, actionError, joinUrl, soundOn, toggleSound }) {
  const [qrOpen, setQrOpen] = useState(false);
  const [audioReady, setAudioReady] = useState(sound.isReady());
  const { rolling, last, face, flipKey, banner } = useShow(state, { soundOn, pendingRoll: pending });
  const drawn = state.drawn;
  const ended = state.status === "ended";
  const full = state.winners.length >= MAX_WINNERS;
  const recent = drawn.slice(-6, -1).reverse();
  const set = new Set(drawn);

  // スマホは、画面をタッチするまで音が出ない決まりなので、最初のタッチで音を使えるようにする
  useEffect(() => {
    const onFirst = () => {
      sound.unlock();
      setTimeout(() => setAudioReady(sound.isReady()), 150);
    };
    addEventListener("pointerdown", onFirst);
    return () => removeEventListener("pointerdown", onFirst);
  }, []);

  function draw() {
    sound.unlock();
    act("draw");
  }

  let card;
  if (rolling) {
    card = (
      <div className="fr-card rolling">
        <span className="fr-num">{face}</span>
      </div>
    );
  } else if (last) {
    card = (
      <div key={flipKey} className={`fr-card ${flipKey ? "flip" : ""}`}>
        <span className={`fr-col col-${columnOf(last)}`}>{columnOf(last)}</span>
        <span className="fr-num">{last}</span>
      </div>
    );
  } else {
    card = (
      <div className="fr-card waiting">
        <span className="fr-num">?</span>
      </div>
    );
  }

  let soundLabel = "音なし";
  if (soundOn) soundLabel = audioReady ? "音あり" : "タップで音ON";

  return (
    <div className="fes-remote">
      <header className="fr-head">
        <img className="fr-logo" src="/fes/logo.webp" alt="かまた祭" />
        <div className="fr-head-r">
          <p className="fr-title">ビンゴ大会</p>
          <button className={`fr-sound ${soundOn ? "on" : ""}`} onClick={toggleSound}>
            {soundOn ? "♪" : "×"} {soundLabel}
          </button>
        </div>
      </header>

      <div className="fr-pills">
        <span>参加 {state.players}人</span>
        <span className="win">ビンゴ {state.winners.length}/{MAX_WINNERS}</span>
        <span>{ended ? "終了" : `のこり ${MAX_NUMBER - drawn.length}`}</span>
      </div>

      <section className="fr-stage">
        <img className="fr-chara fr-kamatu" src="/fes/kamatu.webp" alt="" />
        <img className="fr-chara fr-kokaton" src="/fes/kokaton.webp" alt="" />
        <p className="fr-sign">{rolling ? "抽選中…" : drawn.length ? `${drawn.length}個目` : "スタート！"}</p>
        {card}
      </section>

      {recent.length > 0 && (
        <div className="fr-recent">
          <span className="fr-recent-label">まえ</span>
          {recent.map((n) => (
            <span key={n} className={`fr-chip col-${columnOf(n)}`}>
              {n}
            </span>
          ))}
        </div>
      )}

      <button className="fr-draw" onClick={draw} disabled={rolling || ended || drawn.length >= MAX_NUMBER}>
        {rolling ? "抽選中…" : ended ? "大会は終了しました" : "番号を引く"}
      </button>
      {actionError && <p className="fr-error">{actionError}</p>}

      <button className="fr-qr-btn" onClick={() => setQrOpen(true)}>
        QRコードを見せる
      </button>

      <section className="fr-board">
        <p className="fr-label">でた番号</p>
        {COLUMNS.map((col, c) => (
          <div className={`fr-row col-${col}`} key={col}>
            <span className="fr-head-cell">{col}</span>
            {numbersInColumn(c).map((n) => (
              <span key={n} className={`fr-cell ${set.has(n) ? "on" : ""} ${n === last && !rolling ? "last" : ""}`}>
                {n}
              </span>
            ))}
          </div>
        ))}
      </section>

      {state.winners.length > 0 && (
        <section className="fr-panel">
          <p className="fr-label">ビンゴした人</p>
          <ol className="fr-winners">
            {state.winners.map((w, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {w.name}
                <small>{w.drawCount}個目</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="fr-panel fr-more">
        <summary>そのほかの操作</summary>
        <div className="fr-grid">
          <button onClick={() => act("qr", !state.showQr)}>{state.showQr ? "映写のQRを隠す" : "映写にQRを出す"}</button>
          {!full &&
            (ended ? (
              <button onClick={() => act("reopen")}>大会を再開</button>
            ) : (
              <button className="danger" onClick={() => confirm("大会を終了しますか？（新しい参加ができなくなります）") && act("end")}>
                大会を終了
              </button>
            ))}
        </div>
        <p className="fr-help">
          PCの映写画面とスマホの両方で音を出すと二重に聞こえるので、どちらかを「音なし」にしてね。
        </p>
      </details>

      {qrOpen && (
        <div className="fr-qr" onClick={() => setQrOpen(false)}>
          <p className="fr-qr-title">スマホのカメラで読んで参加！</p>
          <div className="fr-qr-box">
            <QrCode text={joinUrl} size={300} />
          </div>
          <p className="fr-qr-url">{joinUrl.replace(/^https?:\/\//, "")}</p>
          <button className="fr-qr-close">閉じる（画面をタップ）</button>
        </div>
      )}

      {banner && (
        <div className="fr-banner" key={banner.rank}>
          <b>ビンゴ！</b>
          <span>
            {banner.name} さん（{banner.rank}人目）{banner.more > 0 ? `ほか${banner.more}人` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Message({ text }) {
  return (
    <div className="fs-remote fs-center-msg">
      <img src="/fes/logo.webp" alt="かまた祭" />
      <p>{text}</p>
    </div>
  );
}
