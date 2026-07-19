import { create } from "zustand";
import { api } from "../api/client";
import { DEFAULT_ICON_SLOTS } from "../constants/iconSlots";
import { versionNumber } from "../utils/appVersion";
import type {
  Member, Match, NewMatch, MemberCreatePayload, ImageSettingMap, MemberStatus, MemberRole, AppVersion,
  AppVersionInfo, Challenge, MatchRequestInboxItem,
} from "../types";

// 버전이 바뀐 걸 감지했을 때 AppUpdateNoticeModal에 넘기는 정보 — 변경 내용 문구(notes)는
// 이제 버전별로 서버(app_versions.notes)에 있으므로, 활성 버전의 내용을 줄 단위로 담아 넘긴다.
export interface UpdateNotice {
  prevVersion: string;
  activeVersion: string;
  notes: string[];
}

// 숨겨진 제어판 트리거 — 탭 타임스탬프는 리렌더를 일으킬 이유가 없는 순수 내부 상태라
// store 상태(set)가 아니라 모듈 스코프 변수로 둔다.
const SECRET_TAP_COUNT = 3;
const SECRET_TAP_WINDOW_MS = 2000;
let secretTapTimestamps: number[] = [];

// 운영자가 제어판에서 버전을 배포(+1)/롤백(-1)하면, 그 뒤 처음 접속하는 모든 회원에게 한 번만
// 버전이 바뀌었다는 걸 알려준다 — 브라우저에 마지막으로 본 버전을 저장해뒀다가, 부트스트랩
// (앱을 새로 열 때 한 번) 시점에 지금 버전과 다르면 알려주고 새 값으로 갱신한다. 처음
// 방문(저장된 값 자체가 없음)은 "바뀐 적"이 아니므로 알리지 않는다. 화면 이동마다 다시
// 부르는 refreshAll()에서는 부르지 않는다 — "최초 접속시"만 알리면 되고, 세션 중간에
// 다른 운영자가 배포해도 그때마다 알림이 뜨면 오히려 방해가 된다.
const APP_VERSION_SEEN_KEY = "scr_last_seen_app_version";
// 버전 안내 내용(한 덩어리 문자열)을 줄 단위 항목으로 쪼갠다 — 앞뒤 공백/빈 줄은 버린다.
export function parseNoticeLines(notes: string | undefined | null): string[] {
  return (notes ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}
// 버전이 바뀌었으면(그리고 그 바뀐 이후 첫 접속이면) AppUpdateNoticeModal에 보여줄 정보를
// 돌려주고, 저장된 값은 항상 최신으로 갱신한다 — window.alert 한 줄 대신 실제 변경 내용을
// 보여주는 모달로 바꾼다. 단, (1) 관리자가 안내 표시를 꺼두면(noticeEnabled=false), (2) 활성
// 버전에 안내 내용이 비어 있으면 띄우지 않는다. "마지막으로 본 버전" 저장은 표시 여부와
// 무관하게 항상 최신으로 갱신한다(안내가 꺼진 동안 쌓인 변경을 나중에 몰아 보여주지 않게).
function computeUpdateNotice(
  activeVersion: AppVersion,
  noticeEnabled: boolean,
  appVersions: AppVersionInfo[],
): UpdateNotice | null {
  try {
    const prev = localStorage.getItem(APP_VERSION_SEEN_KEY);
    localStorage.setItem(APP_VERSION_SEEN_KEY, activeVersion);
    if (!noticeEnabled) return null;
    if (!prev || prev === activeVersion) return null;
    const entry = appVersions.find((v) => versionNumber(v.number) === versionNumber(activeVersion));
    const notes = parseNoticeLines(entry?.notes);
    if (notes.length === 0) return null;
    return { prevVersion: prev, activeVersion, notes };
  } catch {
    // localStorage 접근 실패(프라이빗 모드 등)는 조용히 무시한다 — 알림 기능 하나 때문에
    // 로그인 자체가 막히면 안 된다.
  }
  return null;
}


interface AppState {
  // ----- 상태 -----
  user: Member | null;
  members: Member[];
  imageSettings: ImageSettingMap;
  // 경기결과/전적통계/랭킹 화면의 "이전" 버튼 비활성화 판단 기준 — 실제 결과가 있는 가장
  // 이른 경기 날짜. 과거 데이터를 나중에 더 채워 넣어도 하드코딩 없이 항상 최신 값을
  // 반영하도록 상수 대신 부트스트랩 때마다 서버에서 다시 조회한다. 아직 못 불러온 동안은
  // null — 소비하는 쪽에서 빈 문자열(항상 permissive)로 대체해서 쓴다.
  earliestMatchDate: string | null;
  // 랭킹/경기결과/전적통계를 몇 버전 화면 세트로 그릴지 — 부트스트랩 때 로드하고,
  // 제어판에서 바꾸면 그 자리에서 다시 반영한다.
  appVersion: AppVersion;
  // 제어판의 버전 선택 팝업(미리보기/배포)이 나열할 '등록된 버전' 목록 — 부트스트랩 때 로드.
  // 각 항목은 버전별 안내 내용(notes)도 함께 들고 있다.
  appVersions: AppVersionInfo[];
  // 버전 안내(업데이트 안내 모달) 전역 표시 여부 — 관리자가 제어판에서 끄면 false.
  noticeEnabled: boolean;
  // 숨겨진 제어판 — 메인 로고를 짧은 시간 안에 여러 번 누르면 열린다. 트리거 위치가
  // 화면(컴포넌트) 트리 어디든(헤더의 로고 버튼) 아무 데서나 registerSecretTap()만
  // 부르면 되도록 스토어에 둔다.
  adminPanelOpen: boolean;
  setAdminPanelOpen: (open: boolean) => void;
  registerSecretTap: () => void;
  booting: boolean;
  // 새로고침 직후 저장된 토큰으로 로그인 상태 복원을 시도하는 동안 true
  restoringSession: boolean;
  // 방금 로그인 폼으로 직접 로그인했는지 — 새로고침으로 세션이 복원된 경우(restoreSession)와
  // 구분해야 한다. App.tsx가 이 값을 보고 "로그인하면 항상 랭킹으로" 이동시킨 뒤 꺼준다
  // (새로고침 복원 때는 보던 화면 그대로 유지해야 하므로 이 플래그를 안 켠다).
  justLoggedIn: boolean;
  clearJustLoggedIn: () => void;
  // 닉네임/아바타를 클릭했을 때 열리는 회원 프로필 팝업 대상 (앱 어디서든 하나만 뜬다)
  viewingMemberId: string | null;
  // "너 나와!" 도전장 — 다음 접속 때(부트스트랩 시점) 아직 안 본 도전장을 한 번만 팝업으로
  // 보여준다. 서버가 조회 즉시 "봤음"으로 표시하므로, 여기 담긴 항목을 다 처리(닫음)하면
  // 다시 새로고침해도 재등장하지 않는다.
  inboxChallenges: Challenge[];
  dismissInboxChallenges: () => void;
  // 예정 일시가 지났는데 아직 결과가 안 들어온 내 확정 대결 — 다음 접속 때(부트스트랩
  // 시점) 아직 팝업으로 안 본 것만 한 번 띄워 결과를 바로 입력하게 한다. "봤는지"는
  // 서버(challenge_participants.result_notified)가 기억한다 — 기기/브라우저를 바꿔도
  // 다시 안 뜬다(요청: "결과 입력 팝업 확인 여부는 디비에 관리").
  resultInboxChallenges: Challenge[];
  dismissResultInboxChallenges: () => void;
  // 대결 요청에 언급된 나에게 온 알림 — 부트스트랩 시점에 안 읽은 것만 담겨 팝업으로 한 번
  // 보여준다. 닫으면 서버에 읽음 처리해 다시 안 뜬다(요청: "읽으면 다시 안 뜸").
  inboxMatchRequests: MatchRequestInboxItem[];
  dismissInboxMatchRequests: () => void;
  // 운영자가 배포한 버전이 마지막으로 본 값과 다르면(부트스트랩 시점) 한 번만 채워진다 —
  // AppUpdateNoticeModal이 이 값을 보고 뜬다. 닫으면 다시 null로 돌아가 재등장하지 않는다.
  updateNotice: UpdateNotice | null;
  dismissUpdateNotice: () => void;

  // ----- 인증 -----
  login: (id: string, password: string) => Promise<void>;
  logout: () => void;
  // 새로고침 시 저장된 토큰으로 로그인 세션 복원 시도
  restoreSession: () => Promise<void>;

  // ----- 초기 데이터 로드 -----
  bootstrap: () => Promise<void>;

  // ----- 경기결과 ----- 이제 전체 매치를 store에 들고 있지 않는다(경기결과 화면이 서버
  // 페이지네이션으로 직접 조회) — 아래는 API 호출만 하는 얇은 통과 함수. 각 화면은 저장/삭제
  // 후 자기 로컬 목록(useCursorPagination의 reload)을 직접 새로고침한다.
  addMatch: (match: NewMatch) => Promise<Match>;
  deleteMatch: (id: number) => Promise<void>;

  // 통계/랭킹 화면의 새로고침 버튼용: 회원 목록을 다시 불러온다
  refreshAll: () => Promise<void>;

  // ----- 프로필 / 아이콘 -----
  updateProfile: (patch: Partial<Omit<Member, "roles" | "status" | "createdAt">>) => Promise<void>;
  // 본인 전용: 비밀번호 변경 (현재 비밀번호 확인 필요)
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateImageSettings: (next: ImageSettingMap) => Promise<void>;
  withdraw: () => Promise<void>;

  // ----- 회원 화면(운영자 전용) -----
  updateMemberStatus: (id: string, status: MemberStatus) => Promise<void>;
  // 운영자 전용: 운영자/회원 역할 지정/회수 (전체 역할 목록을 통째로 교체)
  updateMemberRoles: (id: string, roles: MemberRole[]) => Promise<void>;
  // 운영자 전용: 이미 저장된 사진을 서버에서 다시 불러와 재처리(화질 개선)
  reprocessMemberAvatar: (id: string) => Promise<void>;
  // 게임아이디 목록(최대 3개) 전체 교체 (본인/타인 모두, 로그인한 회원이면 누구나)
  replaceMemberReplayAliases: (id: string, aliases: string[]) => Promise<void>;
  // 리플레이 매칭 중 못 찾은 이름 하나 추가 (이미 3개면 서버가 가장 오래된 것을 지움)
  addMemberReplayAlias: (id: string, alias: string) => Promise<void>;
  // 운영자 전용: 회원 화면에서 회원을 바로 생성 (승인 절차 없이 즉시 active)
  createMemberByAdmin: (payload: MemberCreatePayload) => Promise<void>;

  // ----- 회원 프로필 팝업 -----
  openMemberProfile: (id: string) => void;
  closeMemberProfile: () => void;

  // ----- 제어판: 현재 버전 설정(등록된 버전으로 전환) -----
  setAppVersion: (version: AppVersion) => Promise<void>;

  // ----- 제어판: 버전 관리 -----
  // 새 버전을 등록하고 로컬 appVersions에 숫자 오름차순으로 끼워 넣는다(운영자 전용).
  addVersion: (number: AppVersion) => Promise<void>;
  // 등록된 버전을 삭제하고 로컬 appVersions에서도 뺀다(운영자 전용).
  deleteVersion: (number: AppVersion) => Promise<void>;
  // 버전 안내 표시 여부(전역 토글)를 서버에 저장하고 로컬 상태도 갱신한다(운영자 전용).
  setNoticeEnabled: (enabled: boolean) => Promise<void>;
  // 특정 버전의 안내 내용을 서버에 저장하고, 로컬 appVersions의 그 버전 notes도 갱신한다.
  saveVersionNotes: (number: AppVersion, notes: string) => Promise<void>;

  // ----- 파생 셀렉터(헬퍼) -----
  memberOf: (id: string) => Member | undefined;
}

export const useAppStore = create<AppState>()((set, get) => ({
  user: null,
  members: [],
  imageSettings: DEFAULT_ICON_SLOTS,
  earliestMatchDate: null,
  appVersion: "1",
  appVersions: [],
  noticeEnabled: true,
  adminPanelOpen: false,
  setAdminPanelOpen: (open) => set({ adminPanelOpen: open }),
  registerSecretTap: () => {
    const now = Date.now();
    secretTapTimestamps = [...secretTapTimestamps, now].filter((t) => now - t <= SECRET_TAP_WINDOW_MS);
    if (secretTapTimestamps.length >= SECRET_TAP_COUNT) {
      secretTapTimestamps = [];
      set({ adminPanelOpen: true });
    }
  },
  // 세션 복원(restoreSession)이 user를 채우고 나면 bootstrap() 이펙트가 실행되기 전까지
  // 한 프레임 정도 짧은 틈이 있는데, booting이 기본 false면 그 틈에 화면이 빈 members/matches로
  // 잠깐 마운트됐다가(예: 주간랭킹 화면이 엉뚱한 순간의 데이터로 한 번 그려짐) 다시 스피너로
  // 바뀌는 깜빡임이 생긴다. 토큰이 있으면(=곧 bootstrap이 돌 예정이면) 처음부터 로딩 중으로
  // 시작해 그 틈을 없앤다.
  booting: api.hasToken(),
  restoringSession: api.hasToken(),
  viewingMemberId: null,
  justLoggedIn: false,
  clearJustLoggedIn: () => set({ justLoggedIn: false }),
  inboxChallenges: [],
  dismissInboxChallenges: () => set({ inboxChallenges: [] }),
  resultInboxChallenges: [],
  dismissResultInboxChallenges: () => set({ resultInboxChallenges: [] }),
  inboxMatchRequests: [],
  // 닫으면 화면에서 지우고, 서버에도 읽음 처리해 다음 접속 때 다시 안 뜨게 한다.
  dismissInboxMatchRequests: () => {
    set({ inboxMatchRequests: [] });
    void api.markMatchRequestInboxRead().catch(() => {});
  },
  updateNotice: null,
  dismissUpdateNotice: () => set({ updateNotice: null }),

  login: async (id, password) => {
    const { user } = await api.login(id, password);
    set({ user, justLoggedIn: true });
  },

  logout: () => {
    api.logout();
    set({ user: null, members: [] });
  },

  restoreSession: async () => {
    if (!api.hasToken()) { set({ restoringSession: false }); return; }
    try {
      const user = await api.me();
      set({ user });
    } catch {
      api.logout();
    } finally {
      set({ restoringSession: false });
    }
  },

  bootstrap: async () => {
    set({ booting: true });
    try {
      const [
        members, imageSettings, { activeVersion, noticeEnabled }, appVersions, earliestMatchDate,
        { items: inboxChallenges }, { items: resultInboxChallenges }, { items: inboxMatchRequests },
      ] = await Promise.all([
        api.getMembers(),
        api.getImageSettings(),
        api.getAppVersion(),
        api.getAppVersions(),
        api.getEarliestMatchDate(),
        api.getPendingChallengesForMe(),
        api.getResultPendingChallengesForMe(),
        api.getMatchRequestInbox(),
      ]);
      set({
        members, imageSettings, appVersion: activeVersion, appVersions, noticeEnabled, earliestMatchDate,
        inboxChallenges, resultInboxChallenges, inboxMatchRequests,
        updateNotice: computeUpdateNotice(activeVersion, noticeEnabled, appVersions),
      });
    } finally {
      set({ booting: false });
    }
  },

  addMatch: async (match) => api.createMatch(match),
  deleteMatch: async (id) => { await api.deleteMatch(id); },

  // 화면 이동마다 호출 — 회원 목록과 함께 현재 활성 버전도 다시 가져온다. 다른
  // 운영자가 그 사이 제어판에서 전환했어도 화면을 옮기는 것만으로 바로 반영되게 한다.
  // 경기결과 목록 자체는 각 화면이 직접 페이지네이션 관리하므로 여기서 다루지 않는다.
  refreshAll: async () => {
    const [members, { activeVersion }] = await Promise.all([
      api.getMembers(),
      api.getAppVersion(),
    ]);
    set({ members, appVersion: activeVersion });
  },

  updateProfile: async (patch) => {
    const current = get().user;
    if (!current) return;
    const updated = await api.updateProfile(current.id, patch);
    set((s) => ({
      user: updated,
      members: s.members.map((m) => (m.id === current.id ? updated : m)),
    }));
  },

  updatePassword: async (currentPassword, newPassword) => {
    const current = get().user;
    if (!current) return;
    await api.updateMemberPassword(current.id, currentPassword, newPassword);
  },

  updateImageSettings: async (next) => {
    const updated = await api.updateImageSettings(next);
    set({ imageSettings: updated });
  },

  withdraw: async () => {
    const current = get().user;
    if (!current) return;
    await api.withdraw(current.id);
    api.logout();
    set({ user: null, members: [] });
  },

  updateMemberStatus: async (id, status) => {
    const updated = await api.updateMemberStatus(id, status);
    set((s) => ({ members: s.members.map((m) => (m.id === id ? updated : m)) }));
  },

  updateMemberRoles: async (id, roles) => {
    const updated = await api.updateMemberRoles(id, roles);
    set((s) => ({ members: s.members.map((m) => (m.id === id ? updated : m)) }));
  },

  reprocessMemberAvatar: async (id) => {
    const updated = await api.reprocessMemberAvatar(id);
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? updated : m)),
      user: s.user?.id === id ? updated : s.user,
    }));
  },

  replaceMemberReplayAliases: async (id, aliases) => {
    const updated = await api.replaceMemberReplayAliases(id, aliases);
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? updated : m)),
      user: s.user?.id === id ? updated : s.user,
    }));
  },

  addMemberReplayAlias: async (id, alias) => {
    const updated = await api.addMemberReplayAlias(id, alias);
    set((s) => ({
      members: s.members.map((m) => (m.id === id ? updated : m)),
      user: s.user?.id === id ? updated : s.user,
    }));
  },

  createMemberByAdmin: async (payload) => {
    const created = await api.createMemberByAdmin(payload);
    set((s) => ({ members: [...s.members, created] }));
  },

  openMemberProfile: (id) => set({ viewingMemberId: id }),
  closeMemberProfile: () => set({ viewingMemberId: null }),

  setAppVersion: async (version) => {
    const { activeVersion } = await api.setAppVersion(version);
    set({ appVersion: activeVersion });
  },

  addVersion: async (number) => {
    const added = await api.addAppVersion(number);
    // 숫자 오름차순 유지("10"이 "2" 앞에 오지 않도록 versionNumber로 비교) — 서버 목록과 같은 순서.
    set({
      appVersions: [...get().appVersions, added].sort(
        (a, b) => versionNumber(a.number) - versionNumber(b.number),
      ),
    });
  },

  deleteVersion: async (number) => {
    await api.deleteAppVersion(number);
    set({
      appVersions: get().appVersions.filter(
        (v) => versionNumber(v.number) !== versionNumber(number),
      ),
    });
  },

  setNoticeEnabled: async (enabled) => {
    const res = await api.setVersionNoticeEnabled(enabled);
    set({ noticeEnabled: res.enabled });
  },

  saveVersionNotes: async (number, notes) => {
    const saved = await api.setVersionNotes(number, notes);
    // 방금 저장한 버전의 notes만 서버가 정리한 값(앞뒤 공백 제거 등)으로 바꿔 끼운다.
    set({
      appVersions: get().appVersions.map((v) =>
        versionNumber(v.number) === versionNumber(saved.number) ? { ...v, notes: saved.notes } : v,
      ),
    });
  },

  memberOf: (id) => get().members.find((m) => m.id === id),
}));
