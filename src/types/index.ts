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

// 종족 아이콘(텍스트/이모지 또는 이미지)뿐 아니라, 화면에서 쓰는 다른 이미지 슬롯(예: 홈
// 로고)도 같은 맵에 함께 담는다 — 관리 화면 하나, 저장 API 하나로 통합하기 위함.
// home_logo_light는 라이트 테마 전용 홈 로고 — 어두운 배경을 전제로 만든 로고가 라이트
// 테마의 흰 배경에서 잘 안 보일 수 있어 완전히 별도로 등록한다(Header.tsx 참고).
export type IconSlot = Race | "home_logo" | "home_logo_light";
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
  // 아래 4개는 리플레이 파싱으로 자동 등록된 참가자만 값이 있다 (수동 등록은 전부 null)
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
}

// 첨부파일. url 은 신규 업로드 시 data URL(base64), 서버 저장 후에는 실제 접근 URL.
export interface MatchAttachment {
  name: string;
  url: string;
}

// 경기 작성자 (수정/삭제 권한 판단 및 표시용)
export interface MatchAuthor {
  id: string;
  nickname: string;
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
  note: string; // 비고
  attachment: MatchAttachment | null; // 파일첨부
  createdBy: MatchAuthor | null; // 작성자가 탈퇴 등으로 사라졌으면 null
  // 아래 3개는 리플레이 파싱으로만 채워진다 (수동 등록 경기는 항상 null)
  mapName: string | null;
  gameStartedAt: string | null; // ISO 8601 (리플레이 실제 시작 시각 — date와 별개)
  durationSeconds: number | null;
}

// 경기 생성/수정 요청 (id, 작성자는 서버가 채움)
export type NewMatch = Omit<Match, "id" | "matchNo" | "createdBy">;

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
}

// 서버 집계(GET /api/matches/stats) 응답 — 통계/랭킹 화면이 매치 원본을 직접 스캔하지 않고
// 이 결과를 그대로 쓴다. overall은 요청한 race 파라미터를 반영하고, byRace/mostPlayedRace는
// race 파라미터와 무관하게 항상 전체 종족 기준이다.
export interface MemberStatsEntry {
  memberId: string;
  overall: MemberStats;
  byRace: Record<BaseRace, MemberStats>;
  mostPlayedRace: Race | null;
  // 랭킹 순서 — 서버가 승자승(맞대결) → 승점 → 공통상대 → 전체 승수 순으로 이미 다 가른
  // 결과다(승률은 정렬 기준이 아니다). 맞대결/공통상대는 "누구와 비교하느냐"에 따라 달라지는
  // 쌍 단위 값이라 회원별 숫자 하나로는 내려올 수 없어서, 클라이언트는 이 자리번호로만
  // 줄세운다. 이 조회 조건에서 한 판도 안 뛴 회원은 순위 대상이 아니라 null.
  sortOrder: number | null;
  // 위 모든 기준까지 같아 완전 동률인 회원끼리 값이 같다 — 공동순위로 묶는 기준.
  tieGroup: number | null;
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
export type ScreenKey = "ranking" | "match" | "challenge" | "stats" | "members" | "imageSettings" | "gameId";

// 랭킹/경기결과/전적통계 등 화면·메뉴 구성을 v1, v2, v3, ... 중 어느 세트로 보여줄지 —
// 제어판의 배포(+1)/롤백(-1)으로 앱 전체가 즉시 바뀐다(개인별 설정이 아니라 서버에 저장된
// 전역 값). "v" + 1 이상 정수(백엔드 정규식 제약과 동일 형식) — 버전이 계속 늘어나는 걸
// 전제로 하므로 유니언으로 고정하지 않는다. 숫자만 뽑아 쓰려면 utils/appVersion.ts의
// versionNumber()를 쓴다.
export type AppVersion = string;

export interface AppVersionStatus {
  activeVersion: AppVersion;
}

// "너 나와!" 도전장 — 경기결과/예약 시스템과는 독립된 게시판. 폼에서 직접 고르지 않고
// 지목 인원수로 서버가 정한다(1명=1:1, 2명 이상=팀전).
export type ChallengeMatchType = "0101" | "0102";
export type ChallengeTargetResponse = "pending" | "accepted" | "rejected";
// 지목된 전원이 승락하면 confirmed, 한 명이라도 거절하면 그 즉시 rejected, 요청자가
// 확정 전에 스스로 취소하면 canceled, 그 외엔 pending.
export type ChallengeStatus = "pending" | "confirmed" | "rejected" | "canceled";

export interface ChallengeTarget {
  memberId: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
  response: ChallengeTargetResponse;
  // 응답(수락/거절) 한마디 — 요청자가 조회할 때만 값이 오고, 그 외 조회자에게는 항상
  // null이다.
  responseMessage: string | null;
}

// 도전자와 같은 편(내 팀) — 본인은 자동 포함이라 이 목록엔 안 담기고, "본인 제외
// 나머지 팀원"만 온다. targets와 달리 개별 수락/거절이 없다.
export interface ChallengeOwnMember {
  memberId: string;
  nickname: string;
  battletag: string;
  avatar: string | null;
}

// 재신청 체인에서 이 도전장보다 앞선(더 예전) 기록 한 건 — 도전자/팀 구성은 체인
// 내내 그대로라(재신청이 손대는 건 시간/메시지/응답뿐) 따로 안 담는다.
export interface ChallengeHistoryEntry {
  id: number;
  scheduledAt: string | null;
  message: string;
  status: ChallengeStatus;
  targets: ChallengeTarget[];
  createdAt: string;
}

export interface Challenge {
  id: number;
  matchType: ChallengeMatchType;
  scheduledAt: string | null;
  message: string;
  status: ChallengeStatus;
  createdBy: { id: string; nickname: string };
  targets: ChallengeTarget[];
  ownMembers: ChallengeOwnMember[];
  createdAt: string;
  // 재신청으로 만들어졌으면 원래 도전장의 id, 아니면 null.
  reappliedFromId: number | null;
  // 이 도전장보다 앞선 체인 기록(오래된 순) — 목록 화면 카드에서 좌우로 슬라이드해
  // 보여준다. 재신청 이력이 없으면 빈 배열.
  history: ChallengeHistoryEntry[];
}

export interface ChallengeCreatePayload {
  scheduledAt?: string | null;
  message?: string;
  targetMemberIds: string[];
  // 본인 제외 나머지 내 팀원(최대 3명, 본인 포함 최대 4명) — 안 넘기면 나 혼자.
  ownTeamMemberIds?: string[];
}

// 거절된 도전장을 재신청할 때 — 둘 다 생략하면 기존 시간/메모를 그대로 유지한다.
export interface ChallengeReapplyPayload {
  scheduledAt?: string | null;
  message?: string;
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
