import { useState, useEffect, useRef } from "react";
import { useAppStore } from "./store/appStore";
import { isAdminRole } from "./constants/roles";
import { ImageSettingContext } from "./context/ImageSettingContext";
import { Spinner } from "./components/common/Feedback";
import ScrollTopButton from "./components/common/ScrollTopButton";
import { api } from "./api/client";
import { versionNumber } from "./utils/appVersion";
import { useRestoreScrollOnKeyboardClose } from "./hooks/useRestoreScrollOnKeyboardClose";
import { getScrollTop, scrollRootTo } from "./utils/scrollRoot";
import { CHALLENGE_MIN_VERSION, homeScreenFor } from "./constants/menuVersions";

import AuthScreen from "./pages/auth/AuthScreen";
import Header from "./layout/Header";
import ChallengeScreen from "./pages/challenge/ChallengeScreen";
import MembersScreen from "./pages/members/MembersScreen";
import ImageSettingsScreen from "./pages/imageSettings/ImageSettingsScreen";
import GameIdScreen from "./pages/gameId/GameIdScreen";
import ProfileModal from "./modals/ProfileModal";
import MemberProfileModal from "./modals/MemberProfileModal";
import AdminPanelModal from "./modals/AdminPanelModal";
import ChallengeInboxModal from "./modals/ChallengeInboxModal";
import AppUpdateNoticeModal from "./modals/AppUpdateNoticeModal";
import RankingScreen from "./pages/v2/RankingScreen";
import MatchScreen from "./pages/v2/MatchScreen";
import StatsScreen from "./pages/v2/StatsScreen";

import type { ScreenKey } from "./types";

const SCREEN_KEYS: ScreenKey[] = ["ranking", "match", "challenge", "stats", "members", "imageSettings", "gameId"];

// 새로고침해도 보던 화면 그대로 있도록 URL의 ?screen= 쿼리에 현재 화면을 기록해둔다 —
// 사파리의 pull-to-refresh 등 브라우저 기본 새로고침은 앱 상태를 그대로 날려서 첫 화면으로
// 돌아가 버리는데, URL만은 새로고침 후에도 그대로 유지되기 때문에 여기 저장해두는 것.
function screenFromUrl(): ScreenKey {
  const s = new URLSearchParams(window.location.search).get("screen");
  return (SCREEN_KEYS as string[]).includes(s ?? "") ? (s as ScreenKey) : "ranking";
}

