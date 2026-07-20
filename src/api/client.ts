// ============================================================
// API 클라이언트 — stargayte-api 서버와 통신한다.
// ============================================================
import type {
  Member, Match, NewMatch, SignupPayload, MemberCreatePayload, ImageSettingMap, MemberStatus, MemberRole,
  ScreenKey, AppVersion, AppVersionStatus, AppVersionInfo,
  MatchSlot, MatchPage, MatchStatsResponse, MatchType, Race, TeamRankingResponse,
  MonthlyMatchStatsResponse, MonthlyTeamRankingResponse, RatingHistoryResponse,
  ReplayNameClassificationEntry, ReplayNameKind, ReplayNameMappingEntry, ReplayNameMappingKind,
  Challenge, ChallengeCreatePayload, ChallengeRevengePayload, ChallengeResult,
  MatchRequest, MatchRequestCreatePayload, MatchRequestListResponse, MatchRequestInboxItem,
} from "../types";

// undefined/""/"all"(필터 미지정 관례) 값은 아예 뺀 쿼리스트링을 만든다 — 서버는 파라미터가
// 없으면 그 조건을 걸지 않는 것으로 해석한다.
function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "" || value === "all") return;
    usp.set(key, String(value));
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

// ── 슬롯 게임아이디 이름 매핑 (계약↔도메인) ────────────────────────────────
// 서버 계약은 슬롯의 리플레이 원본 게임아이디를 playerName으로 주고받지만(DB 컬럼
// player_name), 프론트는 도메인 언어로 rawName을 쓴다. 이 이름 불일치를 여기(API 경계)
// 한 곳에서만 흡수한다(anti-corruption layer) — 다른 곳은 전부 rawName만 안다. 이 매핑이
// 없으면 슬롯을 rawName으로 보내도 서버가 못 읽어 리플레이 컴퓨터/비회원 게임아이디가
// 저장 왕복에서 통째로 유실됐다(실제로 지적받은 문제 — 게임아이디 화면에 안 뜸).
type WireSlot = Omit<MatchSlot, "rawName"> & { playerName?: string | null };
type WireMatch = Omit<Match, "team1" | "team2"> & { team1: WireSlot[]; team2: WireSlot[] };

function slotToWire(slot: MatchSlot): WireSlot {
  const { rawName, ...rest } = slot;
  return { ...rest, playerName: rawName ?? null };
}
function matchToWire(match: NewMatch): Omit<NewMatch, "team1" | "team2"> & { team1: WireSlot[]; team2: WireSlot[] } {
  return { ...match, team1: match.team1.map(slotToWire), team2: match.team2.map(slotToWire) };
}
function slotFromWire(slot: WireSlot): MatchSlot {
  const { playerName, ...rest } = slot;
  return { ...rest, rawName: playerName || null };
}
function matchFromWire(match: WireMatch): Match {
  return {
    ...match,
    team1: (match.team1 ?? []).map(slotFromWire),
    team2: (match.team2 ?? []).map(slotFromWire),
  };
}

export interface MatchListParams {
  cursor?: string;
  limit?: number;
  sort?: "latest" | "oldest";
  dateFrom?: string;
  dateTo?: string;
  matchType?: MatchType | "all";
  userQuery?: string;
  matchAllUsers?: boolean;
  // 운영자 "유저연결" 화면 전용 — 컴퓨터/비회원 참가자가 있는 경기만 골라본다.
  hasPlaceholder?: boolean;
  // 팀 랭킹에서 팀 하나를 눌렀을 때 — 이 회원들이 전부 "같은 편"으로 뛴 경기만 추린다.
  // userQuery+matchAllUsers("전원이 참가한 경기")와 달리 서로 상대편이었던 경기는 빠진다.
  teamMemberIds?: string[];
}

export interface MatchStatsParams {
  memberIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  matchType?: MatchType | "all";
  race?: Race | "all";
}

export interface TeamRankingParams {
  dateFrom?: string;
  dateTo?: string;
}

