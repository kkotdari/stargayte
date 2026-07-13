import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import CornerPanel from "../../components/common/CornerPanel";
import ThemeIcon from "../../components/common/ThemeIcon";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import { api } from "../../api/client";
import { useLightTheme } from "../../utils/theme";
import type { ImageSettingMap } from "../../types";

export default function AuthScreen() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  // 로그인 여부와 무관한 화면 취향이라 로그인 화면에도 자체 토글 버튼을 둔다 — 로그인 후
  // 헤더의 토글과 같은 저장소를 공유한다(utils/theme.ts). 로그아웃하면 appStore가 항상
  // 기본(다크)으로 되돌리므로, 로그인 화면에 온 채로 다시 켜고 싶으면 여기서 켠다.
  const [lightTheme, setLightTheme] = useLightTheme();
  // 헤더의 브랜드 로고를 로그인 화면에도 그대로 보여준다 — 이 화면은 로그인 전이라 전체
  // 부트스트랩(App.tsx)을 못 타므로 로고 맵만 따로 조회한다. 라이트 테마면 어두운 배경을
  // 전제로 만들었을 기본 로고 대신 별도 등록된 라이트 테마 전용 로고를 쓴다.
  const [icons, setIcons] = useState<ImageSettingMap | null>(null);
  useEffect(() => {
    api.getImageSettings().then(setIcons).catch(() => {});
  }, []);
  const homeLogo = icons ? (lightTheme ? icons.home_logo_light : icons.home_logo) : null;

  return (
    <div className="scr-auth-wrap">
      <div className="scr-bg-grid" />
      <button
        type="button"
        className="scr-icon-btn scr-auth-theme-btn"
        onClick={() => setLightTheme((v) => !v)}
        aria-label="라이트 테마 토글"
        title="라이트 테마(흰 배경 + 검은 글씨)"
      >
        <ThemeIcon size={30} />
      </button>
      <div className="scr-auth-logo">
        {/* 조회가 끝나기 전엔 아무것도 안 보여준다 — homeLogo가 null인 동안 텍스트 대체값을
            먼저 그리면, 실제 로고 이미지가 도착하는 순간 "텍스트 -> 이미지"로 바뀌는 게
            눈에 띄게 깜빡여 보였다. */}
        {homeLogo && (
          homeLogo.type === "image" && homeLogo.value ? (
            <img src={homeLogo.value} alt="스타게이트" className="scr-auth-logo-img scr-logo-fadein" />
          ) : (
            <span className="scr-auth-logo-text scr-logo-fadein">{homeLogo.value || "스타게이트"}</span>
          )
        )}
      </div>
      {tab === "login" ? (
        <CornerPanel className="scr-auth-card">
          <LoginForm onSignup={() => setTab("signup")} />
        </CornerPanel>
      ) : (
        <div className="scr-auth-card scr-auth-card-plain">
          <button type="button" className="scr-link-btn scr-auth-back-btn" onClick={() => setTab("login")}>
            <ArrowLeft size={13} /> 뒤로가기
          </button>
          <SignupForm onDone={() => setTab("login")} />
        </div>
      )}
    </div>
  );
}
