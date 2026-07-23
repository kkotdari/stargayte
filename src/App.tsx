import { useState, useEffect, useRef } from "react";
import { useAppStore } from "./store/appStore";
import { isAdminRole } from "./constants/roles";
import { ImageSettingContext } from "./context/ImageSettingContext";
import { Spinner } from "./components/common/Feedback";
import ScrollTopButton from "./components/common/ScrollTopButton";
import { api } from "./api/client";
import { versionNumber } from "./utils/appVersion";
import { useRestoreScrollOnKeyboardClose } from "./hooks/useRestoreScrollOnKeyboardClose";
import { useBottomViewportInset } from "./hooks/useBottomViewportInset";
import { scrollRootTo } from "./utils/scrollRoot";
import { resampleSafariChrome } from "./utils/theme";
import { CHALLENGE_MIN_VERSION, homeScreenFor } from "./constants/menuVersions";

import AuthScreen from "./pages/auth/AuthScreen";
import Header from "./layout/Header";
import InstallBanner from "./components/common/InstallBanner";
import InAppBrowserNotice from "./components/common/InAppBrowserNotice";
import ChallengeScreen from "./pages/challenge/ChallengeScreen";
import MembersScreen from "./pages/members/MembersScreen";
import ImageSettingsScreen from "./pages/imageSettings/ImageSettingsScreen";
import RivalryScreen from "./pages/rivalry/RivalryScreen";
import GameIdScreen from "./pages/gameId/GameIdScreen";
import LeagueScreen from "./pages/league/LeagueScreen";
import ProfileModal from "./modals/ProfileModal";
import MemberProfileModal from "./modals/MemberProfileModal";
import AdminPanelModal from "./modals/AdminPanelModal";
import ChallengeInboxModal from "./modals/ChallengeInboxModal";
import ChallengeResultInboxModal from "./modals/ChallengeResultInboxModal";
import MatchRequestInboxModal from "./modals/MatchRequestInboxModal";
import AppUpdateNoticeModal from "./modals/AppUpdateNoticeModal";
import RankingScreen from "./pages/v2/RankingScreen";
import MatchScreen from "./pages/v2/MatchScreen";
import StatsScreen from "./pages/v2/StatsScreen";
import SharePage, { type ShareTarget } from "./pages/share/SharePage";

import type { ScreenKey } from "./types";

const SCREEN_KEYS: ScreenKey[] = ["ranking", "match", "challenge", "stats", "members", "imageSettings", "gameId", "leagues", "rivalry"];

// 새로고침해도 보던 화면 그대로 있도록 URL의 ?screen= 쿼리에 현재 화면을 기록해둔다 —
// 사파리의 pull-to-refresh 등 브라우저 기본 새로고침은 앱 상태를 그대로 날려서 첫 화면으로
// 돌아가 버리는데, URL만은 새로고침 후에도 그대로 유지되기 때문에 여기 저장해두는 것.
function screenFromUrl(): ScreenKey {
  const s = new URLSearchParams(window.location.search).get("screen");
  return (SCREEN_KEYS as string[]).includes(s ?? "") ? (s as ScreenKey) : "ranking";
}

// 카카오톡 공유 링크(?sv=match|challenge&sid=123) — 있으면 그 한 장만 보이는 공유 화면을 연다.
function shareTargetFromUrl(): ShareTarget | null {
  const params = new URLSearchParams(window.location.search);
  const sv = params.get("sv");
  const id = Number(params.get("sid"));
  if ((sv === "match" || sv === "challenge") && Number.isFinite(id) && id > 0) {
    return { type: sv, id };
  }
  return null;
}

