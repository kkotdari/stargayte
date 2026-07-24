// ===== 도메인 공용 타입 =====

// 기본 종족 (통계 집계 기준)
export type BaseRace = "테란" | "프로토스" | "저그";

// 경기결과 시 선택 가능한 종족 (랜덤은 어떤 종족이 나왔는지 구분하지 않고 통일)
export type Race = "테란" | "프로토스" | "저그" | "랜덤";

// 경기 결과. not_held = 미실시(승패 없음, 통계 집계 제외)
export type MatchResult = "team1" | "team2" | "draw" | "not_held";

// 경기유형 코드 (0101=일대일, 0102=팀전) — team1/team2 인원수와 별개로
// 어떤 성격의 경기인지 분류하기 위한 값
export type MatchType = "0101" | "0102";

// 회원 이용 상태 — 가입 시 pending, 운영자가 승인하면 active, 정지시키면 suspended
export type MemberStatus = "pending" | "active" | "suspended" | "withdrawn";

// 회원 권한 — 0202=운영자, 0203=회원.
export type MemberRole = "0202" | "0203";

// 운영자가 교체 가능한 이미지 슬롯 — 이제 종족 아이콘만 남는다(홈 로고 슬롯은 정적
// 자산 + 회전 별(BrandLogo)로 대체되며 완전히 제거됐다).
export type IconSlot = Race;
export interface ImageSetting {
  type: "text" | "image";
  value: string;
}
export type ImageSettingMap = Record<IconSlot, ImageSetting>;

// 회원
export interface Member {
  id: string;
  nickname: string;
  battletag: string;
  insta: string;
  avatar: string | null; // data URL 또는 이미지 URL
  // 리플레이(.rep)에 실제로 기록되는 게임 내 표시 이름들. battletag와 다를 수 있어(예전
  // Battle.net 계정명, 부계정 등) 리플레이 일괄 등록의 회원 매칭 전용으로 따로 저장한다.
  // 회원당 최대 3개, 오래된순으로 정렬돼 있다.
  replayAliases: string[];
  roles: MemberRole[];
  status: MemberStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601 — status 변경(승인/정지/탈퇴 등)도 이 값을 갱신시킨다
}

// 회원가입 요청 페이로드
export interface SignupPayload {
  id: string;
  password: string;
  nickname: string;
  battletag: string;
  replayAliases: string[];
  insta: string;
  avatar: string | null;
}

// 운영자가 회원 화면에서 회원을 바로 만들 때 쓰는 페이로드 — 가입과 달리
// replayAliases는 선택이고(운영자가 아직 실제 플레이 이름을 모를 수 있음, 0개 허용),
// 승인 절차 없이 즉시 active로 만들어진다.
export interface MemberCreatePayload {
  id: string;
  password: string;
  nickname: string;
  battletag: string;
  replayAliases?: string[];
  insta: string;
  avatar: string | null;
}

// 배틀태그로 못 찾은 리플레이 참가자 이름을 컴퓨터/비회원으로 기억해두는 분류 —
// replay_name_classifications 테이블과 1:1 대응.
export type ReplayNameKind = "computer" | "unregistered";
export interface ReplayNameClassificationEntry {
  rawName: string;
  kind: ReplayNameKind;
}

// 유저연결 화면 — 리플레이 원본 이름(rawName) 하나가 지금 회원/컴퓨터/비회원
// 중 무엇으로 연결돼 있는지(또는 아직 연결이 없는지).
export type ReplayNameMappingKind = "member" | "computer" | "unregistered" | "unresolved";
export interface ReplayNameMappingMember {
  id: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
}
export interface ReplayNameMappingEntry {
  rawName: string;
  kind: ReplayNameMappingKind;
  member: ReplayNameMappingMember | null;
  // 이 이름이 마지막으로 등장한 경기 날짜(YYYY-MM-DD) — 미해결 항목을 최근 순으로 보여주는
  // 데 쓴다. 단건 저장 응답에서는 항상 null.
  lastSeen: string | null;
  // 이 게임아이디로 등록된 경기가 하나라도 있는지 — 있으면 휴지통(완전 삭제)이 막힌다.
  // 화면에서 삭제를 못 누르게 하고 경고를 띄운다. 단건 저장 응답에서는 false.
  hasMatches: boolean;
}

