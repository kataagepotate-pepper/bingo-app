import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { COLUMNS, FREE, columnOf, numbersInColumn } from "../server/bingo.js";

export function Logo({ small }) {
  return (
    <a href="/" className={`logo ${small ? "logo-small" : ""}`}>
      <img className="logo-img" src="/fes/logo.webp" alt="かまた祭" />
      <span className="logo-text">ビンゴ大会</span>
    </a>
  );
}

export function QrCode({ text, size = 320 }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#2a1a12", light: "#ffffff" } })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt="参加用QRコード" /> : <div className="qr" style={{ width: size, height: size }} />;
}

// 引いた番号の表示（列ごとに色分けしたボール）
export function Ball({ n, size = "md", pop = false }) {
  const col = columnOf(n);
  return (
    <span className={`ball ball-${size} col-${col} ${pop ? "pop" : ""}`}>
      <small>{col}</small>
      {n}
    </span>
  );
}

// 1〜75の番号表。引いた番号に色が付く
export function NumberBoard({ drawn }) {
  const set = new Set(drawn);
  const last = drawn[drawn.length - 1];
  return (
    <div className="board">
      {COLUMNS.map((col, c) => (
        <div className="board-row" key={col}>
          <span className={`board-head col-${col}`}>{col}</span>
          {numbersInColumn(c).map((n) => (
            <span key={n} className={`board-cell ${set.has(n) ? `on col-${col}` : ""} ${n === last ? "last" : ""}`}>
              {n}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BingoCard({ numbers, isHit, winning }) {
  return (
    <div className="card">
      {COLUMNS.map((c) => (
        <div key={c} className={`card-head col-${c}`}>
          {c}
        </div>
      ))}
      {numbers.map((n, i) => (
        <div key={i} className={`card-cell ${isHit(i) ? "hit" : ""} ${winning.has(i) ? "win" : ""} ${n === FREE ? "free" : ""}`}>
          {n === FREE ? "FREE" : n}
        </div>
      ))}
    </div>
  );
}

export function WinnerList({ winners, compact }) {
  if (!winners.length) return <p className="muted">まだビンゴの人はいません</p>;
  return (
    <ol className={`winners ${compact ? "compact" : ""}`}>
      {winners.map((w, i) => (
        <li key={i}>
          <span className="rank">{i + 1}</span>
          <span className="wname">{w.name}</span>
          <span className="wdraw">{w.drawCount}個目</span>
        </li>
      ))}
    </ol>
  );
}

export function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((i) => (
        <span
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 10) * 0.12}s`,
            background: ["#ff5a3c", "#ffc531", "#22b0a0", "#3d7cf5", "#ff8fb3"][i % 5],
          }}
        />
      ))}
    </div>
  );
}
