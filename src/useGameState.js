import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// 大会の状態を数秒ごとに取りに行く。
// - 画面が裏に回っている間は止める（電池と通信量の節約）
// - 何百台が同時に問い合わせないよう、間隔を少しずつずらす
// - CDNの古い答えで画面が巻き戻らないよう、v（新しさの目印）が古いものは捨てる
// - options.fresh：キャッシュを通さず最新を取る（司会・映写の画面用。参加者は使わない）
// - 抽選中（rolling）のときは、番号が出る時刻に合わせてすぐ取りに行く
export function useGameState(id, intervalMs = 2000, { fresh = false } = {}) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const latest = useRef(0);
  const refreshRef = useRef(() => {});

  const accept = useCallback((next) => {
    if (!next || next.v < latest.current) return;
    latest.current = next.v;
    setState(next);
    setError(null);
  }, []);

  useEffect(() => {
    let timer;
    let stopped = false;
    let failures = 0;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          accept(await api.getState(id, fresh));
          failures = 0;
        } catch (e) {
          failures++;
          if (e.status === 404) {
            setError("大会が見つかりません。URLを確かめてください");
            return;
          }
          if (failures >= 2) setError("通信が不安定です。自動で再接続しています…");
        }
      }
      // 失敗が続いても待ち時間は最大10秒まで（電波が戻ったらすぐ追いつけるように）
      const wait = Math.min(intervalMs * (1 + failures), Math.max(intervalMs, 10_000)) + Math.random() * 500;
      timer = setTimeout(tick, wait);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };

    // 電波が戻ったとき・「更新」ボタンを押したときは、待たずにすぐ取りに行く
    const now = () => {
      clearTimeout(timer);
      tick();
    };
    refreshRef.current = now;

    tick();
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("online", now);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("online", now);
    };
  }, [id, intervalMs, fresh, accept]);

  // 抽選中なら、ドラムロールが終わる時刻に合わせて次を取りに行く（番号が出るのを待たせない）
  useEffect(() => {
    if (!state?.rolling) return;
    const t = setTimeout(() => refreshRef.current(), (state.rollMs || 0) + 150);
    return () => clearTimeout(t);
  }, [state]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { state, error, accept, refresh };
}