// 경기 내 한 명의 참가 슬롯
export interface MatchSlot {
  memberId: string;
  race: Race | ""; // "" = 종족 미선택 (폼 작성 중). "랜덤"은 회원 주종족 개념일 뿐 저장은 안 됨
  // 리플레이에서 파싱된 원본 게임 아이디 — 회원 매칭 여부와 무관하게 리플레이로 등록된
  // 모든 슬롯에 있다(수동 등록 참가자는 없음). 회원의 battletag는 나중에 바뀔 수 있어
  // 이 값이 이 경기 시점의 유일한 증거이므로, 서버는 한 번 저장하면 다시는 지우거나
  // 바꾸지 않는다. 컴퓨터/비회원 슬롯은 "컴퓨터 N"/"비회원 N" 같은 순번 라벨 대신 이
  // 값이 있으면 그대로 표시에도 쓴다.
  rawName?: string | null;
  // 아래 5개는 리플레이 파싱으로 자동 등록된 참가자만 값이 있다 (수동 등록은 전부 null)
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
  // 커맨드 스트림에서 센 '생산' 지표(유닛 훈련+건물 건설+변태 커맨드 수). 커맨드 스트림을
  // 못 읽은 리플레이/수동 등록은 null.
  buildCount: number | null;
}

// 리플레이(.rep). 서버는 별도 replays 테이블에 풀 메타데이터로 저장하고 경기는 그 id로
// 매핑한다. originalName은 업로드된 원본 파일명, displayName은 알아보기 쉽게 생성한
// 파일명(화면 표시/다운로드에 쓴다). url 은 저장 후 실제 접근 URL.
export interface Replay {
  id: number;
  originalName: string;
  displayName: string;
  url: string;
}

// 리플레이 업로드/유지 payload — 신규 업로드 시 url은 data URL(base64), 기존 리플레이를
// 그대로 유지할 땐 서버 저장 URL(서버가 변경 없음으로 처리). id는 서버가 부여하므로 없다.
export interface ReplayUpload {
  originalName: string;
  displayName: string;
  url: string;
}

// 경기 작성자 (수정/삭제 권한 판단 및 표시용)
export interface MatchAuthor {
  id: string;
  nickname: string;
}

// 경기 댓글(메모)에 언급(@)된 회원 — 렌더 시 인라인 칩으로 표시한다.
export interface MatchNoteMention {
  memberId: string;
  nickname: string;
}

export interface MatchNoteAuthor {
  memberId: string;
  nickname: string;
  avatar: string | null;
}

// 경기 하나에 달린 댓글(메모) 한 건 — 게시판 댓글처럼 작성자와 본문(최대 50자)으로 이뤄지고
// 본인/운영자만 수정·삭제할 수 있다(canEdit). 본문에 @닉네임으로 언급 가능.
export interface MatchNote {
  id: number;
  matchId: number;
  text: string;
  author: MatchNoteAuthor;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  mentions: MatchNoteMention[];
}

// 저장된 경기
export interface Match {
  id: number;
  // 사람이 보고 지목하는 고유번호 — 등록 순서(id)가 아니라 실제 경기 시각 기준(리플레이가
  // 있으면 실제 시작 시각, 없으면 경기 날짜)이라 id와 순서가 다를 수 있다. 형식:
  // YYMMDDHHMMSS + 2자리 일련번호. 한 번 배정되면 이후 수정에서도 바뀌지 않는다.
  matchNo: string;
  date: string; // YYYY-MM-DD
  team1: MatchSlot[];
  team2: MatchSlot[];
  result: MatchResult;
  matchType: MatchType; // 경기유형
  replay: Replay | null; // 리플레이(.rep) — 없으면 수기등록
  createdBy: MatchAuthor | null; // 작성자가 탈퇴 등으로 사라졌으면 null
  // 아래 3개는 리플레이 파싱으로만 채워진다 (수동 등록 경기는 항상 null)
  mapName: string | null;
  gameStartedAt: string | null; // ISO 8601 (리플레이 실제 시작 시각 — date와 별개)
  durationSeconds: number | null;
  // 이 경기에 달린 댓글(메모) — 목록 응답에 함께 실려 온다(오래된 순). 검색창에서 댓글
  // 내용으로도 필터하고, 펼침 시 하단 댓글 영역에 렌더한다.
  notes: MatchNote[];
}

