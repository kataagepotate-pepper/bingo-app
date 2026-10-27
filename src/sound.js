// 効果音（public/sounds/ の mp3 を鳴らす。音源：効果音ラボ https://soundeffect-lab.info/）
// ブラウザは「ユーザーが一度タップ・クリックするまで音を出さない」決まりなので、
// 最初の操作で unlock() を呼んで音を出せる状態にする。

const FILES = {
  drumroll: "/sounds/drumroll.mp3", // 抽選中（PC）
  rollEnd: "/sounds/roll-end.mp3", // 番号が出た瞬間（PC）
  firstWinner: "/sounds/first-winner.mp3", // 1人目のビンゴ（PC）
  winner: "/sounds/winner.mp3", // 2人目以降のビンゴ（PC）
  gong: "/sounds/gong.mp3", // 最後の当選者で終了（PC）
  hit: "/sounds/hit.mp3", // 自分のカードの穴が空いた（スマホ）
  reach: "/sounds/reach.mp3", // リーチ（スマホ）
  bingo: "/sounds/bingo.mp3", // ビンゴ（スマホ）
};

let ctx = null;
let master = null;
const buffers = {};
const loading = {};
let busyUntil = 0; // いま鳴っている大事な音が終わる時刻（重ねないため）
const lastPlayed = {};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlock() {
  const a = audio();
  if (a && a.state === "suspended") a.resume().catch(() => {});
}

export function isReady() {
  return !!ctx && ctx.state === "running";
}

// 使う音だけ先に読み込んでおく（スマホは3つだけ読み込むので通信量も小さい）
export function preload(names) {
  const a = audio();
  if (!a) return Promise.resolve();
  return Promise.all(
    names.map((name) => {
      if (buffers[name] || loading[name]) return loading[name];
      loading[name] = fetch(FILES[name])
        .then((r) => r.arrayBuffer())
        .then((data) => new Promise((ok, ng) => a.decodeAudioData(data, ok, ng)))
        .then((buf) => (buffers[name] = buf))
        .catch(() => null);
      return loading[name];
    }),
  );
}

export function duration(name) {
  return buffers[name]?.duration || 0;
}

// 鳴らす。止めるための関数を返す
// wait: 大事な音が鳴っている間は待ってから鳴らす / cooldown: 同じ音を続けて鳴らさない秒数
export function play(name, { volume = 1, wait = false, cooldown = 0, maxSeconds } = {}) {
  if (!isReady() || !buffers[name]) return () => {};
  const now = ctx.currentTime;
  if (cooldown && now - (lastPlayed[name] ?? -Infinity) < cooldown) return () => {};
  lastPlayed[name] = now;

  const start = wait ? Math.max(now, busyUntil) : now;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(master);
  src.start(start);
  const length = Math.min(buffers[name].duration, maxSeconds ?? Infinity);
  if (maxSeconds) {
    g.gain.setValueAtTime(volume, start + length - 0.15);
    g.gain.linearRampToValueAtTime(0, start + length);
    src.stop(start + length + 0.05);
  }
  busyUntil = Math.max(busyUntil, start + Math.min(length, 2.5));

  return () => {
    try {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
      src.stop(t + 0.15);
    } catch {
      /* もう止まっている */
    }
  };
}
