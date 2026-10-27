// オフライン版ビンゴ（このPC1台で番号を引いて表示するだけ。ネット不要）
// 番号の上限を変えるときは MAX_NUMBER だけ変えればいい（例：99 にすると B:1-20 … O:81-99）
const MAX_NUMBER = 75;
const ROLL_SECONDS = 3; // ドラムロールの長さ
const STORE_KEY = "bingo-offline-v1";
const COLUMNS = ["B", "I", "N", "G", "O"];
const DEFAULT_TITLE = "ビンゴ大会";

// 列ごとの範囲（75なら15ずつ、99なら20・20・20・20・19）
const PER_COLUMN = Math.ceil(MAX_NUMBER / 5);
const columnOf = (n) => COLUMNS[Math.floor((n - 1) / PER_COLUMN)];
const numbersIn = (c) => {
  const out = [];
  for (let n = c * PER_COLUMN + 1; n <= Math.min((c + 1) * PER_COLUMN, MAX_NUMBER); n++) out.push(n);
  return out;
};

// ---- 保存（閉じても・再読み込みしても続きから） ----
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.drawn)) {
      return {
        drawn: s.drawn.filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER),
        title: typeof s.title === "string" && !s.title.includes("かまた祭") ? s.title : DEFAULT_TITLE,
        soundOn: s.soundOn !== false,
      };
    }
  } catch {
    /* 読めなければ新しく始める */
  }
  return { drawn: [], title: DEFAULT_TITLE, soundOn: true };
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* 保存できなくても動かす */
  }
}
const state = load();

// ---- 効果音（ファイルの中に埋め込んだ mp3 を鳴らす。音源：効果音ラボ） ----
let ctx = null;
const buffers = {};
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  return ctx;
}
async function loadSounds() {
  const a = audio();
  if (!a || typeof SOUNDS === "undefined") return;
  for (const [name, b64] of Object.entries(SOUNDS)) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      buffers[name] = await new Promise((ok, ng) => a.decodeAudioData(bytes.buffer, ok, ng));
    } catch {
      /* 音が読めなくても番号は引ける */
    }
  }
}
function unlock() {
  const a = audio();
  if (a && a.state === "suspended") a.resume().catch(() => {});
}
function play(name, maxSeconds) {
  if (!state.soundOn || !ctx || ctx.state !== "running" || !buffers[name]) return () => {};
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buffers[name];
  src.connect(g).connect(ctx.destination);
  const t = ctx.currentTime;
  src.start(t);
  if (maxSeconds && buffers[name].duration > maxSeconds) {
    g.gain.setValueAtTime(1, t + maxSeconds - 0.2);
    g.gain.linearRampToValueAtTime(0, t + maxSeconds);
    src.stop(t + maxSeconds + 0.05);
  }
  return () => {
    try {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.12);
      src.stop(now + 0.15);
    } catch {
      /* もう止まっている */
    }
  };
}

// ---- 画面 ----
const $ = (id) => document.getElementById(id);
const COLORS = ["#fff4d6", "#f8b61c", "#fecdd0", "#5fd0ea", "#b9d65a"];

// 毎回同じ並びになる乱数（紙ふぶきやハンコの傾きが、再読み込みで変わらないように）
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const tilt = (n) => ((seeded(n * 7919)() - 0.5) * 6).toFixed(1); // ハンコの傾き ±3°

// 1920×1080 の舞台を、窓の大きさに合わせて拡大・縮小する
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  $("stage").style.transform = `translate(-50%, -50%) scale(${s})`;
}

function buildConfetti() {
  const r = seeded(2026);
  // 番号・キャラの上にかからないよう、すき間の場所にだけ散らす
  const spots = [
    [700, 20, 300, 70],
    [1050, 30, 200, 60],
    [470, 200, 150, 60],
    [1300, 620, 200, 60],
    [1500, 200, 300, 30],
    [40, 190, 200, 30],
  ];
  const html = [];
  spots.forEach(([x, y, w, h], i) => {
    for (let k = 0; k < 4; k++) {
      const left = x + r() * w;
      const top = y + r() * h;
      html.push(
        `<span style="left:${left}px;top:${top}px;background:${COLORS[(i + k) % 5]};transform:rotate(${Math.round(r() * 160 - 80)}deg);width:${30 + Math.round(r() * 26)}px"></span>`,
      );
    }
  });
  // 白い音符（公式サイトと同じ雰囲気の飾り）
  const notes = [
    [660, 130, 56, -12],
    [1240, 90, 48, 10],
    [300, 640, 44, -8],
    [1480, 600, 52, 12],
    [1860, 210, 40, -10],
  ];
  notes.forEach(([x, y, size, rot], i) => {
    html.push(`<i style="left:${x}px;top:${y}px;font-size:${size}px;transform:rotate(${rot}deg)">${i % 2 ? "♫" : "♪"}</i>`);
  });
  $("confetti").innerHTML = html.join("");
}

function buildTitle() {
  // 1文字ずつロゴの色にする
  $("title").innerHTML = [...state.title].map((ch, i) => `<span class="t${(i % 5) + 1}">${ch.replace(/[<>&]/g, "")}</span>`).join("");
  document.title = `かまた祭 ${state.title}`;
}