// 경기 생성/수정 요청 (id, 작성자는 서버가 채움). 리플레이는 업로드 payload(id 없음)로 보낸다.
// 댓글은 별도 API로 관리하므로 경기 저장 payload에는 넣지 않는다.
export type NewMatch = Omit<Match, "id" | "matchNo" | "createdBy" | "replay" | "notes"> & {
  replay: ReplayUpload | null;
};

// 경기결과 화면 무한스크롤용 커서 페이지 — 서버가 필터링/정렬까지 다 해서 내려준다.
export interface MatchPage {
  items: Match[];
  nextCursor: string | null;
  hasMore: boolean;
  // 같은 필터 조건의 전체 건수 — 첫 페이지(커서 없음) 응답에만 값이 있고, 다음 페이지
  // 응답은 항상 null(다시 세지 않으므로 첫 응답 값을 그대로 들고 있어야 한다).
  total: number | null;
}

// 회원 통계 집계 결과. 실제 플레이한 종족별 집계는 아직 정확도가 떨어져 보류 중이라
// (경기결과 시 종족 입력은 계속 받지만) 지금은 전체 승/패/무만 집계한다.
export interface MemberStats {
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  // 리플레이 파싱으로 apm/eapm/커맨드수 값이 있는 경기만 평균낸다. 그런 경기가 하나도 없으면 null.
  avgApm: number | null;
  avgEapm: number | null;
  avgCmd: number | null;
  avgEcmd: number | null;
  // 경기당 평균 '생산'(유닛 훈련+건물 건설+변태 커맨드 수). 리플레이 등록 경기만 반영, 없으면 null.
  avgBuild: number | null;
}

// 서버 집계(GET /api/matches/stats) 응답 — 통계/랭킹 화면이 매치 원본을 직접 스캔하지 않고
// 이 결과를 그대로 쓴다. overall은 요청한 race 파라미터를 반영하고, byRace/mostPlayedRace는
// race 파라미터와 무관하게 항상 전체 종족 기준이다.
export interface MemberStatsEntry {
  memberId: string;
  overall: MemberStats;
  byRace: Record<BaseRace, MemberStats>;
  mostPlayedRace: Race | null;
  // 랭킹 순서 — 서버가 사람단위 점수(참가+우열) → 상대 강함(SoS) 순으로 가른 결과다.
  // 이 값(자리번호)으로만 클라이언트가 줄세운다. 0경기 회원도 모두 순위가 매겨진다(0점, 맨 아래).
  sortOrder: number | null;
  // 위 모든 기준까지 같아 완전 동률인 회원끼리 값이 같다 — 공동순위로 묶는 기준.
  tieGroup: number | null;
  // 랭킹 2순위 기준값(승자승 다음) — 우세 +1 / 동등 0 / 열세 -1을 사람별로 합산한 점수.
  // 카드에 이 숫자를 보여준다(경기 승점 대신). 순위 대상이 아니면 null.
  personScore: number | null;
  // 사람단위 우세/동등/열세 인원 — 랭킹 상세에서 쓴다.
  superiorCount: number | null;
  equalCount: number | null;
  inferiorCount: number | null;
  // 랭킹 총점 — TrueSkill 보수추정 레이팅(μ−3σ). 카드에 이 숫자를 보여주고 이 값으로 순위를
  // 매긴다. 음수 가능. 순위 대상이 아니면 null.
  rankScore: number | null;
  // TrueSkill 실력 추정(μ)·불확실성(σ). 순위 대상이 아니면 null.
  mu: number | null;
  sigma: number | null;
  // 이 경기유형에서 레이팅에 반영된 누적 경기 수. 순위 대상이 아니면 null.
  ratingGames: number | null;
  // 잠정 — 누적 경기가 기준 미만이라 레이팅이 아직 덜 여문 상태(뱃지 표시). 순위 대상 아니면 null.
  provisional: boolean | null;
}

