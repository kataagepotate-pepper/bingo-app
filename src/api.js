// 画面からサーバーへの問い合わせ

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  } catch {
    throw new Error("通信できませんでした。電波の良いところでもう一度お試しください");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "エラーが起きました");
    err.status = res.status;
    throw err;
  }
  return data;
}

const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  createGame: (title) => post("/api/games", { title }),
  // fresh: true のときはCDNのキャッシュを通さず、いつも最新を取る（司会と映写の画面だけ使う）
  getState: (id, fresh = false) => request(`/api/games/${id}${fresh ? `?t=${Date.now()}` : ""}`),
  join: (id, name) => post(`/api/games/${id}/join`, { name }),
  bingo: (id, cardId, token) => post(`/api/games/${id}/bingo`, { cardId, token }),
  host: (id, key, action, value) => post(`/api/games/${id}/host`, { key, action, value }),
};

// localStorage は使えない環境（プライベートモード等）もあるので必ず try で包む
export const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  },
};

export const hostKeyName = (id) => `bingo-host-${id}`;
export const cardKeyName = (id) => `bingo-card-${id}`;
