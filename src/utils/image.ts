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

   한때는 한 장을 골라도 두 장을 만들었다 — 카카오 공유 카드판에 로고와 "너 나와! 호출"이
   구워져 있어서, 그걸 편지지 배경으로 깔면 글자가 편지 안에 비쳤기 때문이다. 이제 공유
   카드에도 그 판을 안 얹는다(요청: "편지지 배경 올린 경우 로고랑 너 나와! 호출 텍스트
   제거. 이러면 사진도 1개면 되잖아") — 사진을 올린 사람은 그 사진 자체를 보여 주고 싶은
   것이고, 로고·문구는 카카오가 이미 제목·설명으로 적어 준다.

   그래서 만드는 것도 올리는 것도 한 장이다. */

/** 올릴 사진의 긴 변 — 편지지는 모바일에서 화면을 꽉 채우고 카카오 공유 카드도 이 한 장을
 *  쓰므로 둘 다 넉넉하다. 카메라 원본(수천 px)을 그대로 올리는 것보다 열 배 가볍다. */
export const BACKDROP_MAX_SIDE = 1440;
export const BACKDROP_QUALITY = 0.82;

export interface ChallengeBackdrop {
  /** 편지지에 깔 사진(JPEG data URL). */
  backdrop: string;
  /** 카카오 공유 카드에 쓸 사진 — 이제 위와 같은 한 장이다(요청). */
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

/** 고른 사진 하나를 편지지·공유 카드가 함께 쓸 한 장으로 줄인다. 원래 비율 그대로이고,
 *  잘라내지 않는다 — 편지지는 남는 자리를 흐린 같은 사진으로 메우고(CSS), 카카오는 제
 *  카드 비율에 맞춰 알아서 앉힌다. */
export async function buildChallengeBackdrop(file: File): Promise<ChallengeBackdrop> {
  const img = await loadImage(await readAsDataUrl(file));
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) throw new Error("이미지를 불러오지 못했어요.");
  const box = fitBox(iw, ih, BACKDROP_MAX_SIDE);
  const backdrop = paint(box.w, box.h, (ctx) => { ctx.drawImage(img, 0, 0, box.w, box.h); });
  return { backdrop, share: backdrop };
}
