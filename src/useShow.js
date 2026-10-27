import { useEffect, useRef, useState } from "react";
import { MAX_NUMBER, MAX_WINNERS } from "../server/bingo.js";
import * as sound from "./sound.js";

// 抽選の演出と効果音（映写画面とスマホの司会画面で共通）
// - 抽選中：数字をくるくる変えて、ドラムロールを鳴らす
// - 番号が出たら：ドラムロールを止めて、締めの音。札をめくる合図（flipKey）を進める
// - 当選者が増えたら：帯（banner）を出して、1人目／2人目以降／最後の人で違う音
export function useShow(state, { soundOn, pendingRoll = false }) {
  const drawn = state.drawn;
  const last = drawn[drawn.length - 1];
  const rolling = state.rolling || pendingRoll;
  const winnerCount = state.winners.length;
  const [face, setFace] = useState(1);
  const [flipKey, setFlipKey] = useState(0);
  const [banner, setBanner] = useState(null);
  const heard = useRef(null);
  const stopRoll = useRef(() => {});

  useEffect(() => {
    sound.preload(["drumroll", "rollEnd", "firstWinner", "winner", "gong"]);
  }, []);

  useEffect(() => {
    if (!rolling) return;
    const t = setInterval(() => setFace(1 + Math.floor(Math.random() * MAX_NUMBER)), 70);
    if (soundOn) stopRoll.current = sound.play("drumroll");
    return () => clearInterval(t);
  }, [rolling, soundOn]);

  useEffect(() => {
    if (rolling) return;
    const prev = heard.current;
    heard.current = { last, winners: winnerCount };
    stopRoll.current();
    stopRoll.current = () => {};
    if (!prev) return; // 開いた時点の状態では鳴らさない
    if (last !== undefined && last !== prev.last) {
      setFlipKey((k) => k + 1);
      if (soundOn) sound.play("rollEnd", { maxSeconds: 2.5 });
    }
    if (winnerCount > prev.winners) {
      const w = state.winners[winnerCount - 1];
      setBanner({ name: w.name, rank: winnerCount, more: winnerCount - prev.winners - 1 });
      if (soundOn) {
        if (winnerCount >= MAX_WINNERS) sound.play("gong", { wait: true });
        else if (prev.winners === 0) sound.play("firstWinner", { wait: true });
        else sound.play("winner", { wait: true, cooldown: 3 });
      }
    }
  }, [rolling, last, winnerCount, soundOn, state.winners]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  return { rolling, last, face, flipKey, banner };
}
