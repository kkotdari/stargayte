import LoginForm from "../auth/LoginForm";
import { useForceLightTheme } from "../../utils/theme";

// 로그인하지 않은 사람이 카톡 등으로 공유된 "너 나와!" 링크를 열었을 때 보여주는 관문(요청:
// "로그인 안 한 상태면 봉투 이미지만 보여주고 정보는 숨기고 그 위에 로그인 모달을 띄우기").
// 봉투 '그림'만 배경으로 깔고(누가 누구를 호출했는지 등 정보는 일절 노출하지 않음 — 그래서
// 도전장 데이터를 아예 불러오지 않는다) 그 위에 라이팅 글라스 로그인 패널을 얹는다. 로그인에
// 성공하면 store의 user가 채워지고, App이 다시 그려지며 실제 봉투→편지지 흐름(SharePage)으로
// 자연스럽게 넘어간다.
export default function ShareLoginGate() {
  // 카톡 공유 링크 진입이므로 라이트 테마 강제(요청).
  useForceLightTheme();
  // 배경으로 스크롤될 콘텐츠가 없는 전체화면 관문이라 바디 스크롤 잠금(모달 실드)은 쓰지
  // 않는다 — 잠그면 실드가 로그인 폼 입력 자체의 터치까지 막는다(인앱 배너에서 겪은 문제).
  return (
    <div className="scr-share-login-gate">
      {/* 봉투 장면부터 흰 "너 나와~" 벽지가 깔린다(요청) — 편지지 공유 배경과 같은 타일. */}
      <div className="scr-challenge-share-bg" aria-hidden="true" />
      {/* 정보 없는 봉투 그림만 — 궁금증만 남긴다. */}
      <div className="scr-share-login-envelope" aria-hidden="true">
        <img src="/images/items/envelope.png" alt="" className="scr-challenge-envelope-img" />
      </div>
      {/* 로그인 폼은 배경 거의 투명 + 살짝 블러만(요청) — 뒤 봉투/벽지가 비쳐 보인다. */}
      <div className="scr-share-login-panel" role="dialog" aria-label="로그인">
        <div className="scr-share-login-title">호출이 도착했어요</div>
        <div className="scr-share-login-sub">로그인하고 편지를 열어보세요 👀</div>
        <LoginForm />
      </div>
    </div>
  );
}
