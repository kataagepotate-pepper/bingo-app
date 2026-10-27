// 大会が終わったあとに、自分のビンゴカードを画像（PNG）にする
import { COLUMNS, FREE } from "../server/bingo.js";

// かまた祭2026の色（ロゴの5色・こげ茶・クリーム）
const COLORS = { B: "#1fa9c9", I: "#e8631f", N: "#8db21e", G: "#1a9b3e", O: "#d3261f" };
const INK = "#623500";
const PAPER = "#fff4df";
const DISPLAY = '"HGS創英角ﾎﾟｯﾌﾟ体", "HG創英角ﾎﾟｯﾌﾟ体", "Mochiy Pop One", "Zen Maru Gothic", sans-serif';
const BODY = '"Zen Maru Gothic", sans-serif';

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 長い文字は幅に収まるように縮める
function fitText(g, text, x, y, maxWidth, size, family) {
  let s = size;
  do {
    g.font = `${s}px ${family}`;
    s -= 2;
  } while (g.measureText(text).width > maxWidth && s > 16);
  g.fillText(text, x, y);
}

export async function makeCardImage({ title, name, numbers, isHit, winning, resultText, drawnCount }) {
  try {
    await Promise.all([document.fonts.load(`40px "Mochiy Pop One"`), document.fonts.load(`700 40px "Zen Maru Gothic"`)]);
  } catch {
    /* フォントが読めなくても普通の文字で描く */
  }

  // 先にカードの大きさを計算して、画像の高さを中身に合わせる（下が見切れないように）
  const W = 1080;
  const pad = 70;
  const cardX = pad;
  const cardY = 260;
  const cardW = W - pad * 2;
  const gap = 14;
  const cell = (cardW - 40 - gap * 4) / 5;
  const cardH = 40 + 90 + gap + (cell + gap) * 5;
  const resultY = cardY + cardH + 110;
  const dateY = resultY + 90;
  const H = Math.ceil(dateY + 90);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");

  // 背景（水玉）
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffe6bd";
  for (let y = 0; y < H; y += 36) for (let x = (y / 36) % 2 ? 18 : 0; x < W; x += 36) g.fillRect(x, y, 5, 5);

  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = INK;
  fitText(g, title, W / 2, 110, W - 160, 64, DISPLAY);
  g.fillStyle = "#8a6a3a";
  fitText(g, `${name} さんのカード`, W / 2, 190, W - 200, 40, BODY);

  // カード本体
  g.fillStyle = INK;
  roundRect(g, cardX + 10, cardY + 10, cardW, cardH, 36);
  g.fill();
  g.fillStyle = "#fffaf0";
  g.strokeStyle = INK;
  g.lineWidth = 6;
  roundRect(g, cardX, cardY, cardW, cardH, 36);
  g.fill();
  g.stroke();

  const gx = cardX + 20;
  let gy = cardY + 20;
  COLUMNS.forEach((col, c) => {
    const x = gx + c * (cell + gap);
    g.fillStyle = COLORS[col];
    roundRect(g, x, gy, cell, 90, 18);
    g.fill();
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = INK;
    g.font = `60px ${DISPLAY}`;
    g.fillText(col, x + cell / 2, gy + 48);
  });
  gy += 90 + gap;

  numbers.forEach((n, i) => {
    const x = gx + (i % 5) * (cell + gap);
    const y = gy + Math.floor(i / 5) * (cell + gap);
    const hit = isHit(i);
    const win = winning.has(i);
    g.fillStyle = win ? "#d93b2d" : hit ? "#f8b61c" : "#ffffff";
    roundRect(g, x, y, cell, cell, 22);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
    if (hit) {
      g.beginPath();
      g.arc(x + cell / 2, y + cell / 2, cell * 0.36, 0, Math.PI * 2);
      g.lineWidth = 9;
      g.strokeStyle = win ? "#ffffff" : "#d93b2d";
      g.stroke();
    }
    g.fillStyle = win ? "#ffffff" : INK;
    if (n === FREE) {
      g.font = `34px ${DISPLAY}`;
      g.fillText("FREE", x + cell / 2, y + cell / 2 + 2);
    } else {
      g.font = `900 ${n >= 10 ? 70 : 76}px ${BODY}`;
      g.fillText(String(n), x + cell / 2, y + cell / 2 + 4);
    }
  });

  // 結果
  g.fillStyle = "#d93b2d";
  fitText(g, resultText, W / 2, resultY, W - 160, 72, DISPLAY);
  g.fillStyle = "#8a6a3a";
  const date = new Date().toLocaleDateString("ja-JP");
  g.font = `700 32px ${BODY}`;
  g.fillText(`${date}　${drawnCount}個の番号が出ました`, W / 2, dateY);

  return canvas.toDataURL("image/png");
}
