// ============================================================
// API 클라이언트 — stargayte-api 서버와 통신한다.
// ============================================================
import type { BuildMix } from "../utils/replayBuildMix";
import type {
  Member, GameResult, ActivityComment, ActivityTargetType, RankingShift, ActivityNotice, ActivityFeedItem, ActivityFeedPage, NewGameResult, SignupPayload, MemberCreatePayload, MemberStatus, MemberRole,
  ScreenKey, AppVersion, AppVersionStatus, AppVersionInfo,
  MapCatalog, MinimapImage,
  GameResultSlot, GameResultPage, GameResultStatsResponse, GameType, Race, TeamRankingResponse,
  RatingHistoryResponse, RivalryPair,
  ReplayNameClassificationEntry, ReplayNameKind, ReplayNameMappingEntry, ReplayNameMappingKind,
  Challenge, ChallengeCreatePayload, ChallengeResult,
  League, LeagueListItem, LeagueCreatePayload, LeagueUpdatePayload, LeagueTeam,
  LeagueMatchSide,
  Schedule, ScheduleWrite,
} from "../types";
import type { ReplaySummaryData } from "../utils/replaySummaryData";
import type { ReplayMapGrid } from "../utils/replayParser";

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
type WireSlot = Omit<GameResultSlot, "rawName"> & { playerName?: string | null };
type WireGameResult = Omit<GameResult, "team1" | "team2"> & { team1: WireSlot[]; team2: WireSlot[] };
type WireActivityFeedPage = Omit<ActivityFeedPage, "items"> & {
  items: (Omit<ActivityFeedItem, "gameResults"> & { gameResults: WireGameResult[] })[];
};

function slotToWire(slot: GameResultSlot): WireSlot {
  const { rawName, ...rest } = slot;
  return { ...rest, playerName: rawName ?? null };
}
function gameResultToWire(gameResult: NewGameResult): Omit<NewGameResult, "team1" | "team2"> & { team1: WireSlot[]; team2: WireSlot[] } {
  return { ...gameResult, team1: gameResult.team1.map(slotToWire), team2: gameResult.team2.map(slotToWire) };
}
function slotFromWire(slot: WireSlot): GameResultSlot {
  const { playerName, ...rest } = slot;
  return { ...rest, rawName: playerName || null };
}
function gameResultFromWire(gameResult: WireGameResult): GameResult {
  return {
    ...gameResult,
    team1: (gameResult.team1 ?? []).map(slotFromWire),
    team2: (gameResult.team2 ?? []).map(slotFromWire),
  };
}

export interface GameResultListParams {
  cursor?: string;
  limit?: number;
  sort?: "latest" | "oldest";
  dateFrom?: string;
  dateTo?: string;
  matchType?: GameType | "all";
  userQuery?: string;
  matchAllUsers?: boolean;
  // 운영자 "유저연결" 화면 전용 — 컴퓨터/비회원 참가자가 있는 경기만 골라본다.
  hasPlaceholder?: boolean;
  // 팀 랭킹에서 팀 하나를 눌렀을 때 — 이 회원들이 전부 "같은 편"으로 뛴 경기만 추린다.
  // userQuery+matchAllUsers("전원이 참가한 경기")와 달리 서로 상대편이었던 경기는 빠진다.
  teamMemberIds?: string[];
}

export interface GameResultStatsParams {
  memberIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  matchType?: GameType | "all";
  /* "main"은 종족이 아니라 "각자의 주종족"이다 — 집계(전적·APM·생산)는 전 종족으로 내려오고,
     포인트·순위만 사람마다 제 주종족 기준으로 다시 매겨진다(요청). 목록 조회 전용이라
     상세(레이팅 이력)는 여전히 종족 하나를 받는다. */
  race?: Race | "all" | "main";
}

export interface TeamRankingParams {
  dateFrom?: string;
  dateTo?: string;
}