export default function App() {
  const user = useAppStore((s) => s.user);
  const booting = useAppStore((s) => s.booting);
  const restoringSession = useAppStore((s) => s.restoringSession);
  const justLoggedIn = useAppStore((s) => s.justLoggedIn);
  const clearJustLoggedIn = useAppStore((s) => s.clearJustLoggedIn);
  const imageSettings = useAppStore((s) => s.imageSettings);
  const appVersion = useAppStore((s) => s.appVersion);
  const previewVersion = useAppStore((s) => s.previewVersion);
  const setPreviewVersion = useAppStore((s) => s.setPreviewVersion);
  const adminPanelOpen = useAppStore((s) => s.adminPanelOpen);
  const setAdminPanelOpen = useAppStore((s) => s.setAdminPanelOpen);
  const effectiveVersionNumber = previewVersion ?? versionNumber(appVersion);
  const isChallengeEnabled = effectiveVersionNumber >= CHALLENGE_MIN_VERSION;
  const bootstrap = useAppStore((s) => s.bootstrap);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const logout = useAppStore((s) => s.logout);
  const restoreSession = useAppStore((s) => s.restoreSession);
  const viewingMemberId = useAppStore((s) => s.viewingMemberId);
  const closeMemberProfile = useAppStore((s) => s.closeMemberProfile);
  const memberOf = useAppStore((s) => s.memberOf);
  const viewingMember = viewingMemberId ? memberOf(viewingMemberId) : undefined;
  const inboxChallenges = useAppStore((s) => s.inboxChallenges);
  const dismissInboxChallenges = useAppStore((s) => s.dismissInboxChallenges);
  const updateNotice = useAppStore((s) => s.updateNotice);
  const dismissUpdateNotice = useAppStore((s) => s.dismissUpdateNotice);

  const [screen, setScreen] = useState<ScreenKey>(screenFromUrl);
  const [profileOpen, setProfileOpen] = useState(false);
  // 로그인 직후 최초 진입 화면에서는 bootstrap()이 이미 방금 다 불러온 상태라, 그 화면으로
  // "이동"한 게 아닌데도 아래 새로고침 effect가 곧바로 또 중복 조회하지 않도록 건너뛴다.
  const skipNextRefresh = useRef(true);
  // 화면(탭)별 마지막 스크롤 위치 — 메뉴를 오갈 때 이전 화면 위치를 기억해뒀다가 그 화면으로
  // 돌아오면 복원한다. navigate()에서 "떠나는" 화면 기준으로 저장한다.
  const scrollPositionsRef = useRef<Partial<Record<ScreenKey, number>>>({});
  const navigate = (next: ScreenKey) => {
    scrollPositionsRef.current[screen] = getScrollTop();
    setScreen(next);
  };
  // 키보드가 뜨면(resizes-content라 뷰포트가 줄어들며) 브라우저가 포커스된 입력칸을
  // 보여주려고 스크롤을 올리는데, 키보드가 닫혀도 그 자리로 되돌아오지 않았다(실제로
  // 지적받은 문제 — "키보드 내려가면 다시 안 돌아와").
  useRestoreScrollOnKeyboardClose();

  // 새로고침 시 저장된 토큰으로 로그인 세션 복원 시도
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // 로그인되면 기초 데이터 로드
  useEffect(() => {
    if (user) void bootstrap();
  }, [user?.id, bootstrap]);

  // 로그인 폼으로 직접 로그인했으면(새로고침으로 세션이 복원된 게 아니라) 이전에 URL에
  // 남아있던 화면과 무관하게 항상 홈 화면으로 보낸다 — 어떤 화면이 홈인지는 버전별 메뉴
  // 배열(menuVersions.ts) 순서로 정해진다. booting이 끝날 때까지 기다린다 — 그 전엔
  // appVersion이 아직 기본값(버전 1)이라 실제 버전을 알기 전에 잘못된 홈으로 보낼 수 있다.
  useEffect(() => {
    if (!justLoggedIn || booting) return;
    setScreen(homeScreenFor(effectiveVersionNumber));
    clearJustLoggedIn();
  }, [justLoggedIn, booting, effectiveVersionNumber, clearJustLoggedIn]);

  // 화면(탭)을 이동할 때마다 목록을 최신 상태로 다시 불러온다 — 다른 사람이 그 사이
  // 등록/수정한 경기결과·회원 정보를 수동으로 새로고침 버튼을 눌러야만 보는 게 아니라
  // 탭을 옮기는 것만으로 항상 최신으로 보이게 한다.
  useEffect(() => {
    if (skipNextRefresh.current) { skipNextRefresh.current = false; return; }
    if (!user) return;
    void refreshAll();
  }, [screen, user?.id, refreshAll]);

  // 화면이 바뀌면 그 화면에서 마지막으로 있던 스크롤 위치로 복원한다(처음 방문이면 맨 위).
  useEffect(() => {
    const y = scrollPositionsRef.current[screen] ?? 0;
    scrollRootTo({ top: y, left: 0, behavior: "instant" });
  }, [screen]);

  // 화면이 바뀔 때마다 접속 기록에 "언제 어떤 화면을 봤는지" 남긴다(로그인 전이면 의미가
  // 없으니 건너뛴다). 실패해도 화면 전환 자체를 막을 이유는 없어 결과를 기다리지 않는다.
  useEffect(() => {
    if (!user) return;
    void api.pingAccess(screen);
  }, [user, screen]);

  // 현재 화면을 URL에 반영 — 새로고침해도 같은 화면으로 돌아오도록.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("screen") === screen) return;
    params.set("screen", screen);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [screen]);

  if (restoringSession) {
    return (
      <ImageSettingContext.Provider value={imageSettings}>
        <div className="scr-app scr-app-fallback-scroll" id="scr-app"><div className="scr-boot"><Spinner size={22} /> 세션 확인 중...</div></div>
      </ImageSettingContext.Provider>
    );
  }

  if (!user) {
    return (
      <ImageSettingContext.Provider value={imageSettings}>
        <div className="scr-app scr-app-fallback-scroll" id="scr-app"><AuthScreen /></div>
      </ImageSettingContext.Provider>
    );
  }

  const isAdmin = isAdminRole(user.roles);
  // 접근 권한이 없는 화면으로 들어온 경우(예: URL 직접 조작) 실제로 보여줄 화면 —
  // 기존에 각 화면 분기에서 개별적으로 <RankingScreen />으로 대체하던 것과 동일한 동작이다.
  const resolvedScreen: ScreenKey =
    screen === "challenge" && !isChallengeEnabled ? "ranking" :
    screen === "members" && !isAdmin ? "ranking" :
    screen === "imageSettings" && !isAdmin ? "ranking" :
    screen;

  return (
    <ImageSettingContext.Provider value={imageSettings}>
      <div className="scr-app" id="scr-app">
        <div className="scr-bg-grid" />
        <span className="scr-rail scr-rail-left" aria-hidden="true" />
        <span className="scr-rail scr-rail-right" aria-hidden="true" />

        <Header
          user={user}
          screen={screen}
          onNavigate={navigate}
          onOpenProfile={() => setProfileOpen(true)}
          onLogout={logout}
        />

        {/* 앱 셀의 유일한 스크롤 영역 — html/body/#root는 overflow:hidden으로 고정되고
            (global.css), 실제 스크롤은 이 컨테이너 하나에서만 일어난다. utils/scrollRoot.ts의
            getScrollRoot()가 이 id를 찾아 window 대신 이 엘리먼트를 스크롤 신호의 기준으로 쓴다. */}
        <div id="scroll-root">
          <main className="scr-main">
            {booting && (
              <div className="scr-boot"><Spinner size={22} /> 데이터 불러오는 중...</div>
            )}
            {/* 탭을 옮겨도 필터/입력/스크롤 등 화면별 상태가 남아있도록, 화면을 언마운트하는
                대신 전부 마운트해두고 안 보이는 화면만 display:none으로 숨긴다. 접근 권한이
                없는 화면(challenge/members/imageSettings)은 랭킹으로 대체되던 기존 동작과
                같게, resolvedScreen으로 보여줄 슬롯만 바꾼다. */}
            <div style={{ display: !booting && resolvedScreen === "ranking" ? undefined : "none" }}>
              <RankingScreen />
            </div>
            <div style={{ display: !booting && resolvedScreen === "match" ? undefined : "none" }}>
              <MatchScreen />
            </div>
            {isChallengeEnabled && (
              <div style={{ display: !booting && resolvedScreen === "challenge" ? undefined : "none" }}>
                <ChallengeScreen />
              </div>
            )}
            <div style={{ display: !booting && resolvedScreen === "stats" ? undefined : "none" }}>
              <StatsScreen />
            </div>
            {isAdmin && (
              <div style={{ display: !booting && resolvedScreen === "members" ? undefined : "none" }}>
                <MembersScreen />
              </div>
            )}
            {isAdmin && (
              <div style={{ display: !booting && resolvedScreen === "imageSettings" ? undefined : "none" }}>
                <ImageSettingsScreen />
              </div>
            )}
            {/* 조회는 회원 누구나 가능 — 수정/삭제만 화면 내부에서 운영자로 한정한다. */}
            <div style={{ display: !booting && resolvedScreen === "gameId" ? undefined : "none" }}>
              <GameIdScreen />
            </div>
          </main>
        </div>

        {/* MobileTabBar(Header.tsx 안에서 렌더)가 이 자리로 포털링된다 — #scr-app을 포털
            대상으로 직접 쓰면 React가 포털을 항상 "마지막 자식"으로 붙여준다고 가정하기
            쉬운데, 실제로는 파이버 트리 형태에 따라 삽입 위치가 달라질 수 있어서(실제로
            겪은 버그 — Context.Provider 하나를 걷어냈을 뿐인데 탭바가 헤더보다 앞으로
            와버렸다) #scroll-root 바로 다음이라는 확실한 자리를 이 빈 div로 직접
            고정해준다. */}
        <div id="scr-tabbar-slot" />

        {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
        {viewingMember && <MemberProfileModal member={viewingMember} onClose={closeMemberProfile} />}
        {adminPanelOpen && <AdminPanelModal isAdmin={isAdmin} onClose={() => setAdminPanelOpen(false)} />}
        {updateNotice && <AppUpdateNoticeModal onClose={dismissUpdateNotice} />}
        {inboxChallenges.length > 0 && (
          <ChallengeInboxModal challenges={inboxChallenges} onClose={dismissInboxChallenges} />
        )}

        {!booting && <ScrollTopButton />}

        {previewVersion !== null && previewVersion !== versionNumber(appVersion) && (
          <div className="scr-preview-badge">
            <span>버전 {previewVersion} 미리보기 중</span>
            <button type="button" onClick={() => setPreviewVersion(null)}>나가기</button>
          </div>
        )}
      </div>
    </ImageSettingContext.Provider>
  );
}
