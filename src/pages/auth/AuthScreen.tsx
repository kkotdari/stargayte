import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import BrandLogo from "../../components/common/BrandLogo";
import { useLightTheme } from "../../utils/theme";

export default function AuthScreen() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  // 로그인 여부와 무관한 화면 취향이라 로그인 화면에도 자체 토글 버튼을 둔다 — 로그인 후
  // 헤더의 토글과 같은 저장소를 공유한다(utils/theme.ts). 로그아웃하면 appStore가 항상
  // 기본(다크)으로 되돌리므로, 로그인 화면에 온 채로 다시 켜고 싶으면 여기서 켠다.
  const [lightTheme, setLightTheme] = useLightTheme();

  return (
    <div className="scr-auth-wrap">
      <div className="scr-bg-grid" />
      {/* 테마 전환 — 아이콘 대신 텍스트로(요청). */}
      <button
        type="button"
        className="scr-header-text-btn scr-auth-theme-btn"
        onClick={() => setLightTheme((v) => !v)}
        aria-label="라이트 테마 토글"
      >
        테마
      </button>
      {/* 로고+폼을 한 덩어리로 묶어 화면 정중앙보다 살짝 위로 올린다(요청: "로그인 폼과
          로고를 20프로 정도 위로 올려줘") — .scr-auth-wrap의 justify-content:center는
          그대로 두고, 이 안쪽 그룹에만 translateY를 걸어 옮긴다(테마 토글/배경 그리드는
          이 그룹 밖의 형제라 영향받지 않는다). */}
      <div className="scr-auth-hero">
        <div className="scr-auth-logo">
          {/* 헤더와 같은 정적 로고 + 회전 별(BrandLogo) — 서버 조회 없이 즉시 그려져
              예전의 "텍스트→이미지 깜빡임"도 원천적으로 없다. 크기/글로우는
              .scr-auth-logo 스코프 CSS가 키워준다. */}
          <BrandLogo light={lightTheme} />
        </div>
        {tab === "login" ? (
          // 로그인 카드도 회원가입 카드처럼 테두리 없이 반투명 유리 배경만(요청: "테두리 제거").
          <div className="scr-auth-card scr-auth-card-plain">
            <LoginForm />
          </div>
        ) : (
          <div className="scr-auth-card scr-auth-card-plain">
            <button type="button" className="scr-link-btn scr-auth-back-btn" onClick={() => setTab("login")}>
              <ArrowLeft size={13} /> 뒤로가기
            </button>
            <SignupForm onDone={() => setTab("login")} />
          </div>
        )}
      </div>
      {/* 회원가입 링크 — 아이콘이 아니라 텍스트로, 화면 최하단 가운데에 둔다(요청). 로그인
          탭에서만 보인다(회원가입 탭엔 이미 뒤로가기가 있다). */}
      {tab === "login" && (
        <button type="button" className="scr-link-btn scr-auth-signup-link" onClick={() => setTab("signup")}>
          회원가입
        </button>
      )}
    </div>
  );
}
