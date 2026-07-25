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