export default function App() {
  const user = useAppStore((s) => s.user);
  const booting = useAppStore((s) => s.booting);
  const restoringSession = useAppStore((s) => s.restoringSession);
  const justLoggedIn = useAppStore((s) => s.justLoggedIn);
  const clearJustLoggedIn = useAppStore((s) => s.clearJustLoggedIn);
  const imageSettings = useAppStore((s) => s.imageSettings);
  const appVersion = useAppStore((s) => s.appVersion);
  const adminPanelOpen = useAppStore((s) => s.adminPanelOpen);
  const setAdminPanelOpen = useAppStore((s) => s.setAdminPanelOpen);
  const effectiveVersionNumber = versionNumber(appVersion);
  const isChallengeEnabled = effectiveVersionNumber >= CHALLENGE_MIN_VERSION;
  const bootstrap = useAppStore((s) => s.bootstrap);
  // 부팅(스플래시)이 끝나 본 화면이 처음 그려진 직후, 사파리 엣지 렌더(주소창 알약 뒤
  // 콘텐츠 합성)를 다시 굴린다 — 초기 진입 시 위아래가 잘린 채 남던 문제(지적) 대응.
  useEffect(() => {
    if (!booting) resampleSafariChrome();
  }, [booting]);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const logout = useAppStore((s) => s.logout);
  const restoreSession = useAppStore((s) => s.restoreSession);
  const viewingMemberId = useAppStore((s) => s.viewingMemberId);
  const closeMemberProfile = useAppStore((s) => s.closeMemberProfile);
  const memberOf = useAppStore((s) => s.memberOf);
  const viewingMember = viewingMemberId ? memberOf(viewingMemberId) : undefined;
  const inboxChallenges = useAppStore((s) => s.inboxChallenges);
  const dismissInboxChallenges = useAppStore((s) => s.dismissInboxChallenges);
  const resultInboxChallenges = useAppStore((s) => s.resultInboxChallenges);
  const dismissResultInboxChallenges = useAppStore((s) => s.dismissResultInboxChallenges);
  const inboxMatchRequests = useAppStore((s) => s.inboxMatchRequests);
  const dismissInboxMatchRequests = useAppStore((s) => s.dismissInboxMatchRequests);
  const updateNotice = useAppStore((s) => s.updateNotice);
  const dismissUpdateNotice = useAppStore((s) => s.dismissUpdateNotice);

  const [screen, setScreen] = useState<ScreenKey>(screenFromUrl);
  // 공유 링크로 들어왔으면 그 카드만 보이는 화면을 띄운다(로그인 뒤). "앱 열기"로 해제한다.
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(shareTargetFromUrl);
  const [profileOpen, setProfileOpen] = useState(false);
  // 로그인 직후 최초 진입 화면에서는 bootstrap()이 이미 방금 다 불러온 상태라, 그 화면으로
  // "이동"한 게 아닌데도 아래 새로고침 effect가 곧바로 또 중복 조회하지 않도록 건너뛴다.
  const skipNextRefresh = useRef(true);
  // 화면을 옮기면 항상 처음 상태로 — 이전 화면의 스크롤 위치/필터/검색 등은 기억하지
  // 않는다(요청: "페이지 상태 유지 기능 삭제 — 페이지 이동시 항상 초기상태로 로딩").
  const navigate = (next: ScreenKey) => setScreen(next);
  // 공유 화면에서 "앱 열기" — URL의 공유 파라미터를 지우고 전체 앱(랭킹)으로 들어간다.
  const exitShare = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("sv");
    params.delete("sid");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    setShareTarget(null);
    setScreen("ranking");
  };
  // 키보드가 뜨면(resizes-content라 뷰포트가 줄어들며) 브라우저가 포커스된 입력칸을
  // 보여주려고 스크롤을 올리는데, 키보드가 닫혀도 그 자리로 되돌아오지 않았다(실제로
  // 지적받은 문제 — "키보드 내려가면 다시 안 돌아와").
  useRestoreScrollOnKeyboardClose();
  // 하단 탭바를 iOS 사파리 주소창 바로 위에 붙이는 보정값(--vv-bottom-inset)을 갱신한다.
  useBottomViewportInset();

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

  // 화면이 바뀌면 항상 맨 위에서 시작한다(이전 위치를 기억하지 않음).
  useEffect(() => {
    scrollRootTo({ top: 0, left: 0, behavior: "instant" });
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
        <div className="scr-app scr-app-fallback-scroll" id="scr-app">
          <InAppBrowserNotice />
          <AuthScreen />
        </div>
      </ImageSettingContext.Provider>
    );
  }

  // 공유 링크(?sv=…&sid=…)로 들어왔으면 그 카드 한 장만 보이는 화면을 띄운다(요청). 헤더/
  // 탭바 등 앱 크롬 없이 카드만 — "앱 열기"로 전체 앱에 들어간다. 회원 목록(memberOf) 등
  // 기초 데이터가 준비된 뒤에 그린다.
  if (shareTarget) {
    return (
      <ImageSettingContext.Provider value={imageSettings}>
        <div className="scr-app scr-app-fallback-scroll" id="scr-app">
          <div className="scr-bg-grid" />
          <InAppBrowserNotice />
          {booting
            ? <div className="scr-boot"><Spinner size={22} /> 데이터 불러오는 중...</div>
            : <SharePage target={shareTarget} onExit={exitShare} />}
        </div>
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
    screen === "gameId" && !isAdmin ? "ranking" :
    screen === "leagues" && !isAdmin ? "ranking" :
    screen === "rivalry" && !isAdmin ? "ranking" :
    screen;

  return (
    <ImageSettingContext.Provider value={imageSettings}>
      {/* 배경 사진이 있는 화면(지금은 랭킹뿐)에서는 헤더까지 사진이 이어져 보이게 —
          헤더의 불투명 배경을 끄는 클래스를 앱 루트에 건다(CSS .scr-app-hasbg 참고).
          배경 있는 화면이 늘면 이 조건에 추가하면 된다. */}
      <div className={"scr-app" + (resolvedScreen === "ranking" ? " scr-app-hasbg" : "")} id="scr-app">
        <div className="scr-bg-grid" />
        <span className="scr-rail scr-rail-left" aria-hidden="true" />
        <span className="scr-rail scr-rail-right" aria-hidden="true" />

        {/* 앱 셀의 유일한 스크롤 영역 — html/body/#root는 overflow:hidden으로 고정되고
            (global.css), 실제 스크롤은 이 컨테이너 하나에서만 일어난다. utils/scrollRoot.ts의
            getScrollRoot()가 이 id를 찾아 window 대신 이 엘리먼트를 스크롤 신호의 기준으로 쓴다.
            헤더도 이 안(맨 위)에 둔다 — 고정 바(fixed/sticky)가 아니라 페이지 맨 위 콘텐츠로
            취급해, 스크롤하면 자연스럽게 같이 밀려 올라가고 맨 위로 돌아가면 다시 보이게
            한다(요청: "헤더는 고정식이 아니라 그냥 페이지의 TOP부분으로 여겨져서 스크롤시
            자연스럽게 올라가게"). 화면(랭킹/경기/...)을 여럿 마운트해두고 display:none만
            바꾸는 구조라도 헤더는 이 화면들과 별개로 스크롤 영역 맨 위에 하나만 있으면
            충분하다. */}
        <div id="scroll-root">
          <Header
            user={user}
            screen={screen}
            onNavigate={navigate}
            onOpenProfile={() => setProfileOpen(true)}
            onLogout={logout}
          />
          <main className="scr-main">
            {booting && (
              <div className="scr-boot"><Spinner size={22} /> 데이터 불러오는 중...</div>
            )}
            {/* 화면을 옮기면 이전 화면은 언마운트한다 — 필터/검색/스크롤 등 화면별 상태를
                더 이상 기억하지 않고, 돌아올 때마다 항상 처음 상태로 새로 불러온다(요청:
                "페이지 상태 유지 기능 삭제 — 페이지 이동시 항상 초기상태로 로딩"). 접근
                권한이 없는 화면(challenge/members/imageSettings)은 랭킹으로 대체되던
                기존 동작과 같게, resolvedScreen으로 보여줄 화면만 고른다. */}
            {!booting && resolvedScreen === "ranking" && <RankingScreen />}
            {!booting && resolvedScreen === "match" && <MatchScreen />}
            {isChallengeEnabled && !booting && resolvedScreen === "challenge" && <ChallengeScreen />}
            {!booting && resolvedScreen === "stats" && <StatsScreen />}
            {isAdmin && !booting && resolvedScreen === "members" && <MembersScreen />}
            {isAdmin && !booting && resolvedScreen === "imageSettings" && <ImageSettingsScreen />}
            {/* 운영자 전용 메뉴로 변경(요청) — 회원/이미지 설정과 같은 기준으로 운영자만 접근. */}
            {isAdmin && !booting && resolvedScreen === "gameId" && <GameIdScreen />}
            {/* 공식 리그 대진/결과 관리 — 다음 버전에서 열 예정, 지금은 운영자만(요청). */}
            {isAdmin && !booting && resolvedScreen === "leagues" && <LeagueScreen />}
            {/* 유저 상성 맵 — 운영 메뉴 전용(요청). */}
            {isAdmin && !booting && resolvedScreen === "rivalry" && <RivalryScreen />}
          </main>
        </div>

        {/* MobileTabBar(Header.tsx 안에서 렌더)가 이 자리로 포털링된다 — #scr-app을 포털
            대상으로 직접 쓰면 React가 포털을 항상 "마지막 자식"으로 붙여준다고 가정하기
            쉬운데, 실제로는 파이버 트리 형태에 따라 삽입 위치가 달라질 수 있어서(실제로
            겪은 버그 — Context.Provider 하나를 걷어냈을 뿐인데 탭바가 헤더보다 앞으로
            와버렸다) #scroll-root 바로 다음이라는 확실한 자리를 이 빈 div로 직접
            고정해준다. */}
        <div id="scr-tabbar-slot" />

        {/* 카톡 등 인앱 브라우저에서 열렸으면 "기본 브라우저로 열기" 안내(로그인 유지 목적). */}
        <InAppBrowserNotice />

        {/* 첫 방문(미설치) 때 한 번 뜨는 "홈 화면에 추가" 유도 배너 — 닫으면 다시 안 뜬다. */}
        <InstallBanner />

        {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
        {viewingMember && <MemberProfileModal member={viewingMember} onClose={closeMemberProfile} />}
        {adminPanelOpen && <AdminPanelModal isAdmin={isAdmin} onClose={() => setAdminPanelOpen(false)} />}
        {updateNotice && <AppUpdateNoticeModal notes={updateNotice.notes} onClose={dismissUpdateNotice} />}
        {inboxChallenges.length > 0 && (
          <ChallengeInboxModal challenges={inboxChallenges} onClose={dismissInboxChallenges} />
        )}
        {/* 초대(편지지) 팝업을 다 처리한 뒤에 결과 입력 팝업을 띄운다 — 두 팝업이 동시에
            겹쳐 뜨지 않게 초대 큐가 빈 뒤로 미룬다. */}
        {inboxChallenges.length === 0 && resultInboxChallenges.length > 0 && (
          <ChallengeResultInboxModal challenges={resultInboxChallenges} onClose={dismissResultInboxChallenges} />
        )}
        {/* 도전장 인박스들을 다 처리한 뒤에 "너 나와! 신청 언급" 알림을 띄운다(팝업 겹침 방지). */}
        {inboxChallenges.length === 0 && resultInboxChallenges.length === 0 && inboxMatchRequests.length > 0 && (
          <MatchRequestInboxModal items={inboxMatchRequests} onClose={dismissInboxMatchRequests} />
        )}

        {!booting && <ScrollTopButton />}
      </div>
    </ImageSettingContext.Provider>
  );
}
