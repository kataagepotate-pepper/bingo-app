// ビンゴのルール（サーバーと画面の両方で使う）

export const COLUMNS = ["B", "I", "N", "G", "O"];
export const MAX_NUMBER = 75;
export const FREE = 0;
export const MAX_WINNERS = 20; // この人数がビンゴしたら大会を自動で終了する

// 縦の列ごとに範囲が決まっている（B:1-15, I:16-30, N:31-45, G:46-60, O:61-75）
// 99まで増やすときは MAX_NUMBER を99にして、範囲を [1,20] [21,40] [41,60] [61,80] [81,99] にする
export const COLUMN_RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export function columnIndex(n) {
  return COLUMN_RANGES.findIndex(([lo, hi]) => n >= lo && n <= hi);
}

export function columnOf(n) {
  return COLUMNS[columnIndex(n)];
}

export function numbersInColumn(c) {
  const [lo, hi] = COLUMN_RANGES[c];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export function randomInt(max, rand = Math.random) {
  return Math.floor(rand() * max);
}

// 25マスを左上から横向きに並べた配列を返す。真ん中は FREE。
export function generateCard(rand = Math.random) {
  const cols = COLUMNS.map((_, c) => {
    const pool = numbersInColumn(c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(i + 1, rand);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 5);
  });
  const cells = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push(cols[c][r]);
  cells[12] = FREE;
  return cells;
}

export const LINES = (() => {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push([0, 1, 2, 3, 4].map((c) => i * 5 + c)); // 横
    lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + i)); // 縦
  }
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]); // ななめ
  return lines;
})();

// ビンゴの数・リーチの数・そろったマスを数える
export function evaluateCard(cells, drawn) {
  const hit = new Set(drawn);
  const isHit = (i) => cells[i] === FREE || hit.has(cells[i]);
  let bingo = 0;
  let reach = 0;
  const winning = new Set();
  for (const line of LINES) {
    const count = line.filter(isHit).length;
    if (count === 5) {
      bingo++;
      line.forEach((i) => winning.add(i));
    } else if (count === 4) reach++;
  }
  return { bingo, reach, winning, isHit };
}

export function isValidCard(cells) {
  if (!Array.isArray(cells) || cells.length !== 25 || cells[12] !== FREE) return false;
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    if (i === 12) continue;
    const n = cells[i];
    const c = i % 5;
    if (!Number.isInteger(n) || columnIndex(n) !== c || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}
