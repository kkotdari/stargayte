// 업로드한 원본 사진(수천 px대 카메라 해상도)을 그대로 저장하면, 화면에는 항상 아주 작게
// (최대 64px) 표시되므로 브라우저가 CSS로 큰 비율을 한 번에 축소해야 한다. 이 단일 축소가
// 브라우저/기기에 따라 부드럽게(뭉개지게) 처리돼 "원본은 선명한데 화면에서는 흐리게" 보이는
// 원인이 된다. 업로드 시점에 canvas로 화면에서 쓰는 크기보다 넉넉한 해상도까지만 고품질로
// 한 번 축소해 두면, 이후 브라우저가 축소할 비율이 훨씬 작아져 실제 표시 결과가 더 선명해진다.
export const MAX_SIDE = 480;
export const JPEG_QUALITY = 0.92;

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했어요."));
    img.src = src;
  });
}

// (한때 여기 있던 resizeLoadedImage/resizeIconSlotImage는 "이미지 설정" 기능 제거와 함께
// 사라졌다 — 아바타 크롭(AvatarCropModal)은 canvas에 직접 그려 자체 축소한다.)

/* ── 너 나와! 편지지 배경 사진 ────────────────────────────────────────────────────
   요청: "너 나와 신청시 편지지 배경 추가 기능(용량 줄여서 업로드) / 이미지는 편지지
   배경과 공유시 썸네일 배경으로 쓰임."

   한 장을 골라도 앉힐 판이 둘이다. 편지지는 세로로 긴 카드이고 카카오 공유 카드의 그림
   자리는 2:1로 못 박혀 있어서(kakaoShare.ts 참고), 원본 하나만 올려 두면 공유 카드에서
   위아래가 잘린다 — 로고 워드마크가 좌우로 잘렸던 것과 같은 문제다. 그래서 여기서 두
   장을 한꺼번에 만들어 올린다. */

/** 편지지에 깔 사진의 긴 변 — 편지지는 모바일에서 화면을 꽉 채우므로 이 정도면 레티나에서도
 *  충분하고, 카메라 원본(수천 px)을 그대로 올리는 것보다 열 배 가볍다. */
export const BACKDROP_MAX_SIDE = 1440;
export const BACKDROP_QUALITY = 0.82;

/** 공유 카드판의 긴 변 — 카카오 대화창에 뜨는 크기라 이 정도면 넉넉하다. 비율은 사진이
 *  정한다(요청: "카톡 미리보기에선 원래 그림 비율로") — 예전엔 2:1(1200×600)로 잘랐는데,
 *  그러면 세로로 긴 사진이 위아래가 잘린 채 나갔다. */
const SHARE_MAX_SIDE = 1200;
/** 사진 위에 덧대는 흰 물의 진하기. 공유 카드 판(share_thumb_*.png)은 흰 바탕에 검은
 *  워드마크·문구라, 그걸 곱하기(multiply)로 얹으면 흰 바탕은 사진을 그대로 통과시키고
 *  검은 글자만 남는다 — 디자인을 다시 그리지 않고 배경만 사진으로 갈아 끼우는 방법이다.
 *  대신 사진이 어두우면 검은 글자가 묻히므로, 곱하기 전에 이만큼 희게 눌러 둔다. */
const SHARE_WASH = 0.45;
/** 그 판의 바탕색(실측 #f2f4f7). 판을 사진 비율에 맞춰 넓힐 때 남는 위아래를 이 색으로
 *  메운 뒤 통째로 곱한다 — 곱하기에서 이 색은 사진을 거의 그대로 통과시키므로, 판이
 *  닿는 자리와 안 닿는 자리 사이에 이음매가 생기지 않는다. */
const SHARE_PLATE_BG = "#f2f4f7";

export interface ChallengeBackdrop {
  /** 편지지에 깔 사진(JPEG data URL). */
  backdrop: string;
  /** 같은 사진을 공유 카드 자리에 앉히고 로고·문구를 얹은 완성본(JPEG data URL). */
  share: string;
}

function paint(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리하지 못했어요.");
  draw(ctx);
  return canvas.toDataURL("image/jpeg", BACKDROP_QUALITY);
}

/** 긴 변을 max 이하로 맞춘 크기(비율 그대로, 원본보다 키우지는 않는다). */
function fitBox(iw: number, ih: number, max: number) {
  const s = Math.min(1, max / Math.max(iw, ih));
  return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
}

/** 고른 사진 한 장으로 편지지용·공유 카드용 두 장을 만든다. 둘 다 사진의 원래 비율이고,
 *  자르는 것은 편지지 쪽 CSS(background-size:cover)가 화면에서 한다.
 *
 *  같은 비율인데 왜 두 장이냐면, 공유 카드판에는 로고와 "너 나와! 호출"이 구워져 있어서다 —
 *  그걸 편지지 배경으로 깔면 그 글자들이 편지 안에 비친다.
 *
 *  @param overlayUrl 공유 카드에 얹을 판(같은 출처여야 캔버스가 오염되지 않는다). */
export async function buildChallengeBackdrop(file: File, overlayUrl: string): Promise<ChallengeBackdrop> {
  const img = await loadImage(await readAsDataUrl(file));
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) throw new Error("이미지를 불러오지 못했어요.");

  const big = fitBox(iw, ih, BACKDROP_MAX_SIDE);
  const backdrop = paint(big.w, big.h, (ctx) => { ctx.drawImage(img, 0, 0, big.w, big.h); });

  const overlay = await loadImage(overlayUrl);
  const card = fitBox(iw, ih, SHARE_MAX_SIDE);
  // 판(2:1)을 카드 폭에 맞춰 늘리고 세로 가운데에 둔다 — 폭에만 맞추므로 로고가 찌그러지지
  // 않는다. 남는 위아래는 판의 바탕색으로 메워, 곱하기 한 번으로 카드 전체를 덮는다.
  const plateH = Math.round((card.w * overlay.naturalHeight) / overlay.naturalWidth);
  const plate = paint(card.w, card.h, (ctx) => {
    ctx.fillStyle = SHARE_PLATE_BG;
    ctx.fillRect(0, 0, card.w, card.h);
    ctx.drawImage(overlay, 0, Math.round((card.h - plateH) / 2), card.w, plateH);
  });
  const plateImg = await loadImage(plate);

  const share = paint(card.w, card.h, (ctx) => {
    ctx.drawImage(img, 0, 0, card.w, card.h);
    ctx.fillStyle = `rgba(255,255,255,${SHARE_WASH})`;
    ctx.fillRect(0, 0, card.w, card.h);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(plateImg, 0, 0);
  });

  return { backdrop, share };
}