export interface MonthlyStatsParams {
  months: string[];
  memberIds?: string[];
  matchType?: MatchType | "all";
  race?: Race | "all";
}

export interface MainRaceParams {
  memberId: string;
  dateFrom?: string;
  dateTo?: string;
  matchType?: MatchType | "all";
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

interface AuthResponse {
  user: Member;
}

interface RawAuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  user: Member;
}

// 액세스 토큰(1시간)과 리프레시 토큰(30일)을 함께 localStorage 에 영속화해 새로고침/재방문
// 시에도 세션이 유지되게 한다.
const TOKEN_KEY = "stargayte_token";
const REFRESH_KEY = "stargayte_refresh_token";
let accessToken: string | null = localStorage.getItem(TOKEN_KEY);
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY);

function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// 여러 요청이 동시에 401을 받아도 리프레시는 한 번만 실행되도록 진행 중인 Promise를 공유한다.
let refreshingPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshingPromise) {
    refreshingPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          clearTokens();
          return false;
        }
        const body = (await res.json()) as RawAuthResponse;
        setTokens(body.accessToken, body.refreshToken);
        return true;
      } catch {
        clearTokens();
        return false;
      } finally {
        refreshingPromise = null;
      }
    })();
  }
  return refreshingPromise;
}

const NO_REFRESH_RETRY_PATHS = ["/api/auth/login", "/api/auth/signup", "/api/auth/refresh"];