// GET /api/matches/rating-history — 랭킹 상세의 '경기당 레이팅 변화(Δ)'. deltas는 이 회원이
// 뛴 경기의 matchNo → μ 증감(양수=상승). 레이팅은 시간순 누적이라 백엔드가 계산해 준다.
export interface RatingHistoryResponse {
  deltas: Record<string, number>;
  mu: number | null;
  sigma: number | null;
  conservative: number | null;
  games: number;
  provisional: boolean;
}

// 유저 상성 한 쌍 — 두 회원의 1:1 상대전적(a/b는 회원 로그인 아이디, 무승부 별도).
export interface RivalryPair {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  draws: number;
}

export interface MatchStatsResponse {
  members: MemberStatsEntry[];
}

// GET /api/matches/stats/monthly — 개인 랭킹의 월별 순위변동(최근 5개월) 모달과 목록의
// 전월 대비 화살표가 함께 쓴다. months는 요청한 "YYYY-MM" 순서 그대로 온다.
export interface MemberStatsMonthEntry {
  month: string;
  members: MemberStatsEntry[];
}
export interface MonthlyMatchStatsResponse {
  months: MemberStatsMonthEntry[];
}

// 팀랭킹(GET /api/matches/team-ranking) — 실제로 같은 편이었던 2인 이상 구성 하나가 한 행이다.
// dateFrom/dateTo를 안 넘기면 전체 경기가 대상, 넘기면(랭킹 화면의 월 기준 기본 집계) 그
// 기간만 대상이다.
export interface TeamRankEntry {
  // 개인 승점이 높은 순으로 서버가 이미 정렬해서 보내준다(화면은 이 순서 그대로 격자를 채운다).
  memberIds: string[];
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  // 승 +1, 무 0, 패 -1 — 음수일 수 있다.
  points: number;
}

export interface TeamRankingResponse {
  teams: TeamRankEntry[];
}

// GET /api/matches/team-ranking/monthly — 위 개인 버전과 같은 목적(월별 순위변동/전월
// 대비 화살표), 팀 쪽.
export interface TeamRankMonthEntry {
  month: string;
  teams: TeamRankEntry[];
}
export interface MonthlyTeamRankingResponse {
  months: TeamRankMonthEntry[];
}

// 화면 라우팅 — 회원/이미지 설정/유저연결(게임아이디)은 운영자만, 나머지는 로그인한
// 회원 누구나 접근 가능(역할 기준으로만 판단 — 예전에 있던 메뉴 권한 매트릭스는 역할이
// 운영자/회원 둘로 단순화되면서 없앴다).
export type ScreenKey = "ranking" | "match" | "challenge" | "stats" | "members" | "imageSettings" | "gameId" | "leagues" | "rivalry";

// 랭킹/경기결과/전적통계 등 화면·메뉴 구성을 어느 버전 세트로 보여줄지 — 제어판에서 등록된
// 버전 중 하나로 배포하면 앱 전체가 즉시 바뀐다(개인별 설정이 아니라 서버에 저장된 전역 값).
// 숫자(정수 또는 소수, 예: "3", "3.1")로 구성된다(백엔드 정규식 제약과 동일 형식) — 계속
// 늘어나는 걸 전제로 유니언으로 고정하지 않는다. 숫자로 비교하려면 utils/appVersion.ts의
// versionNumber()를 쓴다.
export type AppVersion = string;

