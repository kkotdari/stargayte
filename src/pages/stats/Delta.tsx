/* ── 전달 대비 변동 ────────────────────────────────────────────────────────────
   요청: 통계의 모든 수치에 전월 대비 변동을 화살표 말고 +/-로, 연하고 작은 글씨로.

   순위(랭크)만은 예전처럼 ▲▼를 그대로 쓴다 — 순위는 '작을수록 좋다'라 +3이 오른 것인지
   내린 것인지가 읽는 사람마다 갈리지만, 나머지 수치는 큰 쪽이 큰 값이라 부호가 곧 방향이다.

   견줄 값이 없으면(전체 기간을 보는 중이거나, 지난달에 한 판도 안 뛰었거나) 아무것도 안
   적는다. 0도 안 적는다 — 줄마다 "+0"이 늘어서면 정작 움직인 값이 묻힌다. */
export default function Delta({ now, prev, digits = 0, unit = "" }: {
  now: number | null | undefined;
  prev: number | null | undefined;
  /** 소수 몇 자리까지 — 승률·업그레이드처럼 정수로 반올림하면 뜻이 사라지는 값에 쓴다. */
  digits?: number;
  unit?: string;
}) {
  const d = typeof now === "number" && typeof prev === "number" ? now - prev : null;
  // 표시할 자릿수에서 0이면 안 움직인 것으로 본다 — 반올림해 0이 되는 값에 "+0"을
  // 다는 것은 거짓말에 가깝다.
  const text = d === null ? null : d.toFixed(digits);
  /* 움직이지 않았거나 견줄 값이 없으면 "-"다(요청: 아예 비우지 말고 - 표시) — 자리를
     늘 채워야 값이 있는 줄과 없는 줄의 높이가 같고, 빈칸이 '아직 안 그려진 것'으로
     읽히지도 않는다. 다만 읽을 값이 아니므로 더 눌러 둔다. */
  if (text === null || Number(text) === 0) {
    return <span className="scr-stat-delta scr-stat-delta-none">-</span>;
  }
  return (
    <span className="scr-stat-delta">{d! > 0 ? `+${text}` : text}{unit}</span>
  );
}