export interface MainRaceParams {
  memberId: string;
  dateFrom?: string;
  dateTo?: string;
  matchType?: GameType | "all";
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

// 이 화면이 운영 빌드인지 개발 서버인지 — 모든 요청에 X-Client-Env로 실어 보낸다.
// 접속 기록을 남길지 말지를 백엔드가 이 값으로 판단한다(요청: "운영이라고 한 건 백엔드가
// 아니라 프론트"). 백엔드의 ENVIRONMENT로 걸면 정작 막아야 할 경우 — 로컬 프론트가 운영
// 백엔드를 바라보고 개발하는 경우 — 를 못 막고, 반대로 로컬 백엔드에서만 막힌다.
// import.meta.env.PROD는 vite build면 true, vite dev 서버면 false다.
const CLIENT_ENV = import.meta.env.PROD ? "production" : "development";

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
  headers.set("X-Client-Env", CLIENT_ENV);
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

export const api = {
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

  async getGameResultsPage(params: GameResultListParams = {}): Promise<GameResultPage> {
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
    const page = await request<Omit<GameResultPage, "items"> & { items: WireGameResult[] }>(`/api/game-results${qs}`);
    return { ...page, items: page.items.map(gameResultFromWire) };
  },

  // 같은 조건의 경기 전체 건수만 필요할 때 — 목록 엔드포인트가 첫 페이지 응답에 total을
  // 담아 주므로(GameResultPage.total) 한 건만 달라고 해서 그 값만 읽는다. 세는 전용 엔드포인트를
  // 따로 파지 않은 이유는 조건 해석이 목록과 한 글자도 어긋나면 안 되기 때문이다.
  async countGameResults(params: GameResultListParams = {}): Promise<number> {
    const page = await this.getGameResultsPage({ ...params, cursor: undefined, limit: 1 });
    return page.total ?? page.items.length;
  },

  // 카카오톡 공유 링크가 여는 "이 경기만 보이는" 화면용 단건 조회.
  async getGameResult(id: number): Promise<GameResult> {
    return gameResultFromWire(await request<WireGameResult>(`/api/game-results/${id}`));
  },

  // 전적통계 화면 전용 — 회원별로 이미 집계된 전적을 받는다.
  async getGameResultStats(params: GameResultStatsParams = {}): Promise<GameResultStatsResponse> {
    const qs = buildQuery({
      memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      matchType: params.matchType,
      race: params.race,
    });
    return request<GameResultStatsResponse>(`/api/game-results/stats${qs}`);
  },

  // 유저 상성(상대전적 쌍) — 상성 맵 화면이 쓴다. mode: solo(기본)=1:1만,
  // team=팀전을 개인 단위 쌍으로 환산(상성맵 팀전 탭).
  async getRivalries(params: { dateFrom?: string; dateTo?: string; mode?: "solo" | "team" } = {}): Promise<{ pairs: RivalryPair[] }> {
    const qs = buildQuery({ dateFrom: params.dateFrom, dateTo: params.dateTo, mode: params.mode });
    return request<{ pairs: RivalryPair[] }>(`/api/game-results/stats/rivalries${qs}`);
  },

  // 랭킹 조회 전용 엔드포인트 — 응답 구조는 전적통계와 같지만(순위/레이팅 + 전적) URL을
  // 의미(랭킹)에 맞춰 분리했다(요청). 종족 필터는 '랭커의 종족' 기준이라 서버가 (회원,종족)
  // 레이팅으로 순위를 매긴다.
  async getRanking(params: GameResultStatsParams = {}): Promise<GameResultStatsResponse> {
    const qs = buildQuery({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      matchType: params.matchType,
      race: params.race,
    });
    return request<GameResultStatsResponse>(`/api/game-results/ranking${qs}`);
  },

  // 랭킹 상세의 '경기당 레이팅 변화(Δ)' — 이 회원이 뛴 경기의 matchNo → μ 증감. 레이팅은
  // 클라이언트가 재구성할 수 없어 서버가 계산해 준다. 목록이 조회 기간만으로 리셋해 매겨지므로
  // (요청: "해당 월이나 년도만의 리셋된 데이터로 조회"), 여기도 같은 dateFrom/dateTo를 넘겨야
  // 목록의 μ/σ와 이 상세의 Δ 합이 어긋나지 않는다. 종족 필터 시 그 종족 Δ만 온다.
  async getRatingHistory(
    memberId: string, matchType?: string, dateFrom?: string, dateTo?: string, race?: string,
  ): Promise<RatingHistoryResponse> {
    const qs = buildQuery({ memberId, matchType, dateFrom, dateTo, race });
    return request<RatingHistoryResponse>(`/api/game-results/rating-history${qs}`);
  },

  // 팀랭킹 — dateFrom/dateTo를 안 넘기면 전체 경기, 넘기면(랭킹 화면의 월 기준 기본
  // 집계) 그 기간만 서버가 집계하고 정렬까지 끝내서 내려준다.
  async getTeamRanking(params: TeamRankingParams = {}): Promise<TeamRankingResponse> {
    const qs = buildQuery({ dateFrom: params.dateFrom, dateTo: params.dateTo });
    return request<TeamRankingResponse>(`/api/game-results/team-ranking${qs}`);
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
    const res = await request<{ race: Race | null }>(`/api/game-results/main-race${qs}`);
    return res.race;
  },

  // 랭킹 화면의 "이전" 버튼 비활성화 판단용 — 실제 결과가 있는 가장 이른 경기 날짜.
  async getEarliestGameResultDate(): Promise<string | null> {
    const res = await request<{ date: string | null }>("/api/game-results/earliest-date");
    return res.date;
  },

  // 리플레이 업로드 시 이미 등록된 경기(gameStartedAt 기준)인지 서버에 물어본다 —
  // 입력한 값 중 이미 존재하는 것만(원본 문자열 그대로) 돌아온다.
  async checkReplayDuplicates(gameStartedAt: string[]): Promise<string[]> {
    if (gameStartedAt.length === 0) return [];
    const res = await request<{ existing: string[] }>("/api/game-results/duplicate-check", {
      method: "POST",
      body: JSON.stringify({ gameStartedAt }),
    });
    return res.existing;
  },

  // 이미 등록된 경기(gameStartedAt 일치)에 리플레이 내부 정보만 다시 덮어쓴다 — 중복
  // 리플레이를 다시 배치 등록할 때 새 지표(생산 등)를 백필하는 용도. result=null이면 승패는
  // 그대로 두고(리플레이가 승자를 못 가림), 지표/맵/시간은 항상 갱신한다. 일치하는 경기가
  // 없으면 merged=false로 조용히 돌아온다.
  async mergeReplay(payload: {
    gameStartedAt: string;
    result: "team1" | "team2" | "draw" | null;
    mapName: string | null;
    durationSeconds: number | null;
    summaryData: ReplaySummaryData | null;
    mapData: ReplayMapGrid | null;
    players: {
      playerName: string;
      race: string | null;
      apm: number | null;
      eapm: number | null;
      cmdCount: number | null;
      effectiveCmdCount: number | null;
      buildCount: number | null;
      buildMix: BuildMix | null;
    }[];
  }): Promise<{ merged: boolean; matchNo: string | null }> {
    return request<{ merged: boolean; matchNo: string | null }>("/api/game-results/merge-replay", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // 배틀태그로 못 찾은 리플레이 참가자 이름 중, 예전에 컴퓨터/비회원으로 지정해둔 적이
  // 있는 이름만 그 분류와 함께 돌아온다(없으면 그 이름은 응답에서 빠짐 — 그대로 미매칭으로
  // 남아 사용자가 지정해야 함).
  async lookupReplayNameClassifications(rawNames: string[]): Promise<ReplayNameClassificationEntry[]> {
    if (rawNames.length === 0) return [];
    const res = await request<{ classifications: ReplayNameClassificationEntry[] }>(
      "/api/game-results/replay-name-classifications/lookup",
      { method: "POST", body: JSON.stringify({ rawNames }) },
    );
    return res.classifications;
  },

  // 사용자가 미매칭 선수를 컴퓨터/비회원으로 직접 지정하면, 다음에 같은 이름이 또
  // 나왔을 때 자동으로 같은 분류를 적용할 수 있도록 서버에 기억시킨다.
  async setReplayNameClassification(rawName: string, kind: ReplayNameKind): Promise<ReplayNameClassificationEntry> {
    return request<ReplayNameClassificationEntry>("/api/game-results/replay-name-classifications", {
      method: "POST",
      body: JSON.stringify({ rawName, kind }),
    });
  },

  // 유저연결 화면 — 리플레이 원본 이름(rawName) 전체 목록(회원 별칭/컴퓨터·비회원
  // 분류/아직 미해결 셋을 합친 것)과, 하나를 다시 지정하는 저장.
  async listReplayNameMappings(): Promise<ReplayNameMappingEntry[]> {
    const res = await request<{ entries: ReplayNameMappingEntry[] }>("/api/game-results/replay-name-mappings");
    return res.entries;
  },

  async setReplayNameMapping(
    rawName: string, kind: ReplayNameMappingKind, memberId?: string,
  ): Promise<ReplayNameMappingEntry> {
    return request<ReplayNameMappingEntry>("/api/game-results/replay-name-mappings", {
      method: "POST",
      body: JSON.stringify({ rawName, kind, memberId }),
    });
  },

  // "미지정으로 되돌리기"(setReplayNameMapping의 kind="unresolved")와 달리, 매핑
  // 데이터(replay_aliases 행) 자체를 지워 목록에서 완전히 사라지게 한다 — 이 raw_name으로
  // 등록된 경기가 하나라도 있으면 서버가 막는다(그럼 미지정으로 다시 나타나야 정상이라).
  async deleteReplayNameMapping(rawName: string): Promise<void> {
    await request<void>(`/api/game-results/replay-name-mappings/${encodeURIComponent(rawName)}`, { method: "DELETE" });
  },

  // 미니맵 격자 — 경기 응답에는 해시만 있고 격자는 이걸로 따로 받는다(같은 맵을 쓰는 경기가
  // 수십 건이라 목록에 끼워 보내면 22KB짜리가 되풀이된다). 서버가 모르는 해시는 그냥 빠진
  // 채로 돌아온다 — 오류가 아니라 그 경기만 미니맵 없이 그려진다.
  async getReplayMaps(hashes: string[]): Promise<ReplayMapGrid[]> {
    if (hashes.length === 0) return [];
    const qs = hashes.map((h) => `hash=${encodeURIComponent(h)}`).join("&");
    const res = await request<{ maps: ReplayMapGrid[] }>(`/api/game-results/replay-maps?${qs}`);
    return res.maps;
  },

  // 여기서부터: 미니맵 그림 관리(운영자) — 타일 번호만으로는 물·풀·땅·벽을 갈라낼 수 없어
  // (네 번 시도해 다 실패) 맵마다 실제 미니맵 그림을 사람이 올려 둔다(요청). 이름·판본만
  // 다른 거의 같은 맵들은 한 그림을 함께 가리킨다(요청: 한데 묶기).
  async getMapCatalog(): Promise<MapCatalog> {
    return request<MapCatalog>("/api/game-results/replay-maps/catalog");
  },

  async createMinimapImage(body: { name: string; image: string; hashes: string[] }): Promise<MinimapImage> {
    return request<MinimapImage>("/api/game-results/replay-maps/images", {
      method: "POST", body: JSON.stringify(body),
    });
  },

  /** 이름만 고칠 때는 image를 빼고 부른다 — 수백 KB짜리를 다시 올릴 이유가 없다. */
  async updateMinimapImage(
    id: number, body: { name: string; image?: string; hashes?: string[] },
  ): Promise<MinimapImage> {
    return request<MinimapImage>(`/api/game-results/replay-maps/images/${id}`, {
      method: "PUT", body: JSON.stringify(body),
    });
  },

  async deleteMinimapImage(id: number): Promise<void> {
    await request<void>(`/api/game-results/replay-maps/images/${id}`, { method: "DELETE" });
  },

  /** 맵 여러 개를 한 그림에 묶거나(imageId) 떼어 낸다(null). */
  async assignMinimapImage(imageId: number | null, hashes: string[]): Promise<number> {
    const res = await request<{ changed: number }>("/api/game-results/replay-maps/assign", {
      method: "POST", body: JSON.stringify({ imageId, hashes }),
    });
    return res.changed;
  },

  async createGameResult(gameResult: NewGameResult): Promise<GameResult> {
    const res = await request<WireGameResult>("/api/game-results", {
      method: "POST",
      body: JSON.stringify(gameResultToWire(gameResult)),
    });
    return gameResultFromWire(res);
  },


  async deleteGameResult(id: number): Promise<void> {
    await request<void>(`/api/game-results/${id}`, { method: "DELETE" });
  },

  // 모든 경기기록 삭제(운영자 제어판) — 첨부 파일까지 서버에서 함께 지운다. 삭제 건수 반환.
  async deleteAllGameResults(): Promise<{ deleted: number }> {
    return request<{ deleted: number }>("/api/game-results/all", { method: "DELETE" });
  },

  // 지금 바로 하루치 랭킹 집계를 돌린다(운영자) — 스케줄러가 아침에 하는 것과 같은 일이다.
  // 순위표가 그대로면 아무 카드도 안 남는 게 정상이라, 남았는지(changed)를 함께 돌려준다.
  async recomputeRankingShifts(): Promise<{ changed: boolean }> {
    return request<{ changed: boolean }>("/api/activities/ranking-shifts/recompute", { method: "POST" });
  },

  // 순위 기준선 다시 깔기(운영자) — 지금 데이터로 개인전/팀전 스냅샷을 새로 만든다.
  // 변동 없이 저장돼 활동 목록에는 안 뜨고, 다음 아침 재집계가 이걸 기준으로 비교한다.
  async reseedRankingShifts(): Promise<Record<string, number>> {
    return request<Record<string, number>>("/api/activities/ranking-shifts/seed", { method: "POST" });
  },

  // 경기 댓글(메모) — 게시판 댓글처럼 회원 누구나 한 줄(최대 50자)을 남기고 본인/운영자만
  // 수정·삭제한다. 본문에 @닉네임 언급 가능(targetMemberIds). 목록/상세 응답에 이미 comments가
  // 실려 오므로 별도 조회는 잘 안 쓰지만, 필요 시 이 경기 댓글만 다시 받아올 수도 있다.
  // 랭크 변동 이벤트 — 서버가 경기 등록/삭제 때마다 계산·저장한 스냅샷 중 실제 변동이
  // 있었던 것만 내려준다(활동가 재계산하지 않는다).
  async listRankingShifts(): Promise<RankingShift[]> {
    return request<RankingShift[]>("/api/activities/ranking-shifts");
  },

  /** 알림 한 건 — 카카오 공유 링크(?sv=notice&sid=…)가 여는 화면이 쓴다(요청: 알림도 공유).
   *  목록에서 골라내지 않는 이유는 알림이 시간이 갈수록 아래로 밀려나기 때문이다. */
  async getActivityNotice(id: number): Promise<ActivityNotice> {
    return request<ActivityNotice>(`/api/activities/notices/${id}`);
  },

  /** 활동 목록 — 화면이 부르는 API는 이것 하나다(요청: API 딱 하나만 호출하게).
   *
   *  너 나와·랭크 변동·게임결과가 같은 아이템으로 오고, 내용도 댓글도 그 안에 있다.
   *  예전에는 세 곳을 따로 받아 화면이 제 손으로 섞었는데, 그러면 섞는 규칙이 서버(번호를
   *  세니까)와 화면 양쪽에 있어야 하고 한쪽만 고쳐지는 순간 번호가 줄과 어긋났다. */
  /** 지금 칭호 한 벌을 서버에 알린다 — 달라진 사람이 있으면 활동에 알림 한 줄이 남는다
   *  (요청). 계산은 화면이 하고(statEpithet.ts) 서버는 견주기만 한다. 응답은 바뀐 사람 수.
   *  실패해도 화면은 그대로다 — 부르는 쪽이 조용히 넘긴다. */
  /** 저장된 칭호 한 벌을 읽는다 — 통계 화면이 쓰는 값이다(요청: 화면 진입 때 다시 계산하지
   *  않는다). 계산은 경기 등록 때 한 번 돌고 그 결과가 서버에 남아 있다. */
  async getEpithets(): Promise<{ memberId: string; label: string; why: string }[]> {
    const res = await request<{ epithets: { memberId: string; label: string; why: string }[] }>(
      "/api/activities/epithets",
    );
    return res.epithets ?? [];
  },

  async reportEpithets(epithets: { memberId: string; label: string; why: string }[]): Promise<number> {
    const res = await request<{ changed: number }>("/api/activities/epithets", {
      method: "PUT",
      body: JSON.stringify({ epithets }),
    });
    return res.changed;
  },

  async listActivityFeed(params: { cursor?: string; limit?: number } = {}): Promise<ActivityFeedPage> {
    const q = new URLSearchParams();
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    const page = await request<WireActivityFeedPage>(`/api/activities${qs ? `?${qs}` : ""}`);
    /* 이 목록 안의 경기도 다른 경기 조회와 똑같이 계약↔도메인 이름을 옮겨 준다(위
       gameResultFromWire) — 목록을 하나로 합치면서 이걸 빠뜨렸더니, 슬롯의 rawName이
       통째로 undefined가 되어 리플레이 이야기(미니맵의 아바타·이름표·화살표)가 자막만
       남기고 전부 사라졌다(지적: "자막 말고 나머지 요소가 아무것도 안 나옴"). 요약은
       원본 게임 아이디로 저장돼 있어서 그 이름이 없으면 사람과 좌표를 못 잇는다. */
    return {
      ...page,
      items: page.items.map((it) => ({
        ...it,
        gameResults: (it.gameResults ?? []).map(gameResultFromWire),
      })),
    };
  },

  /* 모임 일정(요청: "일정 등록") — 등록·수정이 같은 모양이라 폼도 API도 하나다.
     목록은 활동 화면이 따로 안 부른다(활동 목록에 실려 온다) — 나중에 달력 같은 화면이
     생기면 그때 쓸 자리다. */
  async listSchedules(): Promise<Schedule[]> {
    const res = await request<{ items: Schedule[] }>("/api/schedules");
    return res.items;
  },
  async createSchedule(payload: ScheduleWrite): Promise<Schedule> {
    return request<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateSchedule(id: number, payload: ScheduleWrite): Promise<Schedule> {
    return request<Schedule>(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  /** 참가표시 — null이면 표시 자체를 거둔다(다시 '아직 답 안 함'). */
  async attendSchedule(id: number, response: "going" | "notGoing" | null): Promise<Schedule> {
    return request<Schedule>(`/api/schedules/${id}/attend`, {
      method: "POST", body: JSON.stringify({ response }),
    });
  },
  async deleteSchedule(id: number): Promise<void> {
    await request<void>(`/api/schedules/${id}`, { method: "DELETE" });
  },

  // 활동 댓글 — 경기/너 나와! 등 어떤 활동 요소에나 같은 API로 단다.
  // 너 나와! 완전 삭제 — 운영자 전용.
  async deleteChallenge(id: number): Promise<void> {
    await request<void>(`/api/challenges/${id}`, { method: "DELETE" });
  },

  /** 너 나와! 취소 — 부른 사람(또는 운영자)이 성사 전에 거둬들인다(요청). 삭제와 달리
   *  기록은 남고 폐기로만 넘어가며, 누가 취소했는지가 함께 저장된다. */
  async cancelChallenge(id: number): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/cancel`, { method: "POST" });
  },

  async listActivityComments(targetType: ActivityTargetType, targetId: number): Promise<ActivityComment[]> {
    return request<ActivityComment[]>(`/api/activities/comments?targetType=${targetType}&targetId=${targetId}`);
  },
  async createActivityComment(
    targetType: ActivityTargetType, targetId: number, text: string, targetMemberIds: string[],
  ): Promise<ActivityComment> {
    return request<ActivityComment>("/api/activities/comments", {
      method: "POST",
      body: JSON.stringify({ targetType, targetId, text, targetMemberIds }),
    });
  },
  async updateActivityComment(
    commentId: number, text: string, targetMemberIds: string[],
  ): Promise<ActivityComment> {
    return request<ActivityComment>(`/api/activities/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ text, targetMemberIds }),
    });
  },
  async deleteActivityComment(commentId: number): Promise<void> {
    await request<void>(`/api/activities/comments/${commentId}`, { method: "DELETE" });
  },


  // 인증 헤더가 필요해 <a href> 로 바로 못 받으므로 blob 으로 받아 저장한다.
  async downloadReplay(gameResultId: number): Promise<Blob> {
    const headers = new Headers();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const res = await fetch(`${API_BASE}/api/game-results/${gameResultId}/replay`, { headers });
    if (!res.ok) throw new Error("리플레이를 다운로드하지 못했어요.");
    return res.blob();
  },

  /** 이미 등록된 경기를 리플레이로 다시 분석해 그 결과를 써 넣는다(운영자 전용, 제어판의
   *  '경기 재분석'). 리플레이를 읽는 파서가 화면 쪽에만 있어서, 화면이 내려받아 다시
   *  분석한 결과를 올린다.
   *
   *  올리는 것은 '리플레이가 말해 주는 값'뿐이다(요청: 요약뿐 아니라 다른 모든 데이터를
   *  재분석하되 절대 바뀌면 안 되는 것은 그대로) — 요약·지형 격자에 더해 맵 이름·실제
   *  시작 시각·경기 길이, 그리고 사람별 지표(종족·APM·EAPM·커맨드·생산·생산 구성)다.
   *  사람이 정한 것은 아예 안 보낸다: 등록자·등록 시각·경기번호·날짜·분류·승패·회원
   *  연결·첨부 리플레이. 슬롯의 짝은 회원 pk가 아니라 원본 게임 아이디(rawName)로 맞춰야
   *  한다 — 회원 연결은 사람이 고쳤을 수 있고, rawName은 그 경기 시점의 유일한 증거다. */
  async reanalyzeGameResult(
    gameResultId: number,
    body: {
      summaryData: ReplaySummaryData | null;
      mapData?: ReplayMapGrid | null;
      mapName?: string | null;
      gameStartedAt?: string | null;
      durationSeconds?: number | null;
      slots?: {
        rawName: string;
        race: string;
        apm: number | null;
        eapm: number | null;
        cmdCount: number | null;
        effectiveCmdCount: number | null;
        buildCount: number | null;
        buildMix: unknown;
      }[];
    },
  ): Promise<void> {
    await request<void>(`/api/game-results/${gameResultId}/summary`, {
      method: "POST", body: JSON.stringify(body),
    });
  },

  // 등록된 리플레이(.rep) 전체를 날짜별 폴더 zip으로 받는다(운영자 전용, 관리자 제어판).
  async downloadReplayArchive(): Promise<Blob> {
    const headers = new Headers();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const res = await fetch(`${API_BASE}/api/game-results/replays/archive`, { headers });
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

  /* 화면을 전환할 때마다 호출 — 접속 기록에 "언제 어떤 화면을 봤는지" 남긴다.
     실패해도 화면 전환 자체를 막을 이유는 없으므로 호출부에서 실패를 무시한다.

     detail은 그 화면 안에서 정확히 무엇을 봤는지다 — 지금은 공유 링크로 열린 카드
     ("gameResult#12" 꼴)를 적는 데만 쓴다(요청: "접속로그에 공유페이지 열어본거도
     표시(어떤 페이지인지도)"). 공유는 화면 코드가 다 같은 "share"라, 이게 없으면
     무엇을 열어 봤는지가 통째로 안 남는다. */
  async pingAccess(screen: ScreenKey | "share", detail?: string): Promise<void> {
    await request<void>("/api/auth/access-ping", {
      method: "POST",
      body: JSON.stringify({ screen, detail: detail ?? null }),
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

  // 위의 "결과 입력" 버전 — 내가 참가한 확정 너 나와 중 예정 일시가 지났는데 아직 결과가
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

  // 지목된 쪽의 응답 — 수락/거절/버림. 날짜/"언제"는 요청자가 그걸 안 정하고 보낸 도전장을
  // 승락할 때만 의미가 있다(둘 다 선택) — 이미 정해진 값은 서버가 무시한다.
  async respondToChallenge(
    id: number, response: "accepted" | "rejected",
    schedule?: { scheduledDate?: string | null; scheduledTimeNote?: string }, message?: string,
  ): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ response, ...schedule, message }),
    });
  },