export interface AppVersionStatus {
  activeVersion: AppVersion;
  // 버전 안내(업데이트 안내 모달) 전역 표시 여부 — 관리자가 "버전 안내 설정"에서 끄면 false.
  noticeEnabled: boolean;
}

// 제어판의 버전 선택 팝업이 나열하는 '등록된 버전' 하나 — 서버 app_versions 레지스트리의 행.
export interface AppVersionInfo {
  number: AppVersion;
  // 이 버전이 배포된 뒤 처음 접속하는 회원에게 보여줄 안내 내용 — 한 줄에 한 항목(줄바꿈
  // 구분). 비어 있으면 그 버전은 안내를 띄우지 않는다. "버전 안내 설정"에서 편집한다.
  notes: string;
}

// "너 나와!" 도전장 — 경기결과/예약 시스템과는 독립된 게시판. 폼에서 직접 고르지 않고
// 지목 인원수로 서버가 정한다(1명=1:1, 2명 이상=팀전).
export type ChallengeMatchType = "0101" | "0102";
// "discarded" = 편지봉투를 열지 않고 사유 없이 "버림"(휴지통행) — 사유가 있는 "rejected"
// (거절)과 구분해 표시한다.
export type ChallengeTargetResponse = "pending" | "accepted" | "rejected" | "discarded";
// 4개 상태만 있다 — 응답대기(pending)/성사(confirmed, 너 나와 대기)/완료(done)/폐기(discarded,
// 휴지통). 거절·무응답·미실시·(레거시)취소는 모두 폐기로 통합됐다. 예정 시간이 지나도
// 결과가 안 들어왔으면 계속 성사(confirmed)다.
export type ChallengeStatus = "pending" | "confirmed" | "done" | "discarded";
// 도전자 쪽/지목된 쪽 — 리벤지 신청 자격 판정(패배한 쪽) 등에 쓰인다.
export type ChallengeSide = "creator" | "target";
// 확정 너 나와의 결과 — 이긴 쪽(creator/target) 외에 무승부(draw)/미실시(not_held)도 있다.
// not_held(미실시)는 완료가 아니라 폐기(휴지통)로 간다.
export type ChallengeResult = "creator" | "target" | "draw" | "not_held";

export interface ChallengeTarget {
  memberId: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
  response: ChallengeTargetResponse;
  // 이 대상이 응답하며 남긴 한마디(선택) — 없으면 빈 문자열.
  responseMessage: string;
}

// 도전자와 같은 편(내 팀) — 본인은 자동 포함이라 이 목록엔 안 담기고, "본인 제외
// 나머지 팀원"만 온다. targets와 달리 개별 수락/거절이 없다.
export interface ChallengeOwnMember {
  memberId: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
}

// 리벤지 체인에서 이 도전장보다 앞선(더 예전) 기록 한 건.
export interface ChallengeHistoryEntry {
  id: number;
  // 정렬/그룹핑/카운트다운용 파생 일시(UTC ISO) — 시간 미정이면 자정으로 채워져 온다.
  scheduledAt: string | null;
  // 실제 저장값 — 날짜/시간 각각 독립. 시간 미정이면 scheduledTime = null(날짜만).
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: ChallengeStatus;
  targets: ChallengeTarget[];
  createdAt: string;
  // 확정 너 나와의 결과 — 아직 아무도 입력하지 않았으면 null.
  resultWinnerSide: ChallengeResult | null;
}

