import { useEffect, useMemo, useState } from "react";
import { COLUMNS, MAX_NUMBER, MAX_WINNERS, columnOf, numbersInColumn } from "../../server/bingo.js";
import { QrCode } from "../components.jsx";
import { useShow } from "../useShow.js";
import "../fes.css";

// 映写画面（かまた祭2026デザイン）。司会のPC画面と、映写専用画面の両方で使う。
// 抽選中（state.rolling）の演出・効果音・ビンゴの帯もここでやる。
const CONFETTI_COLORS = ["#fff4d6", "#f8b61c", "#fecdd0", "#5fd0ea", "#b9d65a"];

// 毎回同じ並びになる乱数（紙ふぶきやハンコの傾きが、再読み込みで変わらないように）
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const tilt = (n) => ((seeded(n * 7919)() - 0.5) * 6).toFixed(1);

function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  return scale;
}

function Confetti() {
  const items = useMemo(() => {
    const r = seeded(2026);
    const spots = [
      [700, 20, 300, 70],
      [1050, 30, 200, 60],
      [470, 200, 150, 60],
      [1300, 620, 200, 60],
      [1500, 200, 300, 30],
      [40, 190, 200, 30],
    ];
    const out = [];
    spots.forEach(([x, y, w, h], i) => {
      for (let k = 0; k < 4; k++) {
        out.push({ left: x + r() * w, top: y + r() * h, color: CONFETTI_COLORS[(i + k) % 5], rot: Math.round(r() * 160 - 80), w: 30 + Math.round(r() * 26) });
      }
    });
    return out;
  }, []);
  const notes = [
    [660, 130, 56, -12],
    [1240, 90, 48, 10],
    [300, 640, 44, -8],
    [1480, 600, 52, 12],
    [1860, 210, 40, -10],
  ];
  return (
    <div className="fs-confetti" aria-hidden>
      {items.map((c, i) => (
        <span key={i} style={{ left: c.left, top: c.top, width: c.w, background: c.color, transform: `rotate(${c.rot}deg)` }} />
      ))}
      {notes.map(([x, y, size, rot], i) => (
        <i key={`n${i}`} style={{ left: x, top: y, fontSize: size, transform: `rotate(${rot}deg)` }}>
          {i % 2 ? "♫" : "♪"}
        </i>
      ))}
    </div>
  );
}

function Cloud() {
  const circles = [
    [70, 110, 62],
    [140, 70, 66],
    [215, 95, 60],
    [235, 135, 46],
    [120, 140, 50],
    [60, 150, 34],
  ];
  return (
    <svg className="fs-cloud" viewBox="0 0 290 190" aria-hidden>
      <g fill="#fff">
        {circles.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
      </g>
      <g fill="#fecdd0">
        {circles.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r - 10} />
        ))}
      </g>
    </svg>
  );
}

function Title({ text }) {
  return (
    <h1 className="fs-title">
      {[...text].map((ch, i) => (
        <span key={i} className={`t${(i % 5) + 1}`}>
          {ch}
        </span>
      ))}
    </h1>
  );
}

export default function Stage({ state, joinUrl, soundOn, pendingRoll = false }) {
  const scale = useStageScale();
  const drawn = state.drawn;
  const last = drawn[drawn.length - 1];
  const { rolling, face, flipKey, banner } = useShow(state, { soundOn, pendingRoll });
  const winnerCount = state.winners.length;

  const showQr = state.showQr && !rolling && state.status === "open";
  const recent = drawn.slice(-6, -1).reverse();
  const set = new Set(drawn);
  const ended = state.status === "ended";

  let sign = drawn.length ? (
    <>
      {drawn.length}
      <small>個目</small>
    </>
  ) : (
    "スタート！"
  );
  if (rolling) sign = "抽選中…";
  else if (showQr) sign = "スマホで参加！";
  else if (ended) sign = "おわり！";

  let card;
  if (showQr) {
    card = (
      <div className="fs-card qr">
        <QrCode text={joinUrl} size={300} />
        <p>{joinUrl.replace(/^https?:\/\//, "")}</p>
      </div>
    );
  } else if (rolling) {
    card = (
      <div className="fs-card rolling">
        <span className="fs-card-num">{face}</span>
      </div>
    );
  } else if (last) {
    card = (
      <div key={flipKey} className={`fs-card ${flipKey ? "flip" : ""}`}>
        <span className={`fs-card-col col-${columnOf(last)}`}>{columnOf(last)}</span>
        <span className="fs-card-num">{last}</span>
      </div>
    );
  } else {
    card = (
      <div className="fs-card waiting">
        <span className="fs-card-num">?</span>
      </div>
    );
  }

  return (
    <div className="fs-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
      <Confetti />

      <header className="fs-head">
        <img className="fs-logo" src="/fes/logo.webp" alt="2026 かまた祭" />
        <Cloud />
        <img className="fs-saien" src="/fes/saien.webp" alt="彩縁 さいえん" />
        <div className="fs-head-right">
          <Title text="ビンゴ大会" />
          <div className="fs-pills">
            <span className="fs-pill">参加 {state.players}人</span>
            <span className="fs-pill win">
              ビンゴ {winnerCount}/{MAX_WINNERS}人
            </span>
            {ended ? <span className="fs-pill dark">終了</span> : <span className="fs-pill">のこり {MAX_NUMBER - drawn.length}こ</span>}
          </div>
        </div>
      </header>

      <img className="fs-chara fs-kamatu" src="/fes/kamatu.webp" alt="" />
      <img className="fs-chara fs-kokaton" src="/fes/kokaton.webp" alt="" />

      <section className="fs-center">
        <img className="fs-collage" src="/fes/collage.webp" alt="" />
        <p className={`fs-sign ${typeof sign === "string" && sign.length > 5 ? "long" : ""}`}>{sign}</p>
        {card}
      </section>

      {recent.length > 0 && (
        <aside className="fs-recent">
          <p className="fs-recent-label">まえの番号</p>
          <div className="fs-recent-list">
            {recent.map((n) => (
              <span key={n} className={`fs-chip col-${columnOf(n)}`}>
                <small>{columnOf(n)}</small>
                {n}
              </span>
            ))}
          </div>
        </aside>
      )}

      <section className="fs-board">
        <p className="fs-board-label">でた番号</p>
        <div className="fs-board-grid">
          {COLUMNS.map((col, c) => (
            <div className={`fs-row col-${col}`} key={col}>
              <span className="fs-head-cell">{col}</span>
              {numbersInColumn(c).map((n) => (
                <span
                  key={n}
                  className={`fs-cell ${set.has(n) ? "on" : ""} ${n === last && !rolling ? "last" : ""} ${n === last && flipKey && !rolling ? "stamp" : ""}`}
                  style={{ rotate: `${tilt(n)}deg` }}
                >
                  {n}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <img className="fs-chara fs-girl" src="/fes/girl.webp" alt="" />

      {banner && (
        <div className="fs-banner" key={`${banner.rank}`}>
          <b>ビンゴ！</b>
          <span>
            {banner.name} さん（{banner.rank}人目）{banner.more > 0 ? `ほか${banner.more}人` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
