/* ── 전달 대비 변동 ────────────────────────────────────────────────────────────
   요청: 통계의 모든 수치에 전월 대비 변동을 화살표 말고 +/-로, 연하고 작은 글씨로.

   순위(랭크)만은 예전처럼 ▲▼를 그대로 쓴다 — 순위는 '작을수록 좋다'라 +3이 오른 것인지
   내린 것인지가 읽는 사람마다 갈리지만, 나머지 수치는 큰 쪽이 큰 값이라 부호가 곧 방향이다.

   prev의 두 빈 값은 서로 다른 뜻이다 — 이 구분이 이 부품의 핵심이다.
     null      "견줄 달은 있는데 그 사람 값이 없다"(지난달에 한 판도 안 뛰었다) → "-"
     undefined "견줄 달이라는 것 자체가 없다"(전체 누적을 보는 화면) → 아무것도 안 그린다
   내전 표가 기간 필터를 잃고 전체 누적 하나가 되면서(요청) 두 번째 경우가 화면 전체가
   됐다. 그때도 "-"를 그리면 수마다 그 아래에 뜻 없는 줄이 하나씩 깔려, 읽을 것이 없는
   자리가 표에서 제일 넓어진다. 자리를 지켜야 하는 쪽은 첫 번째 경우다: 같은 표 안에서
   어떤 줄만 값이 있고 어떤 줄은 비면 줄 높이가 어긋난다.
   0도 안 적는다 — 줄마다 "+0"이 늘어서면 정작 움직인 값이 묻힌다. */
export default function Delta({ now, prev, digits = 0, unit = "" }: {
  now: number | null | undefined;
  prev: number | null | undefined;
  /** 소수 몇 자리까지 — 승률·업그레이드처럼 정수로 반올림하면 뜻이 사라지는 값에 쓴다. */
  digits?: number;
  unit?: string;
}) {
  // 견줄 기준선 자체가 없는 화면에서는 자리째 없다(위 주석) — 껍데기가 빈 채로 남지 않게
  // 바깥 span들도 :empty에서 사라진다(global.css의 .scr-bar-delta:empty 등).
  if (prev === undefined) return null;
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