export interface Challenge {
  id: number;
  matchType: ChallengeMatchType;
  // 도전자가 호출 때 남긴 한마디(선택) — 없으면 빈 문자열.
  message: string;
  // 정렬/그룹핑/카운트다운용 파생 일시(UTC ISO) — 시간 미정이면 자정으로 채워져 온다.
  scheduledAt: string | null;
  // 실제 저장값 — 날짜/시간 각각 독립. 시간 미정이면 scheduledTime = null(날짜만 지정).
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: ChallengeStatus;
  createdBy: { id: string; nickname: string; avatar: string | null };
  targets: ChallengeTarget[];
  ownMembers: ChallengeOwnMember[];
  createdAt: string;
  // 폐기(휴지통)된 시각(ISO) — 폐기 상태가 아니면 null. 휴지통을 "최근 버려진 순"으로 정렬한다.
  discardedAt: string | null;
  // 리벤지(설욕전)로 만들어졌으면 원래 도전장의 id, 아니면 null. 값이 있으면 곧 리벤지다.
  reappliedFromId: number | null;
  // 확정 너 나와의 결과 — 아직 아무도 입력하지 않았으면 null.
  resultWinnerSide: ChallengeResult | null;
  // 이 도전장보다 앞선 체인 기록(오래된 순) — 목록 화면 카드에서 좌우로 슬라이드해
  // 보여준다. 리벤지 이력이 없으면 빈 배열.
  history: ChallengeHistoryEntry[];
  // "너 나와! 신청 들어주기"로 만들어졌으면 true — 카드에 "요청너 나와" 배지를 붙인다.
  fromMatchRequest: boolean;
}

export interface ChallengeCreatePayload {
  // 날짜/시간 각각 선택 — 날짜만 정하고 시간은 미정(null)으로 둘 수 있다.
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  // 호출 한마디(선택, 한글 50자).
  message?: string;
  targetMemberIds: string[];
  // 본인 제외 나머지 내 팀원(최대 3명, 본인 포함 최대 4명) — 안 넘기면 나 혼자.
  ownTeamMemberIds?: string[];
  // "너 나와! 신청 들어주기"로 여는 도전장이면 true.
  fromMatchRequest?: boolean;
}

// 리벤지(설욕전)을 신청할 때 — 날짜/시간 모두 생략 가능. 한마디(선택)도 함께 보낼 수 있다.
export interface ChallengeRevengePayload {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  message?: string;
}

// ===== 너 나와! 신청 코너 ("너 나와!" 최상단) =====
// 본문에 @태그로 최소 2명을 지목하는 공개 요청글. 지목된 사람만 "들어주기"로 도전장을 보낼
// 수 있고, 들어주면 목록에서 사라진다. 정렬은 추천 많은 순 → 먼저 등록된 순.
export interface MatchRequestTarget {
  memberId: string;
  nickname: string;
}

export interface MatchRequest {
  id: number;
  text: string;
  author: { memberId: string; nickname: string; avatar: string | null };
  createdAt: string;
  recommendCount: number;
  // 내가 이미 추천을 눌렀는지(버튼 눌림 상태).
  recommendedByMe: boolean;
  // 추천한 사람 목록(PC 한정 마우스오버 팝오버용).
  recommenders: { memberId: string; nickname: string; avatar: string | null }[];
  // 내가 작성자인지 — 작성자/운영자만 "성사됨" 완료 처리를 할 수 있다.
  mine: boolean;
  // 언급된 회원들 — 카드에 "언급: A, B"로 표시(권한 등 다른 기능과는 연결 안 함).
  targets: MatchRequestTarget[];
}

// 내가 언급된 안 읽은 요청 알림 — 앱 열 때 인박스 팝업으로 뜬다.
export interface MatchRequestInboxItem {
  requestId: number;
  text: string;
  author: { memberId: string; nickname: string; avatar: string | null };
  createdAt: string;
  // 이 요청에 함께 언급된 사람들(나 포함).
  mentioned: MatchRequestTarget[];
}