function buildBoard() {
  $("board").innerHTML = COLUMNS.map((col, c) => {
    const nums = numbersIn(c);
    return `<div class="row col-${col}" style="--cols:${PER_COLUMN}">
      <span class="head-cell">${col}</span>
      ${nums.map((n) => `<span class="cell" data-n="${n}" style="rotate:${tilt(n)}deg">${n}</span>`).join("")}
    </div>`;
  }).join("");
}

function setCard(n, mode) {
  const card = $("card");
  card.className = `card ${mode || ""}`;
  if (n) {
    const col = columnOf(n);
    $("cardCol").textContent = mode === "rolling" ? "" : col;
    $("cardCol").className = `card-col col-${col}`;
    $("cardNum").textContent = n;
  } else {
    $("cardCol").textContent = "";
    $("cardNum").textContent = "?";
  }
}

function render(stampNew = false) {
  const drawn = state.drawn;
  const last = drawn[drawn.length - 1];
  $("remain").textContent = `のこり ${MAX_NUMBER - drawn.length}こ`;
  $("sign").innerHTML = drawn.length ? `${drawn.length}<small>個目</small>` : "スタート！";
  if (!rolling) setCard(last, last ? (stampNew ? "flip" : "") : "waiting");

  const recent = drawn.slice(-6, -1).reverse();
  $("recent").innerHTML = recent.map((n) => `<span class="chip col-${columnOf(n)}"><small>${columnOf(n)}</small>${n}</span>`).join("");
  document.querySelector(".recent").style.visibility = recent.length ? "visible" : "hidden";

  const set = new Set(drawn);
  document.querySelectorAll(".cell").forEach((cell) => {
    const n = Number(cell.dataset.n);
    cell.classList.toggle("on", set.has(n));
    cell.classList.toggle("last", n === last);
    cell.classList.toggle("stamp", stampNew && n === last);
  });

  $("draw").disabled = rolling || drawn.length >= MAX_NUMBER;
  $("undo").disabled = rolling || !drawn.length;
  $("sound").textContent = state.soundOn ? "音：あり" : "音：なし";
}

// ---- 番号を引く ----
let rolling = false;

function randomLeft() {
  const used = new Set(state.drawn);
  const left = [];
  for (let n = 1; n <= MAX_NUMBER; n++) if (!used.has(n)) left.push(n);
  if (!left.length) return null;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return left[r[0] % left.length];
}

async function draw() {
  if (rolling || state.drawn.length >= MAX_NUMBER) return;
  unlock();
  rolling = true;
  render();
  $("sign").innerHTML = "抽選中…";
  const stopRoll = play("drumroll", ROLL_SECONDS + 0.3);
  const spin = setInterval(() => setCard(1 + Math.floor(Math.random() * MAX_NUMBER), "rolling"), 70);

  await new Promise((r) => setTimeout(r, ROLL_SECONDS * 1000));
  clearInterval(spin);
  stopRoll();

  const n = randomLeft();
  if (n !== null) {
    state.drawn.push(n);
    save();
  }
  rolling = false;
  play("rollEnd", 2.5);
  render(true);
}

function undo() {
  if (rolling || !state.drawn.length) return;
  const last = state.drawn[state.drawn.length - 1];
  if (!confirm(`最後に引いた「${columnOf(last)}の${last}」を取り消しますか？`)) return;
  state.drawn.pop();
  save();
  render();
}

function reset() {
  if (rolling) return;
  if (!confirm("引いた番号をすべて消して、最初からやり直しますか？")) return;
  if (state.drawn.length && !confirm(`本当にいいですか？（${state.drawn.length}個の記録が消えます）`)) return;
  state.drawn = [];
  save();
  render();
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function toggleLock() {
  controlsLocked = !controlsLocked;
  if (controlsLocked) {
    document.body.classList.remove("show-controls");
    document.body.classList.add("hide-cursor");
    toast("ボタンを隠しました（もう一度 H で元に戻ります）");
  } else {
    showControls();
    toast("ボタンを表示します");
  }
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// マウスを動かしたときだけボタンを出し、2.5秒動かさなければ隠す（観客の画面にボタンを残さない）
let hideTimer;
let controlsLocked = false;
function showControls() {
  if (controlsLocked) return;
  document.body.classList.add("show-controls");
  document.body.classList.remove("hide-cursor");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!document.querySelector(".controls:hover")) {
      document.body.classList.remove("show-controls");
      document.body.classList.add("hide-cursor");
    }
  }, 2500);
}

// ---- 操作のつなぎ込み ----
$("draw").addEventListener("click", draw);
$("undo").addEventListener("click", undo);
$("reset").addEventListener("click", reset);
$("full").addEventListener("click", toggleFull);
$("sound").addEventListener("click", () => {
  unlock();
  state.soundOn = !state.soundOn;
  save();
  render();
});
$("title").addEventListener("dblclick", () => {
  const t = prompt("タイトル（例：ビンゴ大会）", state.title);
  if (t && t.trim()) {
    state.title = t.trim().slice(0, 12);
    save();
    buildTitle();
  }
});

addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    draw();
  } else if (e.code === "KeyF") toggleFull();
  else if (e.code === "KeyH") toggleLock();
});
addEventListener("pointerdown", unlock);
addEventListener("mousemove", showControls);
addEventListener("resize", fit);
// ボタンを押したあとにスペースキーでそのボタンがもう一度押されないよう、フォーカスを外す
document.querySelectorAll("button").forEach((b) => b.addEventListener("mouseup", () => b.blur()));

fit();
buildConfetti();
buildTitle();
buildBoard();
render();
loadSounds();
