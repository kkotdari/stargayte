// 정적 로고 — 별이 빠진 워드마크(다크=white.png/라이트=black.png) 위에 별 심볼
// (symbol.png)을 원래 별 자리(A 위치)에 겹쳐 올리고, 별만 4초 주기(3초 정지 + 1초 회전)로
// Y축 중심 물레 회전시킨다(요청: "별이 뱅글뱅글 도는 로고"). GIF 대신 CSS 3D 회전이라
// 가장자리가 매끈하고 레티나에서도 선명하며 타이밍을 코드에서 조절할 수 있다.
// 좌표는 이미지 픽셀 실측값(주석: global.css .scr-brand-logo-star 참고)으로 잡았다.
export default function BrandLogo({ light }: { light: boolean }) {
  return (
    <span className="scr-brand-logo-wrap scr-logo-fadein">
      <img
        src={light ? "/images/logo/black.png" : "/images/logo/white.png"}
        alt="스타게이트"
        className="scr-brand-logo-img"
      />
      <img src="/images/logo/symbol.png" alt="" aria-hidden className="scr-brand-logo-star" />
    </span>
  );
}
