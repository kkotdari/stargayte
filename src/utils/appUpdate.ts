// 배포 직후 이미 열려 있던 탭에서 코드 스플리팅된 청크(예: 리플레이 분석기 screp-js)를 동적
// import하면 실패한다(vite:preloadError, main.tsx 참고) — 그 사실을 다른 기능(리플레이 일괄
// 분석 등)이 "이번 시도가 배포 갱신 때문에 실패했는지" 판단하는 데 쓸 수 있게 기록해둔다.
let occurred = false;

export function markAppUpdatePreloadError(): void {
  occurred = true;
}

export function hasAppUpdatePreloadErrorOccurred(): boolean {
  return occurred;
}