  // 성사(진행중)된 너 나와의 예정 일정을 바꾼다 — 참가자 또는 운영자만(요청: "너나와
  // 목록에서 진행중인건은 날짜와 시간 수정이 가능하게"). 날짜/"언제" 모두 선택(미정 가능).
  async rescheduleChallenge(
    id: number, scheduledDate: string | null, scheduledTimeNote: string,
  ): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({ scheduledDate, scheduledTimeNote }),
    });
  },

  // 확정된 너 나와의 결과(이긴 쪽)를 입력 — 참가자 누구든 먼저 입력하는 쪽이 인정된다.
  // 결과 입력 시엔 실제 대결 날짜를 무조건 함께 넣는다(요청. 시각은 다루지 않는다).
  // 이미 결과가 입력된 너 나와에는 다시 입력할 수 없다.
  async enterChallengeResult(
    id: number, winnerSide: ChallengeResult, scheduledDate: string,
  ): Promise<Challenge> {
    return request<Challenge>(`/api/challenges/${id}/result`, {
      method: "POST",
      body: JSON.stringify({ winnerSide, scheduledDate }),
    });
  },

  // 리그(League/Tournament) — 운영자 전용, 조회(GET) 포함 전부 CurrentAdmin 게이트.
  async getLeagues(): Promise<LeagueListItem[]> {
    const res = await request<{ items: LeagueListItem[] }>("/api/leagues");
    return res.items;
  },
  async getLeague(id: number): Promise<League> {
    return request<League>(`/api/leagues/${id}`);
  },
  async createLeague(payload: LeagueCreatePayload): Promise<League> {
    return request<League>("/api/leagues", { method: "POST", body: JSON.stringify(payload) });
  },
  async updateLeague(id: number, payload: LeagueUpdatePayload): Promise<League> {
    return request<League>(`/api/leagues/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteLeague(id: number): Promise<void> {
    await request<void>(`/api/leagues/${id}`, { method: "DELETE" });
  },
  async addLeagueTeam(leagueId: number): Promise<LeagueTeam> {
    return request<LeagueTeam>(`/api/leagues/${leagueId}/teams`, { method: "POST" });
  },
  async deleteLeagueTeam(leagueId: number, teamId: number): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/teams/${teamId}`, { method: "DELETE" });
  },
  async setLeagueTeamRoster(leagueId: number, teamId: number, memberIds: string[]): Promise<LeagueTeam> {
    return request<LeagueTeam>(`/api/leagues/${leagueId}/teams/${teamId}/roster`, {
      method: "PUT", body: JSON.stringify({ memberIds }),
    });
  },
  // 팀/선수 구성 전체를 한 번에 저장한다(요청: "팀구성 따로 배치 저장"). teams는 원하는
  // 전체 구성(순서=라벨 순서). id가 있으면 기존 팀, null이면 새 팀. 서버가 원자적으로
  // (생성/삭제/로스터/라벨 재정렬) 반영하고 리그 전체를 돌려준다.
  async setLeagueTeamComposition(
    leagueId: number, teams: { id: number | null; roster: string[] }[],
  ): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/teams`, {
      method: "PUT", body: JSON.stringify({ teams }),
    });
  },
  /* 대진표의 모양과 배정을 한 번에 저장한다(요청: "바로바로 저장이 아닌 마지막 저장 버튼
     누를때 저장"). paths는 '지금 있는 경기 전부'를 뿌리(결승=빈 문자열)에서의 길로 적은
     목록이고, assignments는 그 자리들의 최종 배정이다. 길로 가리키는 이유는 화면에서 방금
     친 가지에는 아직 id가 없어서다 — id로 주고받으려면 조작마다 서버를 다녀와야 했다.
     빈 목록을 보내면 대진표를 통째로 지운다. 판의 모양(라운드 번호까지)이 바뀌므로 응답은
     리그 전체다. */
  async setLeagueBracket(
    leagueId: number,
    paths: string[],
    assignments: { path: string; side: LeagueMatchSide; teamId: number | null }[],
  ): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/bracket`, {
      method: "PUT", body: JSON.stringify({ paths, assignments }),
    });
  },
  async confirmLeagueBracket(leagueId: number): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/bracket/confirm`, { method: "POST" });
  },
  // 1라운드 시드 전체를 한 번에 저장한다(요청: "대진표 수정 시 그때그때 저장해서 느림 —
  // 화면만 수정하고 저장 버튼 누르면 그때 한 번에 저장"). assignments는 편집 가능한 1라운드
  // 슬롯 전체의 최종 배정(미지정은 teamId=null). 서버가 원자적으로(비우고→다시 배정→부전승
  // 자동처리) 반영하고 리그 전체를 돌려준다.
  async setLeagueBracketSeeding(
    leagueId: number, assignments: { matchId: number; side: LeagueMatchSide; teamId: number | null }[],
  ): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/bracket/seeding`, {
      method: "PUT", body: JSON.stringify({ assignments }),
    });
  },
  // 경기 일시(요청: "리그에 일시 추가") — null이면 지운다. 대진 확정 전에도 적을 수 있다.
  async setLeagueMatchSchedule(leagueId: number, matchId: number, scheduledAt: string | null): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/matches/${matchId}/schedule`, {
      method: "PUT", body: JSON.stringify({ scheduledAt }),
    });
  },
  /* 세트 스코어(요청: "결과는 몇 대 몇 입력") — 이긴 쪽은 스코어가 말해 주므로 따로 고르지
     않는다. 둘 다 null이면 결과를 지운다. 승자가 다음 라운드로 올라가(거나 내려와) 판
     전체가 바뀌므로 응답은 리그 전체다. */
  async setLeagueMatchResult(
    leagueId: number, matchId: number, setsWonA: number | null, setsWonB: number | null,
  ): Promise<League> {
    return request<League>(`/api/leagues/${leagueId}/matches/${matchId}/result`, {
      method: "PUT", body: JSON.stringify({ setsWonA, setsWonB }),
    });
  },
};
