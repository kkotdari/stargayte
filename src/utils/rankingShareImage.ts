// 랭킹 카카오톡 공유용 미리보기 이미지 — 그 순간의 필터/순위를 캔버스로 그려 카드
// 썸네일로 쓴다(요청: "카톡 미리보기에서 차트가 보이면 좋겠어"). 서버 렌더링 없이
// 클라이언트에서 즉석으로 그린 뒤 dataUrl로 반환하면, 호출부가 api.uploadShareImage로
// 올려 공개 URL을 받는다.

export interface RankingShareRow {
  rank: number;
  nickname: string;
  score: number;
}

// 카톡 미리보기는 놓이는 자리(피드 카드/채팅 썸네일 등)마다 비율이 달라 상하나 좌우가
// 잘릴 수 있다 — 정사각형으로 만들고 사방에 넉넉히 패딩을 둬서, 어떤 비율로 크롭돼도
// 핵심 내용(타이틀/순위)은 항상 안전영역 안에 남게 한다(요청: "이미지는 정사각형으로
// 만들되 사방에 패딩을 좀 많이 둬야할듯").
const SIZE = 1080;
const PAD = 96;
// 상위 1~3위는 랭킹 카드(scr-rank-name-gold/silver/bronze)와 같은 금/은/동 톤.
const MEDAL_COLORS: Record<number, string> = { 1: "#ffd24d", 2: "#c3c9d1", 3: "#b98a5a" };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 캔버스에 쓰는 폰트 굵기/크기 조합을 전부 미리 로드해둔다 — Pretendard(웹폰트)가 아직
// 로드되기 전에 fillText를 부르면, DOM 텍스트처럼 나중에 다시 그려주지 않고 그 자리에서
// "글자 없음"으로 한 번에 그려져 버리는 브라우저가 있다(실제로 지적받은 문제 — "미리보기에
// 바만 있고 아무런 정보가 없어서 무의미해"). document.fonts.load로 각 조합을 명시적으로
// 미리 불러온 뒤에만 그린다.
const FONT_SPECS = [
  "700 30px Pretendard", "500 24px Pretendard", "800 34px Pretendard",
  "600 22px Pretendard", "500 26px Pretendard", "500 20px Pretendard",
];
async function ensureFontsReady(): Promise<void> {
  try {
    await Promise.all(FONT_SPECS.map((spec) => document.fonts.load(spec)));
    await document.fonts.ready;
  } catch {
    // 폰트 API를 못 쓰는 환경이면 그냥 fallback(sans-serif)으로 그린다.
  }
}

export async function renderRankingShareImage(
  title: string, label: string, rows: RankingShareRow[],
): Promise<string> {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context를 만들 수 없어요.");

  // 배경 — 앱 다크 테마와 같은 톤의 은은한 세로 그라데이션. 크롭에 대비해 배경만은
  // 캔버스 전체(패딩 포함 바깥까지)를 채운다 — 잘려도 빈 여백이 드러나지 않게.
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, "#181d24");
  bg.addColorStop(1, "#0e1116");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 이 안전영역(PAD만큼 안쪽) 밖으로는 텍스트/막대 등 핵심 내용을 그리지 않는다.
  const left = PAD;
  const right = SIZE - PAD;
  const contentW = right - left;

  // 상단 타이틀 — 브랜드 + 필터 라벨.
  ctx.fillStyle = "#e8935a";
  ctx.font = "700 34px Pretendard, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, left, PAD + 34);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "500 26px Pretendard, sans-serif";
  ctx.fillText(label, left, PAD + 76);

  // 순위 목록 — 최대 5명, 점수 상대 비율로 막대를 그린다(요청: "차트가 보이면").
  const top = rows.slice(0, 5);
  const maxScore = Math.max(1, ...top.map((r) => Math.abs(r.score)));
  const listTop = PAD + 130;
  const rowH = 118;
  const barX = left + 240;
  const barMaxW = right - barX;

  top.forEach((r, i) => {
    const y = listTop + i * rowH;
    const medal = MEDAL_COLORS[r.rank];

    // 행 배경 카드.
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)";
    roundRect(ctx, left, y, contentW, rowH - 16, 14);
    ctx.fill();

    // 순위 숫자.
    ctx.fillStyle = medal ?? "rgba(255,255,255,0.85)";
    ctx.font = "800 38px Pretendard, sans-serif";
    ctx.fillText(String(r.rank), left + 24, y + 62);

    // 닉네임.
    ctx.fillStyle = medal ?? "#f2f2f2";
    ctx.font = "700 32px Pretendard, sans-serif";
    ctx.fillText(r.nickname.length > 8 ? `${r.nickname.slice(0, 8)}…` : r.nickname, left + 100, y + 42);

    // 점수 막대 + 숫자(닉네임 아래 한 줄로, 좁은 정사각형 폭에서도 안 겹치게).
    const w = Math.max(6, (Math.abs(r.score) / maxScore) * (barMaxW - 130));
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, left + 100, y + 60, barMaxW - 130, 14, 7);
    ctx.fill();
    ctx.fillStyle = medal ?? "#e8935a";
    roundRect(ctx, left + 100, y + 60, w, 14, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 24px Pretendard, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${r.score}점`, right, y + 46);
    ctx.textAlign = "left";
  });

  if (top.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "500 28px Pretendard, sans-serif";
    ctx.fillText("아직 기록이 없어요", left, listTop + 40);
  }

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "500 22px Pretendard, sans-serif";
  ctx.fillText("stargayte", left, SIZE - PAD);

  return canvas.toDataURL("image/png");
}