async function request<T>(path: string, options: RequestInit = {}, retryOn401 = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 && retryOn401 && !NO_REFRESH_RETRY_PATHS.includes(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // 보통 detail은 우리 서버가 직접 던진 문자열이지만, 요청 자체가 FastAPI 검증을
    // 못 넘으면(예: limit 상한 초과) detail이 [{msg, loc, ...}] 배열로 온다 — 그대로
    // new Error(배열)을 쓰면 메시지가 "[object Object]"로 뭉개져 아무 정보가 없다.
    const detail = body?.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === "string"
        ? detail[0].msg
        : "요청 처리 중 오류가 발생했어요.";
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// 평문(text/plain) 응답용 — 레이팅 백테스트 임시 엔드포인트가 텍스트 리포트를 준다.
async function requestText(path: string): Promise<string> {
  const build = () => {
    const h = new Headers();
    if (accessToken) h.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${API_BASE}${path}`, { headers: h });
  };
  let res = await build();
  if (res.status === 401 && (await tryRefresh())) res = await build();
  if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
  return res.text();
}

export const api = {
  // [임시/분석] 전투력 백테스트 텍스트 리포트.
  async getRatingBacktest(matchType?: string): Promise<string> {
    const qs = matchType ? `?match_type=${matchType}` : "";
    return requestText(`/api/matches/rating-backtest${qs}`);
  },

  async login(id: string, password: string): Promise<AuthResponse> {
    const res = await request<RawAuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ id, password }),
    });
    setTokens(res.accessToken, res.refreshToken);
    return { user: res.user };
  },

  async signup(payload: SignupPayload): Promise<AuthResponse> {
    const res = await request<RawAuthResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setTokens(res.accessToken, res.refreshToken);
    return { user: res.user };
  },

  // 운영자 전용 — 회원 화면에서 회원을 바로 생성(승인 절차 없이 즉시 active).
  // signup과 달리 토큰을 발급/저장하지 않는다 — 로그인 중인 운영자 세션이 그대로 유지돼야 한다.
  async createMemberByAdmin(payload: MemberCreatePayload): Promise<Member> {
    return request<Member>("/api/members", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // 저장된 리프레시 토큰이 있으면 로그인 상태를 복원할 때 사용 (새로고침 시).
  // 액세스 토큰(1시간)이 만료돼 있어도 request() 내부에서 자동으로 갱신을 시도한다.
  hasToken(): boolean {
    return !!refreshToken;
  },

  // 서버에 리프레시 토큰 폐기를 요청한 뒤 로컬 토큰을 정리한다. 네트워크 오류로 서버측
  // 폐기가 실패해도 로컬 세션은 이미 정리됐으므로 무시한다.
  async logout(): Promise<void> {
    const tokenToRevoke = refreshToken;
    clearTokens();
    if (!tokenToRevoke) return;
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokenToRevoke }),
      });
    } catch {
      // 로컬 세션은 이미 정리됨 — 서버측 폐기 실패는 무시한다.
    }
  },

  async me(): Promise<Member> {
    return request<Member>("/api/auth/me");
  },

  async getMembers(): Promise<Member[]> {
    return request<Member[]>("/api/members");
  },

  async getMatchesPage(params: MatchListParams = {}): Promise<MatchPage> {
    const qs = buildQuery({
      cursor: params.cursor,
      limit: params.limit,
      sort: params.sort,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      matchType: params.matchType,
      userQuery: params.userQuery,
      hasPlaceholder: params.hasPlaceholder,
      matchAllUsers: params.matchAllUsers,
      teamMemberIds: params.teamMemberIds?.length ? params.teamMemberIds.join(",") : undefined,
    });
    const page = await request<Omit<MatchPage, "items"> & { items: WireMatch[] }>(`/api/matches${qs}`);
    return { ...page, items: page.items.map(matchFromWire) };
  },

  // 통계/랭킹 공용 — 매치 원본이 아니라 회원별로 이미 집계된 결과를 받는다.
  async getMatchStats(params: MatchStatsParams = {}): Promise<MatchStatsResponse> {
    const qs = buildQuery({
      memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      matchType: params.matchType,
      race: params.race,
    });
    return request<MatchStatsResponse>(`/api/matches/stats${qs}`);
  },

  // 랭킹 상세의 '경기당 레이팅 변화(Δ)' — 이 회원이 뛴 경기의 matchNo → μ 증감. 레이팅은
  // 클라이언트가 재구성할 수 없어 서버가 계산해 준다. 목록이 조회 기간만으로 리셋해 매겨지므로
  // (요청: "해당 월이나 년도만의 리셋된 데이터로 조회"), 여기도 같은 dateFrom/dateTo를 넘겨야
  // 목록의 μ/σ와 이 상세의 Δ 합이 어긋나지 않는다.
  async getRatingHistory(
    memberId: string, matchType?: string, dateFrom?: string, dateTo?: string,
  ): Promise<RatingHistoryResponse> {
    const qs = buildQuery({ memberId, matchType, dateFrom, dateTo });
    return request<RatingHistoryResponse>(`/api/matches/rating-history${qs}`);
  },

  // 팀랭킹 — dateFrom/dateTo를 안 넘기면 전체 경기, 넘기면(랭킹 화면의 월 기준 기본
  // 집계) 그 기간만 서버가 집계하고 정렬까지 끝내서 내려준다.
  async getTeamRanking(params: TeamRankingParams = {}): Promise<TeamRankingResponse> {
    const qs = buildQuery({ dateFrom: params.dateFrom, dateTo: params.dateTo });
    return request<TeamRankingResponse>(`/api/matches/team-ranking${qs}`);
  },

  // 개인 랭킹의 월별 순위변동(최근 5개월)/목록의 전월 대비 화살표 — "YYYY-MM" 여러 개를
  // 한 번에 보내 왕복 없이 달마다 집계된 결과를 받는다.
  async getMatchStatsMonthly(params: MonthlyStatsParams): Promise<MonthlyMatchStatsResponse> {
    const qs = buildQuery({
      months: params.months.join(","),
      memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
      matchType: params.matchType,
      race: params.race,
    });
    return request<MonthlyMatchStatsResponse>(`/api/matches/stats/monthly${qs}`);
  },

  // 팀 랭킹 버전 — 위와 같은 목적.
  async getTeamRankingMonthly(months: string[]): Promise<MonthlyTeamRankingResponse> {
    const qs = buildQuery({ months: months.join(",") });
    return request<MonthlyTeamRankingResponse>(`/api/matches/team-ranking/monthly${qs}`);
  },

  // 경기 등록 모달에서 "랜덤" 주종족 회원의 종족 select 기본값 프리필용 — 대량 통계
  // 엔드포인트와 분리된 가벼운 단일 회원 조회.
  async getMemberMainRace(params: MainRaceParams): Promise<Race | null> {
    const qs = buildQuery({
      memberId: params.memberId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      matchType: params.matchType,
    });
    const res = await request<{ race: Race | null }>(`/api/matches/main-race${qs}`);
    return res.race;
  },

  // 랭킹 화면의 "이전" 버튼 비활성화 판단용 — 실제 결과가 있는 가장 이른 경기 날짜.
  async getEarliestMatchDate(): Promise<string | null> {
    const res = await request<{ date: string | null }>("/api/matches/earliest-date");
    return res.date;
  },

  // 리플레이 업로드 시 이미 등록된 경기(gameStartedAt 기준)인지 서버에 물어본다 —
  // 입력한 값 중 이미 존재하는 것만(원본 문자열 그대로) 돌아온다.
  async checkReplayDuplicates(gameStartedAt: string[]): Promise<string[]> {
    if (gameStartedAt.length === 0) return [];
    const res = await request<{ existing: string[] }>("/api/matches/duplicate-check", {
      method: "POST",
      body: JSON.stringify({ gameStartedAt }),
    });
    return res.existing;
  },

  // 배틀태그로 못 찾은 리플레이 참가자 이름 중, 예전에 컴퓨터/비회원으로 지정해둔 적이
  // 있는 이름만 그 분류와 함께 돌아온다(없으면 그 이름은 응답에서 빠짐 — 그대로 미매칭으로
  // 남아 사용자가 지정해야 함).
  async lookupReplayNameClassifications(rawNames: string[]): Promise<ReplayNameClassificationEntry[]> {
    if (rawNames.length === 0) return [];
    const res = await request<{ classifications: ReplayNameClassificationEntry[] }>(
      "/api/matches/replay-name-classifications/lookup",
      { method: "POST", body: JSON.stringify({ rawNames }) },
    );
    return res.classifications;
  },

  // 사용자가 미매칭 선수를 컴퓨터/비회원으로 직접 지정하면, 다음에 같은 이름이 또
  // 나왔을 때 자동으로 같은 분류를 적용할 수 있도록 서버에 기억시킨다.
  async setReplayNameClassification(rawName: string, kind: ReplayNameKind): Promise<ReplayNameClassificationEntry> {
    return request<ReplayNameClassificationEntry>("/api/matches/replay-name-classifications", {
      method: "POST",
      body: JSON.stringify({ rawName, kind }),
    });
  },

  // 유저연결 화면 — 리플레이 원본 이름(rawName) 전체 목록(회원 별칭/컴퓨터·비회원
  // 분류/아직 미해결 셋을 합친 것)과, 하나를 다시 지정하는 저장.
  async listReplayNameMappings(): Promise<ReplayNameMappingEntry[]> {
    const res = await request<{ entries: ReplayNameMappingEntry[] }>("/api/matches/replay-name-mappings");
    return res.entries;
  },

  async setReplayNameMapping(
    rawName: string, kind: ReplayNameMappingKind, memberId?: string,
  ): Promise<ReplayNameMappingEntry> {
    return request<ReplayNameMappingEntry>("/api/matches/replay-name-mappings", {
      method: "POST",
      body: JSON.stringify({ rawName, kind, memberId }),
    });
  },

  // "미지정으로 되돌리기"(setReplayNameMapping의 kind="unresolved")와 달리, 매핑
  // 데이터(replay_aliases 행) 자체를 지워 목록에서 완전히 사라지게 한다 — 이 raw_name으로
  // 등록된 경기가 하나라도 있으면 서버가 막는다(그럼 미지정으로 다시 나타나야 정상이라).
  async deleteReplayNameMapping(rawName: string): Promise<void> {
    await request<void>(`/api/matches/replay-name-mappings/${encodeURIComponent(rawName)}`, { method: "DELETE" });
  },

  async createMatch(match: NewMatch): Promise<Match> {
    const res = await request<WireMatch>("/api/matches", {
      method: "POST",
      body: JSON.stringify(matchToWire(match)),
    });
    return matchFromWire(res);
  },


  async deleteMatch(id: number): Promise<void> {
    await request<void>(`/api/matches/${id}`, { method: "DELETE" });
  },

  // 모든 경기기록 삭제(운영자 제어판) — 첨부 파일까지 서버에서 함께 지운다. 삭제 건수 반환.
  async deleteAllMatches(): Promise<{ deleted: number }> {
    return request<{ deleted: number }>("/api/matches/all", { method: "DELETE" });
  },

  // 정식 수정(updateMatch, 작성자/운영자 전용)과 달리 회원 누구나 남길 수 있는 가벼운 메모.
  async updateMatchMemo(id: number, note: string): Promise<Match> {
    const res = await request<WireMatch>(`/api/matches/${id}/memo`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    });
    return matchFromWire(res);
  },

  // 인증 헤더가 필요해 <a href> 로 바로 못 받으므로 blob 으로 받아 저장한다.
  async downloadReplay(matchId: number): Promise<Blob> {
    const headers = new Headers();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const res = await fetch(`${API_BASE}/api/matches/${matchId}/replay`, { headers });
    if (!res.ok) throw new Error("리플레이를 다운로드하지 못했어요.");
    return res.blob();
  },

  // 등록된 리플레이(.rep) 전체를 날짜별 폴더 zip으로 받는다(운영자 전용, 관리자 제어판).
  async downloadReplayArchive(): Promise<Blob> {
    const headers = new Headers();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const res = await fetch(`${API_BASE}/api/matches/replays/archive`, { headers });
    if (!res.ok) throw new Error("리플레이를 다운로드하지 못했어요.");
    return res.blob();
  },

  async updateProfile(id: string, patch: Partial<Member>): Promise<Member> {
    return request<Member>(`/api/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  // 게임아이디 목록(최대 3개)을 운영자/본인이 화면에서 통째로 교체. 배틀태그와 무관한
  // 정보라 로그인한 회원이면 누구나(본인이 아니어도) 저장할 수 있다.
  async replaceMemberReplayAliases(id: string, aliases: string[]): Promise<Member> {
    return request<Member>(`/api/members/${id}/replay-aliases`, {
      method: "PUT",
      body: JSON.stringify({ aliases }),
    });
  },

  // 리플레이 매칭 중 못 찾은 이름 하나를 추가 (이미 3개면 서버가 가장 오래된 것을 지우고 추가).
  async addMemberReplayAlias(id: string, alias: string): Promise<Member> {
    return request<Member>(`/api/members/${id}/replay-aliases`, {
      method: "POST",
      body: JSON.stringify({ alias }),
    });
  },

  // 본인 전용: 비밀번호 변경 (현재 비밀번호 확인 필요)
  async updateMemberPassword(id: string, currentPassword: string, newPassword: string): Promise<Member> {
    return request<Member>(`/api/members/${id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  // 운영자 전용: 회원 승인(active) / 사용 중지(suspended) / 재개(active)
  async updateMemberStatus(id: string, status: MemberStatus): Promise<Member> {
    return request<Member>(`/api/members/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  // 슈퍼관리자 전용: 관리자/회원/테스터/개발자 역할 다중 지정/회수 (전체 역할 목록을 통째로 교체).
  // 슈퍼관리자(0201) 지정/해제는 지원하지 않는다.
  async updateMemberRoles(id: string, roles: MemberRole[]): Promise<Member> {
    return request<Member>(`/api/members/${id}/roles`, {
      method: "PATCH",
      body: JSON.stringify({ roles }),
    });
  },

  // 관리자 전용: 이미 저장된 사진을 서버에서 다시 불러와 재처리(화질 개선)
  async reprocessMemberAvatar(id: string): Promise<Member> {
    return request<Member>(`/api/members/${id}/avatar/reprocess`, { method: "POST" });
  },

  // 본인 계정 탈퇴
  async withdraw(id: string): Promise<Member> {
    return request<Member>(`/api/members/${id}/withdraw`, { method: "POST" });
  },

  async getImageSettings(): Promise<ImageSettingMap> {
    return request<ImageSettingMap>("/api/settings/image-settings");
  },

  async updateImageSettings(next: ImageSettingMap): Promise<ImageSettingMap> {
    return request<ImageSettingMap>("/api/settings/image-settings", {
      method: "PUT",
      body: JSON.stringify(next),
    });
  },

  // 화면을 전환할 때마다 호출 — 접속 기록에 "언제 어떤 화면을 봤는지" 남긴다.
  // 실패해도 화면 전환 자체를 막을 이유는 없으므로 호출부에서 실패를 무시한다.
  async pingAccess(screen: ScreenKey): Promise<void> {
    await request<void>("/api/auth/access-ping", {
      method: "POST",
      body: JSON.stringify({ screen }),
    });
  },

  // 로그인한 회원이면 누구나: 랭킹/경기결과/전적통계를 어느 버전 화면 세트로 그릴지.
  async getAppVersion(): Promise<AppVersionStatus> {
    return request<AppVersionStatus>("/api/app-version");
  },

  // 로그인한 회원이면 누구나: 제어판의 버전 선택 팝업(미리보기/배포)이 나열할 '등록된 버전' 목록.
  async getAppVersions(): Promise<AppVersionInfo[]> {
    return request<AppVersionInfo[]>("/api/app-versions");
  },

  // 운영자 전용: 관리자 패널의 배포 — 등록된 버전으로만 전환한다(합의 절차 없이 바로).
  async setAppVersion(activeVersion: AppVersion): Promise<AppVersionStatus> {
    return request<AppVersionStatus>("/api/app-version", {
      method: "PUT",
      body: JSON.stringify({ activeVersion }),
    });
  },

  // 운영자 전용: 버전 관리 — 새 버전 등록(자유 숫자 입력). 형식/중복은 서버가 검증한다.
  async addAppVersion(number: AppVersion): Promise<AppVersionInfo> {
    return request<AppVersionInfo>("/api/app-versions", {
      method: "POST",
      body: JSON.stringify({ number }),
    });
  },

  // 운영자 전용: 버전 관리 — 등록된 버전 삭제. 활성/마지막 버전은 서버가 막는다.
  async deleteAppVersion(number: AppVersion): Promise<void> {
    await request<void>(`/api/app-versions/${encodeURIComponent(number)}`, { method: "DELETE" });
  },

  // 운영자 전용: "버전 안내 설정" — 버전 안내(업데이트 안내 모달)를 띄울지 전역 토글.
  async setVersionNoticeEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    return request<{ enabled: boolean }>("/api/app-versions/notice-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  },

  // 운영자 전용: "버전 안내 설정" — 특정 버전의 안내 내용(한 줄에 한 항목) 편집.
  async setVersionNotes(number: AppVersion, notes: string): Promise<AppVersionInfo> {
    return request<AppVersionInfo>(`/api/app-versions/${encodeURIComponent(number)}/notes`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
    });
  },

  // 숨겨진 제어판 잠금 비밀번호 확인 — 맞는지 여부만 돌려받는다(값 자체는 응답에 없음).
  async verifyAdminPanelPassword(password: string): Promise<boolean> {
    const res = await request<{ ok: boolean }>("/api/env-vars/admin-panel/verify", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    return res.ok;
  },

  // "너 나와!" 도전장 게시판 — 경기결과/예약 시스템과는 독립적이다.
  async getChallenges(): Promise<{ items: Challenge[] }> {
    return request<{ items: Challenge[] }>("/api/challenges");
  },

  // 다음 접속 때 팝업으로 보여줄, 아직 안 본 도전장 — 조회하는 즉시 서버가 "봤다"로 표시한다.
  async getPendingChallengesForMe(): Promise<{ items: Challenge[] }> {
    return request<{ items: Challenge[] }>("/api/challenges/pending-for-me");
  },

  // 위의 "결과 입력" 버전 — 내가 참가한 확정 대결 중 예정 일시가 지났는데 아직 결과가
  // 안 들어온 것을, 아직 팝업으로 안 본 것만 내려준다. 조회하는 즉시 서버가 "봤다"
  // (result_notified)로 표시하므로 참가자별로 딱 한 번만 온다.
  async getResultPendingChallengesForMe(): Promise<{ items: Challenge[] }> {
    return request<{ items: Challenge[] }>("/api/challenges/result-pending-for-me");
  },

  async createChallenge(payload: ChallengeCreatePayload): Promise<Challenge> {
    return request<Challenge>("/api/challenges", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // 지목된 쪽의 응답 — 거절할 때만 reason(선택)이 의미가 있다. scheduledAt은 요청자가
  // "시간 지정"을 끄고 보낸(시간 미정) 도전장을 승락할 때만 의미가 있다 — 그 경우
  // 서버가 필수로 요구한다(안 보내면 400). 이미 시간이 정해진 도전장에는 무시된다.
  async respondToChallenge(
    id: number, response: "accepted" | "rejected" | "discarded", reason?: string, scheduledAt?: string,
  ): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ response, reason, scheduledAt }),
    });
  },

  // 확정된 대결의 결과(이긴 쪽)를 입력 — 참가자 누구든 먼저 입력하는 쪽이 인정되고,
  // 예정 일시가 지난 뒤에만 가능하다. 이미 결과가 입력된 대결에는 다시 입력할 수 없다.
  async enterChallengeResult(id: number, winnerSide: ChallengeResult): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/result`, {
      method: "POST",
      body: JSON.stringify({ winnerSide }),
    });
  },

  // 완료된 대결에서 패배한 쪽이 같은 대진으로 재대결(설욕전)을 신청 — 패배한 편이 새
  // 도전장의 요청자, 승리한 편이 새 지목 대상이 된다(체인으로 이어진다).
  async requestRevenge(id: number, payload: ChallengeRevengePayload = {}): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/revenge`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // ===== 대결 요청 코너 =====
  async getMatchRequests(page = 0): Promise<MatchRequestListResponse> {
    return request<MatchRequestListResponse>(`/api/match-requests?page=${page}`);
  },
  async createMatchRequest(payload: MatchRequestCreatePayload): Promise<MatchRequest> {
    return request<MatchRequest>("/api/match-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  // 추천 토글(누르면 추천, 다시 누르면 취소) — 갱신된 요청을 돌려준다.
  async toggleMatchRequestRecommend(id: number): Promise<MatchRequest> {
    return request<MatchRequest>(`/api/match-requests/${id}/recommend`, { method: "POST" });
  },
  // 대결이 성사되면 작성자 본인/운영자가 "성사됨"으로 완료 처리한다(목록에서 사라짐).
  async completeMatchRequest(id: number): Promise<void> {
    await request<{ ok: boolean }>(`/api/match-requests/${id}`, { method: "DELETE" });
  },
  // 내가 언급된 안 읽은 요청 알림(앱 열 때 인박스 팝업용).
  async getMatchRequestInbox(): Promise<{ items: MatchRequestInboxItem[] }> {
    return request<{ items: MatchRequestInboxItem[] }>("/api/match-requests/inbox");
  },
  // 인박스 팝업을 닫으면 내 안 읽은 알림을 모두 읽음 처리한다.
  async markMatchRequestInboxRead(): Promise<void> {
    await request<{ ok: boolean }>("/api/match-requests/inbox/read", { method: "POST" });
  },
};
