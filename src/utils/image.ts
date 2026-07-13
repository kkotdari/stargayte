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

// 로드된 이미지를 긴 변 기준 maxSide 이하로 고품질 축소한 data URL로 변환한다. 원본이 이미
// maxSide보다 작으면 확대하지 않고 원본 data URL을 그대로 둔다.
function resizeLoadedImage(
  img: HTMLImageElement, dataUrl: string, maxSide: number, quality: number, mimeType: string,
): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return dataUrl; // 이미 충분히 작으면 원본 그대로 (불필요한 재인코딩 방지)

  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl; // canvas를 못 쓰는 환경이면 원본 그대로 (기능 저하 없이 안전하게 폴백)

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

// 종족 아이콘/홈 로고 등 "이미지 설정" 화면의 슬롯 업로드 시 호출: 아바타보다 훨씬
// 작게(뱃지 크기) 쓰이는 이미지라 최대 변을 더 작게 잡고, 투명 배경을 지원하는
// 아이콘/이모지 이미지가 많아 알파 채널이 사라지는 JPEG 대신 PNG로 인코딩한다.
export async function resizeIconSlotImage(file: File, maxSide = 128): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  return resizeLoadedImage(img, dataUrl, maxSide, 1, "image/png");
}

// 도전장 첨부 사진 — 실제 표시 크기(카드 축소판/원본 보기)는 그대로 두되(요청: "크기는
// 그대로 유지"), 카메라 원본(수천 px대)은 화면에 필요한 것보다 훨씬 커서 용량만 크다.
// 화면에서 크게 봐도 충분한 해상도(긴 변 1600px)로만 낮추고 항상 JPEG로 재인코딩해
// 용량을 줄인다(요청: "품질저하 없이 용량 줄이는 리사이즈") — resizeIconSlotImage/
// resizeLoadedImage와 달리 이미 maxSide보다 작아도 재인코딩한다. 그래야 이미 작지만
// 무겁게 저장된 원본(예: 무손실 PNG 스크린샷)의 용량도 함께 줄어든다.
export const CHALLENGE_PHOTO_MAX_SIDE = 1600;
export const CHALLENGE_PHOTO_JPEG_QUALITY = 0.85;

export async function resizeChallengePhoto(
  file: File, maxSide = CHALLENGE_PHOTO_MAX_SIDE, quality = CHALLENGE_PHOTO_JPEG_QUALITY,
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl; // canvas를 못 쓰는 환경이면 원본 그대로 (기능 저하 없이 안전하게 폴백)

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}