export interface MatchRequestListResponse {
  items: MatchRequest[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface MatchRequestCreatePayload {
  text: string;
  // @태그 기능은 폐지했지만 언급된 사람(알림 대상)은 계속 보낸다. 최소 인원 제한 없음(0명 가능).
  targetMemberIds: string[];
}

// 기간 필터 프리셋 — "custom"일 때만 실제로 from/to(직접 입력) 값을 사용하고, 나머지는
// 화면이 오늘 날짜 기준으로 즉시 계산한다(periodPresetRange 참고). "all"은 기간 제한 없이
// 전체 기록을 본다(from/to 모두 빈 값).
export type PeriodPreset = "all" | "today" | "week" | "month" | "year" | "custom";

// 경기결과/통계 공용 검색 필터 상태 (정렬은 화면마다 의미가 달라 각 화면이 별도로 관리).
// race는 회원 프로필의 "주종족"이 아니라 실제 경기결과에서 가장 많이 플레이한 종족
// 기준 필터다 (computeMainPlayedRace 참고).
export interface MatchFilterState {
  nickname: string;
  tag: string;
  // 경기 고유번호(matchNo)로 정확히 하나만 찾을 때 — 채워지면 다른 필터는 무시하고
  // 그 경기 하나만 조회한다.
  matchNo: string;
  race: Race | "all";
  matchType: MatchType | "all";
  // periodPreset이 "custom"일 때만 의미가 있다 — 그 외엔 화면에 보이지 않고 값도 안 쓰인다
  // (직접입력으로 다시 돌아왔을 때 이전에 입력해둔 값을 그대로 복원하기 위해 남겨만 둔다).
  from: string;
  to: string;
  periodPreset: PeriodPreset;
  // 유저 검색에 띄어쓰기로 여러 명을 적었을 때, 켜져 있으면 그 인원 전부가 같은 경기에 있었던
  // 경우만 보여준다(AND). 꺼져 있으면(기본) 그중 한 명이라도 있으면 보여준다(OR).
  // 경기결과 화면 전용 — 통계 화면은 회원 한 명 단위 필터라 이 조건이 적용되지 않는다.
  matchAllUsers: boolean;
}

// ===== 리그(League/Tournament) — 운영자 전용, 단일 엘리미네이션 대진표 =====

export type LeagueMode = "team" | "individual";
export type LeagueStatus = "setup" | "active" | "completed";
export type LeagueMatchSide = "a" | "b";

export interface LeagueRosterMember {
  memberId: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
  position: number;
}

export interface LeagueTeam {
  id: number;
  label: string; // A~F
  roster: LeagueRosterMember[];
}

export interface LeagueMatchTeamRef {
  id: number;
  label: string;
}

export interface LeagueMatchSubstitution {
  teamId: number;
  rosterPosition: number;
  substituteMemberId: string;
  substituteNickname: string;
  note: string;
}

export interface LeagueMatch {
  id: number;
  round: number;
  slotInRound: number;
  teamA: LeagueMatchTeamRef | null;
  teamB: LeagueMatchTeamRef | null;
  // 대진판이 2의 거듭제곱이 아니라 생기는, 구조적으로 영원히 안 열리는 칸.
  isDead: boolean;
  scheduledAt: string | null;
  setsWonA: number | null;
  setsWonB: number | null;
  winnerTeamId: number | null;
  substitutions: LeagueMatchSubstitution[];
}

export interface League {
  id: number;
  name: string;
  mode: LeagueMode;
  bestOf: number;
  status: LeagueStatus;
  // 대진표 생성 전엔 null — 생성 시점에 관리자가 정한 team_count 기준 다음 2의
  // 거듭제곱으로 확정된다.
  drawSize: number | null;
  // 대진표 생성 시 예약해둔 규모(실제 지금 만들어진 팀 수와 다를 수 있다) — 생성 전엔 null.
  plannedTeams: number | null;
  // 대진(시드)이 확정됐는지 — true면 1라운드 슬롯을 더 이상 바꿀 수 없다.
  bracketLocked: boolean;
  teams: LeagueTeam[];
  matches: LeagueMatch[];
  createdAt: string;
}

export interface LeagueListItem {
  id: number;
  name: string;
  mode: LeagueMode;
  status: LeagueStatus;
  teamCount: number;
}

export interface LeagueCreatePayload {
  name: string;
  mode: LeagueMode;
  bestOf?: number;
}

export interface LeagueUpdatePayload {
  name?: string;
  bestOf?: number;
}

export interface LeagueMatchResultPayload {
  setsWonA: number;
  setsWonB: number;
  substitutes?: {
    teamId: number;
    rosterPosition: number;
    substituteMemberId: string;
    note?: string;
  }[];
}
