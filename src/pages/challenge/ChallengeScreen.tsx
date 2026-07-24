import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, MessageSquarePlus } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import OptionalDateTimeFields from "../../components/common/OptionalDateTimeFields";
import InlineCollapse from "../../components/common/InlineCollapse";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import type { KakaoShareContent } from "../../utils/kakaoShare";
// "보고싶은 너 나와!" 코너는 지금 숨김(요청) — 다시 켤 때 import와 렌더 주석을 함께 해제한다.
// import MatchRequestCorner from "./MatchRequestCorner";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { isAdminRole } from "../../constants/roles";
import { cx } from "../../utils/format";
import {
  challengeDateGroupLabel, challengeTimeLabel, formatChallengeSchedule, formatRelativeSchedule, isToday, pad,
  DATE_INPUT_MIN, DATE_INPUT_MAX, DEFAULT_CHALLENGE_TIME,
} from "../../utils/date";
import { getScrollMetrics, getScrollRoot } from "../../utils/scrollRoot";
import type { Challenge, ChallengeResult, ChallengeSide, ChallengeStatus, ChallengeTarget } from "../../types";

// 화면 표시 상태는 서버 status를 그대로 쓴다 — 서버가 4개(응답대기 pending/성사 confirmed/
// 완료 done/폐기 discarded)로 확정해 내려준다. 예정 시간이 지나도 결과가 없으면 계속 성사
// (confirmed)고, 거절·무응답·미실시·(레거시)취소는 모두 폐기(discarded)로 통합됐다. 프론트가
// 파생 계산을 하지 않는다(서버가 내려준 status를 그대로 쓴다).

// 응답 마감 = 요청일(createdAt) + 72시간(요청). 단, 예정 시각이 그보다 먼저면 예정 시각이
// 마감이다 — 그때까지 응답이 없으면 서버가 무응답 거절 처리한다. 여기선 남은 시간 문구만
// 만든다(만료 판정은 서버 배치). 마감이 지나 잠깐 음수가 되면 "곧 마감"으로 대체한다.
const EXPIRE_MS = 72 * 60 * 60 * 1000;
function responseDeadlineLabel(createdAt: string, scheduledAt: string | null): string {
  const base = new Date(createdAt).getTime() + EXPIRE_MS;
  const deadline = scheduledAt ? Math.min(base, new Date(scheduledAt).getTime()) : base;
  const remain = deadline - Date.now();
  if (remain <= 0) return "응답 마감 임박";
  const days = Math.floor(remain / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remain % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((remain % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return `응답 마감 ${days}일 ${hours}시간 남음`;
  return hours > 0 ? `응답 마감 ${hours}시간 남음` : `응답 마감 ${mins}분 남음`;
}

type PillTone = "pending" | "accepted" | "rejected" | "discarded";

// 상대 한 명의 응답 배지 — 수락/거절/버림/대기로 구분한다(아바타 옆 작은 배지). 각자의 실제
// 응답을 그대로 쓴다 — 무응답 거절(폐기)이어도 그 사람이 실제로는 응답하지 않았으므로 "대기"로
// 남는다. "버림"(discarded)은 편지봉투를 열지 않고 사유 없이 버린 것으로, 사유가 있는 "거절"
// (rejected)과 구분해 표시한다(요청: "버림으로 상태 표시(거절하고 다른 응답)").
function targetPillInfo(t: ChallengeTarget): { tone: PillTone } {
  if (t.response === "accepted") return { tone: "accepted" };
  if (t.response === "rejected") return { tone: "rejected" };
  if (t.response === "discarded") return { tone: "discarded" };
  return { tone: "pending" };
}

interface ChallengeDateGroup {
  label: string;
  isToday: boolean;
  items: Challenge[];
}

// 경기결과 화면처럼 날짜별로 묶어 보여준다(요청: "경기 화면처럼 날짜별로 그룹핑") —
// 넘어오는 목록은 이미 정렬돼 있어서 같은 날짜 라벨이 연속으로 나올 때만 묶으면 된다.
// "일정 미정"(scheduledAt 없음)은 이제 응답 대기중인 건에만 남는다 — 시간 없이 보냈다
// 거절/무응답으로 끝나는 순간 서버가 예정 일시를 요청일시+1일로 확정하기 때문이다
// (요청: "일정미정은 응답대기중일때만 가능한거야", "거절하는 순간 scheduled_at도 업데이트").
// 날짜 라벨 자체에 연도가 포함돼(challengeDateGroupLabel) 별도 연도 줄은 더 이상 없다
// (요청: "년도 따로 빼지 않고 날짜에 넣기").
function groupChallengesByDate(list: Challenge[]): ChallengeDateGroup[] {
  const groups: ChallengeDateGroup[] = [];
  list.forEach((c) => {
    const label = challengeDateGroupLabel(c.scheduledAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(c);
    else groups.push({ label, isToday: isToday(c.scheduledAt), items: [c] });
  });
  return groups;
}

interface ChallengeTimeGroup {
  // 그룹 식별자 — 같은 예정 시각(scheduledAt)끼리 묶는다. 일정 미정은 "none".
  key: string;
  // 그 시각의 라벨("오후 7시 10분") — 일정 미정이면 null이라 시간 헤더를 안 그린다.
  timeLabel: string | null;
  items: Challenge[];
}

// 한 날짜 그룹 안에서 다시 예정 시각별로 묶는다(요청: "시간도 그루핑해서 제일 위 카드 위에
// 한번만 표시") — 카드마다 시간을 반복해 찍는 대신, 같은 시각 카드들 맨 위에 시간을 한 번만
// 보여주려는 것. 목록이 이미 scheduledAt 순으로 정렬돼 있어 같은 시각은 연속이라, 라벨이
// 연달아 같을 때만 묶으면 된다.
function groupByTime(items: Challenge[]): ChallengeTimeGroup[] {
  const groups: ChallengeTimeGroup[] = [];
  items.forEach((c) => {
    const key = c.scheduledAt ?? "none";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(c);
    else groups.push({ key, timeLabel: challengeTimeLabel(c.scheduledAt), items: [c] });
  });
  return groups;
}

type SideMember = { id: string; nickname: string; avatar: string | null };

// 팀 구성 한 편(도전자편/상대편)을 세로로 쌓는다(요청: "각팀을 세로로 배치") — 1:1이든
// 팀전이든 모양은 같고, 인원이 하나든 여럿이든 그냥 줄 수만 늘어난다.
function ChallengeSide({
  people, targets, highlightMemberIds,
}: {
  people: SideMember[];
  targets?: { target: ChallengeTarget }[];
  // 유저 검색에 걸린 사람 — 경기결과 로스터와 같은 반전색으로 프사+닉네임을 함께 칠한다
  // (요청: "랭킹, 너 나와 유저 검색시 하이라이팅 추가 단! 닉네임뿐 아니라 프사까지").
  highlightMemberIds?: Set<string>;
}) {
  return (
    <div className={cx("scr-challenge-side", targets && "scr-challenge-side-target")}>
      {people.map((p, i) => {
        const t = targets?.[i];
        const tone = t ? targetPillInfo(t.target).tone : null;
        return (
          <div key={p.id} className="scr-challenge-side-block">
            <div className="scr-challenge-side-row">
              <span className={cx("scr-challenge-person", highlightMemberIds?.has(p.id) && "scr-challenge-person-hit")}>
                <Avatar member={p} size={24} />
                <span className="scr-challenge-person-name">{p.nickname}</span>
              </span>
              {/* 응답 배지 — 수락/거절/대기 세 가지로만 구분한 작은 도장식 알약(요청:
                  "응답 배지는 수락/거절/대기 세개로 통일" → "수락 거절 대기 글자 배지로
                  해줘 작고 진하게" → "닉네임 옆으로 다시 이동" — 아바타에 겹치는
                  대신 다시 이름 옆 인라인으로). */}
              {tone && (
                <span className={cx("scr-challenge-avatar-badge", `scr-challenge-avatar-badge-${tone}`)}>
                  {tone === "accepted" ? "수락" : tone === "rejected" ? "거절" : tone === "discarded" ? "버림" : "대기"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 카드 안에서 좌우로 슬라이드해 보여줄 "한 페이지" — 재신청/설욕전 체인의 각 기록(과 지금
// 살아있는 도전장 자신)이 공통으로 갖는 필드를 담는다. 도전자/팀 구성은 체인 내내 안
// 바뀌므로 여기 안 담는다(체인 앞 기록은 targets만 다를 수 있다).
interface ChallengePage {
  id: number;
  scheduledAt: string | null;
  targets: ChallengeTarget[];
  status: ChallengeStatus;
  createdAt: string;
  resultWinnerSide: ChallengeResult | null;
}

// 카드가 지금 어떤 인라인 폼을 펼치고 있는지 — 한 번에 하나만 열린다. schedule은 일시 미정
// 도전장을 수락하며 시간을 정하는 폼, revenge는 리벤지 신청, result는 결과 입력.
type CardMode = "none" | "schedule" | "revenge" | "result";

interface ChallengeCardProps {
  challenge: Challenge;
  myId: string | undefined;
  // 유저 검색에 걸린 사람들 — 카드 안 프사+닉네임을 반전색으로 칠한다.
  highlightMemberIds?: Set<string>;
  // 읽기 전용 — "버려진 도전장" 모달에서 쓴다. 응답/취소/재신청 등 모든 액션 버튼을 감춘다
  // (버려진 초대장은 체인 될 수 없다). 페이지 넘기기(보기)는 그대로 둔다.
  readOnly?: boolean;
  onResponded: (updated: Challenge) => void;
}

function ChallengeCard({ challenge, myId, highlightMemberIds, readOnly, onResponded }: ChallengeCardProps) {
  const memberOf = useAppStore((s) => s.memberOf);
  const user = useAppStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  // 카드에서 수락/거절/리벤지 신청을 하면, 인박스와 똑같이 확인창(+카카오 공유)을 띄운다
  // (요청). 이 창을 닫을 때 비로소 onResponded로 목록을 갱신한다 — 리벤지는 새 도전장으로
  // 카드가 교체(언마운트)되므로, 갱신을 확인창 닫는 시점까지 미뤄야 창이 사라지지 않는다.
  const [sharePrompt, setSharePrompt] = useState<
    { kind: "accepted" | "rejected" | "revenge"; updated: Challenge } | null
  >(null);
  const [err, setErr] = useState("");
  const myTarget = challenge.targets.find((t) => t.memberId === myId);
  const isCreator = challenge.createdBy.id === myId;
  const inOwnTeam = challenge.ownMembers.some((m) => m.memberId === myId);
  // 이 너 나와의 참가자인지, 참가자라면 어느 편인지 — 결과 입력/설욕전/연기 노출 판정에 쓴다.
  const isParticipant = isCreator || inOwnTeam || !!myTarget;
  const mySide: ChallengeSide | null = isCreator || inOwnTeam ? "creator" : myTarget ? "target" : null;
  // 응답(ChallengeAuthor)엔 프사가 없어서(닉네임만) 로컬 회원 목록에서 찾아 보여준다 —
  // 지목된 상대(targets)는 서버가 프사까지 내려주니 그대로 쓴다.
  const creatorMember = memberOf(challenge.createdBy.id);

  // 응답(수락/거절)은 아직 응답 안 한 지목자가, 아직 응답대기(pending)인 도전장에서만.
  const canRespond = !!myTarget && myTarget.response === "pending" && challenge.status === "pending";
  // 결과 입력 가능 시점 — 예정 일시가 지났거나, 시간 미정으로 수락된 너 나와(요청: "시간 미정
  // 수락 가능, 완료 시점으로 입력됨")은 언제든. 후자는 서버가 결과 입력 시점을 예정 일시로 채운다.
  const schedulePassed = !!challenge.scheduledAt && new Date(challenge.scheduledAt).getTime() < Date.now();
  const resultInputOpen = schedulePassed || !challenge.scheduledAt;
  const canEnterResult = isParticipant && challenge.status === "confirmed" && resultInputOpen && challenge.resultWinnerSide === null;
  // 완료된 너 나와에서 내가 패배한 쪽이면 리벤지(설욕전)을 신청할 수 있다 — 무승부(draw)/미실시
  // (not_held)는 패자가 없어 대상이 아니다(losingSide=null). 미실시는 애초에 폐기라 완료가 아니다.
  const losingSide: ChallengeSide | null =
    challenge.resultWinnerSide === "creator" ? "target"
    : challenge.resultWinnerSide === "target" ? "creator"
    : null;
  const canRevenge = !readOnly && challenge.status === "done" && losingSide !== null && mySide === losingSide;
  // "취소" — 아무도 응답하지 않은 채 폐기(휴지통)로 끝난 건(응답 전 취소/흐지부지). 응답 후
  // 취소는 이제 없다(요청). 거절/버림(응답 있음)·미실시(결과 있음)와 구분해 휴지통에서
  // 우상단 "취소" 라벨로 표시한다(요청: "응답전 취소 건은 휴지통에서 '취소' 라벨 우상단에").
  const isCanceled =
    challenge.status === "discarded"
    && challenge.resultWinnerSide === null
    && challenge.targets.every((t) => t.response === "pending");

  // 재신청/설욕전 이력(오래된 순) 뒤에 지금 살아있는 도전장을 붙여 "페이지" 목록을 만든다 —
  // 기본으로는 맨 뒤(최신)를 보여준다. 이력이 없으면 페이지가 하나뿐이라 슬라이드 UI 자체가
  // 안 뜬다. pages.length는 이 카드가 떠 있는 동안 안 바뀐다(재신청/설욕전으로 이력이
  // 늘어나는 순간 새 id의 도전장으로 통째로 교체돼 이 카드는 언마운트된다).
  const pages: ChallengePage[] = useMemo(
    () => [
      ...challenge.history.map((h) => ({
        id: h.id, scheduledAt: h.scheduledAt, targets: h.targets,
        status: h.status, createdAt: h.createdAt, resultWinnerSide: h.resultWinnerSide,
      })),
      {
        id: challenge.id, scheduledAt: challenge.scheduledAt, targets: challenge.targets,
        status: challenge.status, createdAt: challenge.createdAt, resultWinnerSide: challenge.resultWinnerSide,
      },
    ],
    [challenge],
  );
  const [pageIndex, setPageIndex] = useState(pages.length - 1);
  const isLatestPage = pageIndex === pages.length - 1;
  // 각 페이지의 파생 라벨/상태는 그 페이지 자신의 값으로 계산한다 — 최신 페이지는 지금 실제
  // 일시/상태, 이력 페이지는 그 시점의 것(거절/무응답취소/완료 등). 아래에서 모든 페이지를
  // 한 칸에 겹쳐 렌더해(카드 높이를 최대 페이지에 고정) 페이지마다 렌더 시점에 계산한다.
  // 카드 자체엔 더 이상 시간을 찍지 않는다(요청: "카드 시간 표시 삭제") — 시각은 목록의
  // 시간 그룹 헤더가, 페이징 이력의 일시는 아래 페이지네이션 위 상대표기가 대신 보여준다.

  // 페이지를 넘길 때: 내용은 페이드 없이 바로 교체하고, 패널만 높이를 모핑한다(요청:
  // "페이지 이동시 현재 내용물 페이드아웃 제거하고 바로 사라지게 변경. 페이드인은 유지"
  // → "페이드 인도 삭제" — 결국 내용 전환은 전부 즉시, 높이 변화만 애니메이션). 높이는
  // 지금 보여주는 페이지 기준으로 실측해 인라인으로 박고 CSS transition이 이전→새
  // 높이로 모핑한다.
  const pagesInnerRef = useRef<HTMLDivElement>(null);
  const [pagesHeight, setPagesHeight] = useState<number | undefined>(undefined);
  const [renderedIndex, setRenderedIndex] = useState(pageIndex);
  useEffect(() => {
    setRenderedIndex(pageIndex);
  }, [pageIndex]);
  useLayoutEffect(() => {
    const inner = pagesInnerRef.current;
    if (!inner) return;
    const measure = () => setPagesHeight(inner.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [renderedIndex, challenge]);

  const [mode, setMode] = useState<CardMode>("none");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  // 응답 한마디(선택) — 아이콘 버튼을 눌러야 입력창이 트랜지션으로 열린다(요청).
  const [respondMessage, setRespondMessage] = useState("");
  const [respondMsgOpen, setRespondMsgOpen] = useState(false);
  // 리벤지 한마디(선택) — 응답 한마디와 같은 방식(요청: 리벤지 요청에도 한마디).
  const [revengeMessage, setRevengeMessage] = useState("");
  const [revengeMsgOpen, setRevengeMsgOpen] = useState(false);

  // 카드에서 바로 승락/거절 — 한마디(선택)와 함께 응답한다. 거절은 되돌릴 수 없으니 확인만 받는다.
  const respond = async (response: "accepted" | "rejected") => {
    if (response === "rejected" && !window.confirm("이 너 나와!를 거절할까요?")) return;
    setErr("");
    setBusy(true);
    try {
      const updated = await api.respondToChallenge(challenge.id, response, undefined, respondMessage.trim());
      // 목록 갱신(onResponded)은 확인창을 닫을 때로 미룬다.
      setSharePrompt({ kind: response, updated });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 수락하며 시간을 정할 때 — 날짜/시간 입력칸을 비운 채로 시작한다(OptionalDateTimeFields는
  // 체크박스 없이 처음부터 두 칸을 다 보여준다 — 요청: "날짜 선택, 시간 선택 체크박스
  // 제거하고 처음부터 둘다 노출").
  const startScheduling = () => { setMode("schedule"); setDateStr(""); setTimeStr(""); };
  const startRevenge = () => { setMode("revenge"); setDateStr(""); setTimeStr(""); setRevengeMessage(""); setRevengeMsgOpen(false); };
  const startResult = () => { setMode("result"); setErr(""); };
  const closeMode = () => setMode("none");

  const acceptWithSchedule = async () => {
    setErr("");
    setBusy(true);
    try {
      // 날짜를 정했으면 그 일시로(시간을 안 정했으면 기본 시간(21시)으로 채운다), 날짜도
      // 안 정하면 시간 미정으로 수락한다(요청: "시간 미정 수락 가능" — 실제 일시는
      // 완료(결과 입력) 시점에 서버가 채운다).
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || DEFAULT_CHALLENGE_TIME}`).toISOString() : undefined;
      const updated = await api.respondToChallenge(challenge.id, "accepted", scheduledAt, respondMessage.trim());
      closeMode();
      setSharePrompt({ kind: "accepted", updated });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 리벤지(설욕전) 신청 — 시간은 비워서 보낼 수 있다(승리한 쪽이 수락하며 시간을 정함).
  const submitRevenge = async () => {
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || DEFAULT_CHALLENGE_TIME}`).toISOString() : undefined;
      const updated = await api.requestRevenge(challenge.id, { scheduledAt, message: revengeMessage.trim() });
      closeMode();
      setSharePrompt({ kind: "revenge", updated });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "리벤지를 신청하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (winnerSide: ChallengeResult) => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.enterChallengeResult(challenge.id, winnerSide);
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "결과를 입력하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 요청자쪽 인원(본인+같은 편) — 도전자/팀 구성은 체인 내내 그대로라 페이지와 무관하게 고정.
  const creatorSideMembers: SideMember[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers: SideMember[] = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  // 확인창을 닫을 때 비로소 목록을 갱신한다(리벤지로 카드가 교체돼도 창이 유지되도록 미뤘던 것).
  const dismissShare = () => {
    const p = sharePrompt;
    setSharePrompt(null);
    if (p) onResponded(p.updated);
  };
  // 확인창 제목/설명 — 수락/거절/설욕전에 맞춰. (인박스의 응답 확인창과 같은 톤.)
  const sharePromptTitle =
    sharePrompt?.kind === "rejected" ? "대결 거절"
    : sharePrompt?.kind === "revenge" ? "설욕전 신청!"
    : "대결 수락!";
  const sharePromptWhen = formatChallengeSchedule(sharePrompt?.updated.scheduledAt ?? null);
  const sharePromptDesc =
    sharePrompt?.kind === "rejected" ? "호출을 거절했어요."
    : sharePrompt?.kind === "revenge" ? "설욕전을 신청했어요."
    : `${sharePromptWhen}에 만나요.`;
  // 카카오 공유 내용 — 인박스 응답 공유와 같은 형식(대진/일시 + 폴백 텍스트 + 링크).
  const buildShareContent = (): KakaoShareContent => {
    const caller = challenge.createdBy.nickname;
    const me = user?.nickname ?? "";
    const matchup = `${creatorSideMembers.map((m) => m.nickname).join(", ")} vs ${targetSideMembers.map((m) => m.nickname).join(", ")}`;
    const link = `${window.location.origin}/?sv=challenge&sid=${sharePrompt?.updated.id ?? challenge.id}`;
    const imageUrl = `${window.location.origin}/images/items/nawa2.jpg`;
    if (sharePrompt?.kind === "rejected") {
      return { title: "대결 거절", description: matchup, imageUrl, link,
        fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출을 거절했어요.\n${matchup}` };
    }
    if (sharePrompt?.kind === "revenge") {
      return { title: "설욕전 신청!", description: matchup, imageUrl, link,
        fallbackText: `[스타게이트] ${me}님이 설욕전(리벤지)을 신청했어요!\n${matchup}` };
    }
    return { title: "대결 수락!", description: `${matchup} · ${sharePromptWhen}`, imageUrl, link,
      fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출을 수락했어요!\n${matchup}\n일시: ${sharePromptWhen}` };
  };

  // 지금 실제로 보여주는 페이지(renderedIndex — 크로스페이드로 pageIndex보다 살짝 늦게
  // 따라온다) 하나만 자연 높이로 렌더한다. pages가 줄어드는 드문 경우에도 안전하게 클램프.
  const shownIndex = Math.min(renderedIndex, pages.length - 1);
  const activePage = pages[shownIndex];
  const shownLatest = shownIndex === pages.length - 1;
  const activeTargetInfos = activePage.targets.map((t) => ({ target: t }));
  // 체인은 이제 리벤지(revenge) 하나뿐 — 체인의 첫 페이지(원본)를 뺀 나머지 페이지가 곧
  // 리벤지 기록이다(reappliedFromId를 따로 안 봐도 페이지 순번으로 안다).
  const isRevengePage = shownIndex > 0;

  // 결과 입력 대기 = 성사(수락)됐고 예정 일시가 지났는데 아직 결과가 안 들어온 상태(요청:
  // "끝났으면 결과 입력 대기"). 완료 = 승패가 입력된 상태(요청: "결과보기 삭제하고 그자리에
  // 상태 배지 완료"). 무승부/미실시는 각자 알약/텍스트로 따로 표시한다.
  const isResultPending =
    shownLatest && challenge.status === "confirmed" && resultInputOpen && challenge.resultWinnerSide === null;
  const isDoneWin =
    shownLatest && (challenge.resultWinnerSide === "creator" || challenge.resultWinnerSide === "target");

  // 이 "맨 윗줄"에 실제로 보여줄 게 하나라도 있을 때만 줄을 그린다(전부 없으면 빈 줄이
  // 남아 어색하다). 리벤지 라벨/무승부·완료·결과입력대기 배지/카운트다운/미실시 중 하나라도.
  const whenHasContent =
    isRevengePage
    || activePage.resultWinnerSide === "draw"
    || (shownLatest && challenge.status === "pending")
    || (shownLatest && challenge.resultWinnerSide !== null)
    || isResultPending;

  // 이미 종료된 너 나와!(완료/미실시 등 status=done·discarded)은 패널을 더 어둡게, 아직 진행
  // 중인(응답대기·성사) 너 나와는 더 밝게 해서 목록에서 한눈에 구분되게 한다(요청).
  const isEnded = challenge.status === "done" || challenge.status === "discarded";

  return (
    <div className={cx("scr-challenge-card", isEnded ? "scr-challenge-card-ended" : "scr-challenge-card-active", challenge.matchType === "0102" && "scr-challenge-card-team")}>
      {/* 응답 전 취소(아무도 응답 안 하고 폐기)된 건은 휴지통에서 우상단에 "취소" 라벨로
          표시한다(요청). 거절/버림/미실시와는 응답·결과 유무로 구분된다. */}
      {isCanceled && <span className="scr-challenge-cancel-tag">취소</span>}
      <div className="scr-challenge-card-body">
        {/* 내용은 페이드 없이 즉시 교체, 패널은 높이만 모핑(위 useLayoutEffect가 실측
            높이를 인라인으로 박고 CSS transition이 애니메이션)한다. 마감 카운트다운/승리
            배지는 이미 있는 줄(날짜 줄, 화살표 옆)에 끼워 넣어 새 줄을 만들지 않는다.
            이전/다음 버튼은 "내용"이 아니라 카드 패딩에 얹히는 컨트롤이라 이 안(.scr-
            challenge-page, 페이지 전환마다 통째로 바뀌는 영역)이 아니라 .scr-challenge-
            card-body의 형제로 한 번만 둔다(요청: "이동 버튼은 scr-challenge-page 안에
            있으면 안돼") — .scr-challenge-pages 안에 두면 높이 모핑용 overflow:hidden에
            버튼이 그대로 잘려서 안 보이는 문제가 있었다(overflow-x:visible은 스펙상
            overflow-y가 hidden이면 auto로 바뀌어 실제로는 안 잘리지 않는다 — 여전히
            스크롤 클리핑 대상이라 버튼이 사라지고, 그 스크롤 트랙이 "이상한 줄"로 보였다).
            자세한 배치는 아래 buttons 참고. */}
        <div
          className="scr-challenge-pages"
          style={pagesHeight !== undefined ? { height: pagesHeight } : undefined}
        >
          <div ref={pagesInnerRef} className="scr-challenge-page">
            {whenHasContent && (
            <div className="scr-challenge-card-row scr-challenge-card-when">
              {/* 체인 라벨 — 이 페이지가 리벤지(설욕전) 기록이면 표시한다. 체인은 이제 리벤지
                  하나뿐이라, 원본(첫 페이지)을 뺀 모든 페이지가 리벤지다(isRevengePage). */}
              {isRevengePage && (
                <span className="scr-challenge-chain-tag scr-challenge-chain-tag-revenge">리벤지</span>
              )}
              {/* 이긴 편은 매치업의 화살표 옆에 배지로 표시하니, 여기선 팀을 특정할 수 없는
                  무승부만 알약으로 남긴다(요청: "도전자편 승 이런 건 제거"). 미실시는 아예
                  매치가 안 열렸으니 결과보기 자리에 텍스트로만 남기고 이 알약은 없앤다
                  (요청: "현재 시각 옆의 미실시 배지는 삭제"). */}
              {activePage.resultWinnerSide === "draw" && (
                <span className="scr-challenge-pill scr-challenge-pill-done">무승부</span>
              )}
              {/* 마감 카운트다운 — 별도 줄 대신 날짜가 있는 이 맨 윗줄에 끼운다(요청: "마감
                  카운트다운은 날짜있는 맨 윗줄에 표시"). 응답대기중은 항상 최신 페이지에서만
                  해당하니 다른 페이지에는 자리를 예약할 필요가 없다(이 줄은 원래도 페이지마다
                  내용이 들쑥날쑥한 줄이라 굳이 안 맞춰도 된다). */}
              {shownLatest && challenge.status === "pending" && (
                <span className="scr-challenge-countdown">{responseDeadlineLabel(challenge.createdAt, challenge.scheduledAt)}</span>
              )}
              {/* "결과 보기" 버튼은 없앴다(요청) — 그 자리에 상태 배지를 둔다. 승패가 입력되면
                  "완료", 예정 일시가 지났는데 아직 결과가 없으면 "결과 입력 대기". 무승부는
                  무승부 알약으로, 미실시는 "미실시" 텍스트로 각각 따로 표시한다. */}
              {isResultPending && (
                <span className="scr-challenge-pill scr-challenge-pill-wait">결과 입력 대기</span>
              )}
              {isDoneWin && (
                <span className="scr-challenge-pill scr-challenge-pill-done">완료</span>
              )}
              {shownLatest && challenge.resultWinnerSide === "not_held" && (
                <span className="scr-challenge-result-link scr-challenge-result-link-static">미실시</span>
              )}
            </div>
            )}

            <div className="scr-challenge-matchup">
              <ChallengeSide people={creatorSideMembers} highlightMemberIds={highlightMemberIds} />
              {/* 승/무 배지 — 이긴 편 쪽으로(손 이모지 기준 이긴 편이 있는 방향에) 붙인다
                  (요청: "승리배지는 손 이모지 옆에 표시(이긴쪽에)"). 자리가 좁아 "승리"
                  대신 한 글자만(요청: "좁아서 그냥 승/무 한글자 배지로 표시해야할듯").
                  무승부는 어느 한쪽 편이 아니라 양쪽 다 표시한다. 양쪽 다 자리를 항상
                  예약해 두고 해당 안 되는 쪽만 투명하게(visibility:hidden) — 안 그러면
                  페이지를 넘길 때 배지 유무에 따라 손 이모지가 좌우로 흔들린다(요청:
                  "손이모지 양옆에도 승리/무승부 배지 넣을 공간 예약해야함"). */}
              <span className="scr-challenge-arrow-row">
                <span
                  className={cx(
                    "scr-challenge-inline-win",
                    activePage.resultWinnerSide !== "creator" && activePage.resultWinnerSide !== "draw"
                      && "scr-challenge-inline-win-hidden",
                  )}
                >
                  {activePage.resultWinnerSide === "draw" ? "무" : "승"}
                </span>
                <span className="scr-challenge-arrow" aria-hidden="true">👉🏻</span>
                <span
                  className={cx(
                    "scr-challenge-inline-win",
                    activePage.resultWinnerSide !== "target" && activePage.resultWinnerSide !== "draw"
                      && "scr-challenge-inline-win-hidden",
                  )}
                >
                  {activePage.resultWinnerSide === "draw" ? "무" : "승"}
                </span>
              </span>
              <ChallengeSide people={targetSideMembers} targets={activeTargetInfos} highlightMemberIds={highlightMemberIds} />
            </div>

            {/* 한마디 — 호출자의 한마디(challenge.message)와 각 대상의 응답 한마디를 카드에
                보여준다(요청). 따옴표 없이, 본문보다 한 스텝 작게. */}
            {(challenge.message || activePage.targets.some((t) => t.responseMessage)) && (
              <div className="scr-challenge-card-msgs">
                {challenge.message && (
                  <div className="scr-challenge-card-msg">
                    <span className="scr-challenge-card-msg-who">{challenge.createdBy.nickname}</span>
                    <span className="scr-challenge-card-msg-text">{challenge.message}</span>
                  </div>
                )}
                {activePage.targets.filter((t) => t.responseMessage).map((t) => (
                  <div key={t.memberId} className="scr-challenge-card-msg">
                    <span className="scr-challenge-card-msg-who">{t.nickname}</span>
                    <span className="scr-challenge-card-msg-text">{t.responseMessage}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {err && <div className="scr-err">{err}</div>}

      {/* 응답 버튼(수락/거절) — 최신 페이지에서만 실제로 뜨지만, 이력 페이지에선 자리를
          예약(reserve)만 하고 투명하게 둬서 아래 페이지네이션이 안 튀게 한다. 읽기 전용
          (버려진 도전장 모달)에서는 어떤 액션도 없다. */}
      {!readOnly && canRespond && (
        <InlineCollapse open={mode === "none"}>
        <div className={cx("scr-challenge-respond", !isLatestPage && "scr-challenge-card-actions-reserve")}>
          {/* 응답 한마디(선택) — 아이콘 버튼을 누르면 입력창이 트랜지션으로 열린다(요청). */}
          <button
            type="button"
            className={cx("scr-challenge-msg-toggle", respondMsgOpen && "scr-challenge-msg-toggle-on")}
            onClick={() => setRespondMsgOpen((v) => !v)}
            aria-expanded={respondMsgOpen}
          >
            <MessageSquarePlus size={13} /> 응답 메시지{respondMessage.trim() && !respondMsgOpen ? ` · ${respondMessage.trim()}` : ""}
          </button>
          <div className={cx("scr-challenge-msg-wrap", respondMsgOpen && "scr-challenge-msg-wrap-open")}>
            <div className="scr-challenge-msg-inner">
              <input
                className="scr-input"
                value={respondMessage}
                onChange={(e) => setRespondMessage(e.target.value.slice(0, 50))}
                placeholder="응답 메시지 (선택, 최대 50자)"
                maxLength={50}
              />
            </div>
          </div>
          <div className="scr-challenge-card-actions">
          <button
            className="scr-btn scr-challenge-reject-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("rejected")}
          >
            거절
          </button>
          <button
            className="scr-btn scr-challenge-accept-btn scr-btn-sm" disabled={busy}
            onClick={() => {
              // 시간이 아직 안 정해진 도전장이면(요청자가 "상대가 정해도 된다"로 보낸 경우)
              // 인라인 폼을 열어 날짜/시간을 받는다. 이미 정해졌으면 바로 승락한다.
              if (challenge.scheduledAt === null) startScheduling();
              else respond("accepted");
            }}
          >
            {busy ? <Spinner /> : "승락"}
          </button>
          </div>
        </div>
        </InlineCollapse>
      )}

      {/* 인라인 폼들(승락 시간지정/리벤지/결과입력) — 조건부 마운트 대신 InlineCollapse로
          늘 마운트해 두고 열림/닫힘 모두 부드럽게 접었다 편다(요청: "트랜지션을 지금보다
          길고 부드럽게, 취소로 원복될 때도"). */}
      <InlineCollapse open={mode === "schedule"}>
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">
            시간을 정하거나, 비워두면 시간 미정으로 수락돼요 (완료할 때 그 시각으로 기록).
          </p>
          <OptionalDateTimeFields
            dateStr={dateStr} onDateChange={setDateStr}
            timeStr={timeStr} onTimeChange={setTimeStr}
          />
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
            <button
              className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={acceptWithSchedule}
              disabled={busy}
            >
              {busy ? <Spinner /> : (dateStr ? "승락" : "시간 미정 승락")}
            </button>
          </div>
        </div>
      </InlineCollapse>

      <InlineCollapse open={mode === "revenge"}>
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">
            리벤지를 신청해요 — 이번엔 상대가 시간을 정하게 하려면 일시를 비워두세요.
          </p>
          <div className="scr-challenge-datetime">
            <input
              type="date" className="scr-input" value={dateStr}
              min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(""); }}
            />
            <input
              type="time" className="scr-input" value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              disabled={!dateStr}
            />
          </div>
          {/* 리벤지 한마디(선택) — 응답 한마디와 같은 아이콘 토글 + 트랜지션 입력창(요청). */}
          <button
            type="button"
            className={cx("scr-challenge-msg-toggle", revengeMsgOpen && "scr-challenge-msg-toggle-on")}
            onClick={() => setRevengeMsgOpen((v) => !v)}
            aria-expanded={revengeMsgOpen}
          >
            <MessageSquarePlus size={13} /> 신청 메시지{revengeMessage.trim() && !revengeMsgOpen ? ` · ${revengeMessage.trim()}` : ""}
          </button>
          <div className={cx("scr-challenge-msg-wrap", revengeMsgOpen && "scr-challenge-msg-wrap-open")}>
            <div className="scr-challenge-msg-inner">
              <input
                className="scr-input"
                value={revengeMessage}
                onChange={(e) => setRevengeMessage(e.target.value.slice(0, 50))}
                placeholder="신청 메시지 (선택, 최대 50자)"
                maxLength={50}
              />
            </div>
          </div>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={submitRevenge} disabled={busy}>
              {busy ? <Spinner /> : "리벤지 신청"}
            </button>
          </div>
        </div>
      </InlineCollapse>

      <InlineCollapse open={mode === "result"}>
        <div className="scr-challenge-result-form">
          <p className="scr-challenge-inbox-message">
            승리한 팀을 눌러주세요 — 먼저 입력하는 쪽이 그대로 인정돼요.
          </p>
          {/* 구성원을 그대로 보여주고 팀 카드를 눌러 승리팀을 고른다(요청: "구성원이 노출되고
              승리팀을 고르는게 좋을듯"). */}
          <div className="scr-challenge-result-teams">
            <button
              type="button" className="scr-challenge-result-team" onClick={() => submitResult("creator")}
              disabled={busy}
            >
              <span className="scr-challenge-result-team-label">도전자편</span>
              <span className="scr-challenge-result-team-members">
                {creatorSideMembers.map((p) => (
                  <span key={p.id} className="scr-challenge-result-member">
                    <Avatar member={p} size={20} />
                    <span className="scr-challenge-result-member-name">{p.nickname}</span>
                  </span>
                ))}
              </span>
              <span className="scr-challenge-result-team-win">승리</span>
            </button>
            <button
              type="button" className="scr-challenge-result-team" onClick={() => submitResult("target")}
              disabled={busy}
            >
              <span className="scr-challenge-result-team-label">상대편</span>
              <span className="scr-challenge-result-team-members">
                {targetSideMembers.map((p) => (
                  <span key={p.id} className="scr-challenge-result-member">
                    <Avatar member={p} size={20} />
                    <span className="scr-challenge-result-member-name">{p.nickname}</span>
                  </span>
                ))}
              </span>
              <span className="scr-challenge-result-team-win">승리</span>
            </button>
          </div>
          {/* 승패가 없는 결과(요청: "무승부나 미실시도 있게 해주고"). */}
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => submitResult("draw")} disabled={busy}>
              무승부
            </button>
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => submitResult("not_held")} disabled={busy}>
              미실시
            </button>
          </div>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
          </div>
          {busy && <div className="scr-challenge-result-busy"><Spinner /></div>}
        </div>
      </InlineCollapse>

      {/* 결과 입력/리벤지 — 인라인 폼이 안 열려 있을 때만 뜨는 액션 줄. 응답 버튼과 마찬가지로
          이력 페이지에선 자리만 예약(투명)해 페이지네이션이 안 튀게. (취소/연기/재신청 제거됨)
          이 줄도 InlineCollapse로 감싸 폼이 열릴 땐 부드럽게 접히고, 취소로 폼이 접힐 땐
          부드럽게 되살아난다(요청: 원복 트랜지션). */}
      {!readOnly && (canEnterResult || canRevenge) && (
        <InlineCollapse open={mode === "none"}>
          <div className={cx("scr-challenge-card-actions", !isLatestPage && "scr-challenge-card-actions-reserve")}>
            {canEnterResult && (
              <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={startResult} disabled={busy}>
                결과 입력
              </button>
            )}
            {canRevenge && (
              <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={startRevenge} disabled={busy}>
                리벤지 신청
              </button>
            )}
          </div>
        </InlineCollapse>
      )}

      {/* 페이징 있는 카드는 지금 보는 페이지의 일시를 페이지네이션 바로 위에 상대표기로
          보여준다(요청: "날짜와 시간을 페이지네이션 바로 위에 '1개월 23일 전 오후 7시 10분'
          이런식으로"). 카드 시각을 목록 헤더로 옮긴 뒤라, 이력 페이지의 그때 일시를 여기서
          짚어준다. */}
      {pages.length > 1 && (
        <div className="scr-challenge-page-when">{formatRelativeSchedule(activePage.scheduledAt)}</div>
      )}

      {/* 이전 기록 탐색 — 카드 "맨 하단"(버튼 로우보다 아래)에 [◀ 1/3 ▶] 한 줄로(요청:
          "페이지네이션 버튼 로우보다 하단에 배치"). 버튼 로우는 이력 페이지에서도 자리를
          예약(scr-challenge-card-actions-reserve)하므로 페이지를 넘겨도 이 줄이 위아래로
          안 움직인다. 이력이 여러 개(pages>1)일 때만 뜬다. 맨앞/맨뒤에선 해당 화살표만
          투명하게 처리해 숫자가 안 흔들린다. */}
      {pages.length > 1 && (
        <div className="scr-challenge-page-nav-bar">
          <button
            type="button"
            className={cx("scr-challenge-page-nav scr-challenge-page-nav-prev", pageIndex === 0 && "scr-challenge-page-nav-hidden")}
            onClick={() => setPageIndex((i) => i - 1)} disabled={pageIndex === 0}
            aria-label="이전 기록 보기"
          />
          <span className="scr-challenge-page-count">{pageIndex + 1}/{pages.length}</span>
          <button
            type="button"
            className={cx(
              "scr-challenge-page-nav scr-challenge-page-nav-next",
              pageIndex === pages.length - 1 && "scr-challenge-page-nav-hidden",
            )}
            onClick={() => setPageIndex((i) => i + 1)} disabled={pageIndex === pages.length - 1}
            aria-label="다음 기록 보기"
          />
        </div>
      )}

      {/* 카드에서 수락/거절/설욕전 신청을 하면 뜨는 확인창 — 인박스와 똑같이 카카오 공유를
          권한다(요청). 확인을 눌러야 목록이 갱신된다(dismissShare). */}
      {sharePrompt && createPortal(
        <div className="scr-modal-overlay">
          <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
            <div className="scr-modal-body scr-challenge-sent">
              <div className="scr-challenge-sent-title">{sharePromptTitle}</div>
              <div className="scr-challenge-sent-desc">{sharePromptDesc}</div>
              <div className="scr-form-actions scr-challenge-sent-actions">
                <KakaoShareButton variant="full" content={buildShareContent} />
                <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={dismissShare}>확인</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// "수락만"은 켜고 끄는 하나짜리 조건이라, 모바일에서 폭을 아끼려고 탭 대신 체크박스 하나로
// 둔다(요청: "필터를 수락만으로 변경하고 수락한 건들만 노출"). 평소 목록은 상태와 무관하게
// 하나로 합쳐 보여주고, 이 체크박스를 켜면 성사된(confirmed) 너 나와만 남긴다.


// 폐기(휴지통)된 건 — 본 목록에서는 감추고 "휴지통" 모달에만 보여준다. 서버가 거절·무응답·
// 미실시·(레거시)취소를 모두 status="discarded"로 확정해 내려주므로 그것만 보면 된다.
function isDiscarded(c: Challenge): boolean {
  return c.status === "discarded";
}

// 순수 날짜(예정 일시) 오름차순(과거→미래) 한 줄로 정렬한다. 예정 일시가 없는 건(=아직
// 응답 대기중인 일정 미정)은 날짜로 자리를 정할 수 없어 맨 뒤에 둔다(요청: "일정 미정인
// 건들은 목록 맨 마지막에 있어야 돼(항상 보임)") — "종료된" 섹션 접힘 여부는 이제 정렬
// 순서가 아니라 실제 상태(status==="done")로만 가른다(아래 endedList/activeList 참고).
// 우측 타임라인의 스크롤 스냅은 "오늘" 그룹만 스냅 타깃이라(global.css의 .scr-snap-today)
// 미정 그룹 위치가 바뀌어도 영향 없다. 일시가 같거나 둘 다 미정이면 최근 생성 순으로 가른다.
function compareChallenges(a: Challenge, b: Challenge): number {
  const aNull = !a.scheduledAt;
  const bNull = !b.scheduledAt;
  if (aNull && bNull) return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt! > b.scheduledAt! ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

// 시각 헤더(scr-challenge-time-head)는 같은 시각의 카드들 맨 위에 한 번만 뜨는데, 진행중
// (성사)인 너 나와는 그 시각 옆에 연필 아이콘으로 일시를 바로 수정할 수 있다(요청: "너나와
// 목록에서 진행중인건은 날짜와 시간 수정이 가능하게할거야, 시간 옆에 연필모양 아이콘 추가,
// 권한은 참가자 또는 운영자는 가능하게"). 같은 시각에 서로 다른 너 나와가 여럿 묶이면(드묾)
// 어느 것을 수정할지 모호해지므로, 그 시각 그룹에 너 나와가 정확히 하나일 때만 연필을
// 보여준다 — 호출부(groupByTime map)에서 tg.items.length===1일 때만 이 컴포넌트를 쓴다.
function ChallengeTimeHeadEdit({
  challenge, timeLabel, myId, isAdmin, onUpdated,
}: {
  challenge: Challenge; timeLabel: string; myId: string | undefined; isAdmin: boolean;
  onUpdated: (updated: Challenge) => void;
}) {
  const isParticipant =
    challenge.createdBy.id === myId
    || challenge.ownMembers.some((m) => m.memberId === myId)
    || challenge.targets.some((t) => t.memberId === myId);
  const canEdit = challenge.status === "confirmed" && (isParticipant || isAdmin);

  const [editing, setEditing] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const startEdit = () => {
    if (challenge.scheduledAt) {
      const d = new Date(challenge.scheduledAt);
      setDateStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setTimeStr(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setErr("");
    setEditing(true);
  };

  const save = async () => {
    if (!dateStr) { setErr("날짜를 선택하세요."); return; }
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = new Date(`${dateStr}T${timeStr || DEFAULT_CHALLENGE_TIME}`).toISOString();
      const updated = await api.rescheduleChallenge(challenge.id, scheduledAt);
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "일정을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 연필을 누르면(라벨 줄 ↔ 수정 폼) 내용이 바뀌는 만큼 자리를 즉시 뺏는 대신, 실측 높이를
  // 인라인으로 박고 CSS transition으로 모핑한다(요청: "연필 누르면 공간이 자연스럽게
  // 확보되는 영역 트랜스폼") — ChallengeCard의 페이지 높이 모핑과 같은 패턴.
  const innerRef = useRef<HTMLDivElement>(null);
  const [wrapHeight, setWrapHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setWrapHeight(inner.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [editing]);

  return (
    <div
      className="scr-challenge-time-head-wrap"
      style={wrapHeight !== undefined ? { height: wrapHeight } : undefined}
    >
      <div ref={innerRef}>
        {editing ? (
          <div className="scr-challenge-time-edit-form">
            {/* 날짜/시간/취소/확인을 한 줄로(요청) — 큰 폼용 OptionalDateTimeFields 대신
                이 자리 전용의 좁은 인라인 입력을 쓴다. */}
            <div className="scr-challenge-time-edit-row">
              <input
                type="date" className="scr-input scr-challenge-time-edit-input"
                value={dateStr}
                min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateStr(v);
                  // 날짜를 지우면 시간도 비우고, 날짜를 고르는데 시간이 비어 있으면 기본 시간(21시)으로
                  // 자동으로 채운다(요청).
                  if (!v) setTimeStr("");
                  else if (!timeStr) setTimeStr(DEFAULT_CHALLENGE_TIME);
                }}
              />
              <input
                type="time" className="scr-input scr-challenge-time-edit-input"
                value={timeStr} onChange={(e) => setTimeStr(e.target.value)} disabled={!dateStr}
              />
              <button type="button" className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setEditing(false)} disabled={busy}>
                취소
              </button>
              <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={save} disabled={busy}>
                {busy ? <Spinner /> : "확인"}
              </button>
            </div>
            {err && <div className="scr-err">{err}</div>}
          </div>
        ) : (
          <div className="scr-challenge-time-head">
            <span className="scr-challenge-time-head-label">{timeLabel}</span>
            {canEdit && (
              <button
                type="button" className="scr-challenge-time-edit-btn"
                onClick={startEdit} aria-label="일시 수정"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 도전장("너 나와!") 게시판 — 경기결과/예약 시스템과는 독립적인 별도 게시판이라, 화면 자체도
// 기간 필터 없이 전체 목록을 그대로 보여준다.
export default function ChallengeScreen() {
  const user = useAppStore((s) => s.user);
  const isAdmin = isAdminRole(user?.roles ?? []);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  // 카운트다운(응답 마감)과 완료/무응답취소 같은 시간 기반 파생 상태를 1분마다 다시 그린다 —
  // 카드들은 렌더 시점의 Date.now()로 계산하므로 부모가 다시 그려지면 자연히 갱신된다.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getChallenges()
      .then((res) => setChallenges(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // 결과 입력 팝업(앱 부팅 시 뜨는 전역 팝업, ChallengeResultInboxModal)은 이 화면이 이미
  // 떠 있는 동안에도 열릴 수 있는데, 거기서 결과를 입력해도 이 화면이 이미 불러와 둔
  // 목록엔 반영이 안 된다 — 신고: "결과 입력 팝업창에서 입력했는데 너 나와 페이지에
  // 아직도 결과입력 버튼이 보이는 경우가 있다고(새로고침 문제일까?)". 팝업 큐가 (하나
  // 이상 있다가) 비워지는 순간을 "닫혔다/다 처리했다"로 보고 조용히 다시 불러온다 —
  // load()처럼 로딩 스피너로 갈아치우면 스크롤 위치가 튀니 목록만 바꿔치기한다.
  const resultInboxChallenges = useAppStore((s) => s.resultInboxChallenges);
  const prevResultInboxLenRef = useRef(resultInboxChallenges.length);
  useEffect(() => {
    const prevLen = prevResultInboxLenRef.current;
    prevResultInboxLenRef.current = resultInboxChallenges.length;
    if (prevLen > 0 && resultInboxChallenges.length === 0) {
      api.getChallenges().then((res) => setChallenges(res.items)).catch(() => {});
    }
  }, [resultInboxChallenges]);

  // 재신청/설욕전은 같은 행을 고쳐 쓰지 않고 새 id로 새 도전장을 만든다 — 그 응답(updated)의
  // reappliedFromId가 채워져 있으면, 목록에서 그 원래 도전장은 지우고 새 도전장으로 바꿔
  // 끼운다. 다른 액션(승락/거절/취소/결과입력/연기 등)은 reappliedFromId가 없으니 이 필터는
  // 그냥 아무 일도 안 한다.
  const upsert = (updated: Challenge) => {
    setChallenges((prev) => {
      // 취소된 도전장도 이제 목록에 남는다(요청: "취소된 도전장도 노출") — 제거하지 않고
      // 그 자리에서 상태만 갱신한다.
      const withoutSuperseded = updated.reappliedFromId != null
        ? prev.filter((c) => c.id !== updated.reappliedFromId)
        : prev;
      const exists = withoutSuperseded.some((c) => c.id === updated.id);
      return exists
        ? withoutSuperseded.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...withoutSuperseded];
    });
  };

  // 너 나와! 목록은 필터/검색 없이 항상 전체를 조회한다(요청: "검색창도 제거", "무조건 전체").
  // "기록" 메뉴는 폐지하고 완료된 너 나와도 같은 목록에 합친다(요청: "기록 메뉴 제거 및 원래
  // 목록에 통합. 결과적으로 너 나와! 목록은 1개만 존재") — 폐기(휴지통)된 건만 뺀다.
  const unifiedList = useMemo(
    () => challenges.filter((c) => !isDiscarded(c)).sort(compareChallenges),
    [challenges],
  );

  // "종료된"은 정렬 순서가 아니라 실제 상태로만 가른다 — 결과가 입력된(승/무/미실시*)
  // status==="done" 건만 접어 넣는다(*미실시는 서버가 discarded로 확정해 내려오므로
  // 여기엔 안 잡힌다, isDiscarded로 이미 걸러짐). 응답대기(미정 포함)·성사(예정)는 상태와
  // 무관하게 항상 보이는 목록에 남는다(요청: "종료된 너 나와에는 실제 완료된 애들만 들어가
  // 있고 일정 미정인 건들은 목록 맨 마지막에 있어야 돼(항상 보임)").
  const endedList = useMemo(() => unifiedList.filter((c) => c.status === "done"), [unifiedList]);
  const activeList = useMemo(() => unifiedList.filter((c) => c.status !== "done"), [unifiedList]);

  // "종료된 너 나와! 보기" 토글 — 누르면 접혀 있던 앞부분이 지금 보이는 목록 위로 나타난다.
  // 콘텐츠가 뷰포트 위쪽에 삽입되면 브라우저가 스크롤 위치(px)를 그대로 유지해 화면에 보이던
  // 내용이 아래로 밀려 보인다(요청: "스크롤이 튀지 않게 조심") — 토글 직전 스크롤 높이를
  // 기억해뒀다가, 다음 렌더 직후(레이아웃 반영 후) 늘어난/줄어든 높이만큼 스크롤 위치를 같이
  // 옮겨서 화면에 보이던 내용이 그 자리에 그대로 있는 것처럼 보이게 한다.
  const [showEnded, setShowEnded] = useState(false);
  const prevScrollHeightRef = useRef<number | null>(null);
  // 오늘 그룹 스크롤 스냅 활성화 판단에 콘텐츠 높이를 재려고 화면 컨테이너를 참조한다.
  const screenRef = useRef<HTMLDivElement>(null);
  const toggleShowEnded = () => {
    prevScrollHeightRef.current = getScrollMetrics().scrollHeight;
    setShowEnded((v) => !v);
  };
  useLayoutEffect(() => {
    const prevHeight = prevScrollHeightRef.current;
    if (prevHeight == null) return;
    prevScrollHeightRef.current = null;
    const delta = getScrollMetrics().scrollHeight - prevHeight;
    if (delta === 0) return;
    const root = getScrollRoot();
    if (root instanceof Window) {
      window.scrollTo({ top: window.scrollY + delta, behavior: "instant" as ScrollBehavior });
      return;
    }
    // #scroll-root엔 CSS scroll-behavior:smooth + scroll-snap(proximity)이 걸려 있어, 위치
    // 보정 뒤 스냅이 스무스하게 재정렬되며 "부드럽게 미끄러지는" 이동으로 보였다(요청:
    // "순간이동했으면 좋겠어"). 보정하는 짧은 동안 인라인으로 scroll-behavior:auto를 씌워
    // 보정과 그에 뒤따르는 스냅 재정렬까지 전부 즉시(순간이동)로 끝내고, 두 프레임 뒤에
    // 원래 스무스 동작으로 되돌린다.
    root.style.scrollBehavior = "auto";
    root.scrollTop += delta;
    requestAnimationFrame(() => requestAnimationFrame(() => { root.style.scrollBehavior = ""; }));
  }, [showEnded]);

  // 활성(응답대기·성사) 목록은 늘 보이고(activeList/endedList는 위에서 status로 이미
  // 갈랐다), 종료된 건 펼치기 전엔 감춘다. 펼치면 토글 버튼 '위'로 나타난다(요청: "버튼
  // 상단에 과거 목록이 펼쳐지고") — 버튼이 종료/활성 사이의 구분선 역할을 한다.
  const renderChallengeList = (items: typeof unifiedList) => (
    <div className="scr-challenge-list">
      {groupChallengesByDate(items).map((g) => (
        <Fragment key={g.label}>
          <div
            className="scr-challenge-date-group"
            data-today={g.isToday ? "1" : undefined}
          >
            <div className="scr-challenge-date-head" data-date-label={g.label}>
              {g.isToday && <span className="scr-challenge-card-today-tag">오늘</span>}
              {g.label}
            </div>
            {/* 날짜 안에서 다시 시각별로 묶어, 같은 시각 카드들 맨 위에 시간을 한 번만
                보여준다(요청). NEXT 배지는 폐지됐다(요청: "NEXT 배지 제거"). */}
            {groupByTime(g.items).map((tg) => (
              <div key={tg.key} className="scr-challenge-time-group">
                {tg.timeLabel && (
                  // 시각 그룹에 너 나와가 정확히 하나일 때만 연필(일시 수정)을 보여준다
                  // (ChallengeTimeHeadEdit 주석 참고 — 여럿이면 어느 걸 고칠지 모호해서).
                  tg.items.length === 1 ? (
                    <ChallengeTimeHeadEdit
                      challenge={tg.items[0]} timeLabel={tg.timeLabel}
                      myId={user?.id} isAdmin={isAdmin} onUpdated={upsert}
                    />
                  ) : (
                    <div className="scr-challenge-time-head">
                      <span className="scr-challenge-time-head-label">{tg.timeLabel}</span>
                    </div>
                  )
                )}
                {tg.items.map((c) => (
                  <div key={c.id} className="scr-challenge-card-slot">
                    <ChallengeCard
                      challenge={c}
                      myId={user?.id}
                      onResponded={upsert}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );

  // 오늘 그룹 스크롤 스냅 — 목록이 짧을 땐 오늘로 끌어당기는 스냅이 오히려 걸리적거려서
  // (요청: "페이지 길이가 특정 길이 이상일 때만 활성화"), 스크롤할 거리가 한 화면분을
  // 넘게 넉넉할 때만 켠다. 데이터가 늦게 로드되거나 종료목록을 펼쳐 길이가 수시로 바뀔 수
  // 있어, 한 번 재고 마는 게 아니라 ResizeObserver로 콘텐츠/뷰포트 크기 변화를 계속 다시
  // 판단한다.
  useEffect(() => {
    // 문서 스크롤 전환 — 스냅 클래스/판정 기준이 #scroll-root에서 문서(html)로 옮겨졌다.
    const root = document.documentElement;
    const content = screenRef.current;
    if (!content) return;
    const apply = () => {
      const overflow = root.scrollHeight - root.clientHeight;
      root.classList.toggle("scr-snap-today", overflow > root.clientHeight);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(content);
    ro.observe(document.body);
    return () => {
      ro.disconnect();
      root.classList.remove("scr-snap-today");
    };
  }, []);

  const emptyLabel = "도전장이 없어요";

  return (
    <div className="scr-screen scr-challenge-screen-v2" ref={screenRef}>
      {/* "기록" 메뉴는 폐지됐다(요청) — 목록이 하나뿐이라 타이틀 툴바엔 더 이상 액션이
          없다. 너 나와! 신청 버튼은 타이틀 줄 아래 별도 줄에 가운데 정렬, 1.2배 확대(요청). */}
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">너 나와!</h1>
      </div>

      {/* nawa 자체가 버튼(요청) — 이미지 위에 흰 글씨 "호출하기" 라벨을 얹고, 눌리는 입체감을
          준다. 별도의 텍스트 버튼은 없앴다. */}
      <div className="scr-v2-primary-row scr-challenge-primary-row">
        <button
          type="button"
          className="scr-challenge-nawa-btn"
          onClick={() => setFormOpen(true)}
          aria-label="너 나와! 신청"
        >
          <img src="/images/items/nawa.jpg" alt="" className="scr-challenge-title-nawa" />
          <span className="scr-challenge-nawa-label">호출하기</span>
        </button>
      </div>

      {/* 최상단 너 나와! 신청 코너("보고싶은 너 나와!") — 지금은 숨김(요청). 다시 켜려면 아래
          주석을 해제한다. */}
      {/* <MatchRequestCorner /> */}

      {/* 목록 중타이틀 — 요청 코너와 실제 도전장 목록을 구분한다. */}
      <h2 className="scr-challenge-list-heading">너 나와! 목록</h2>

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : (
        <>
          {/* 종료된(과거) 너 나와는 펼쳤을 때만, 토글 버튼 '위'에 나타난다(요청). */}
          {showEnded && endedList.length > 0 && (
            <section className="scr-challenge-section scr-challenge-section-ended">
              {renderChallengeList(endedList)}
            </section>
          )}

          {/* 과거에 끝난 너 나와는 기본적으로 접혀 있고, 이 버튼이 종료/활성 목록 사이의
              구분선이 된다(요청) — 누르면 그 위로 펼쳐진다. 접을 게 없으면(끝난 건 0개)
              버튼 자체를 안 보여준다. */}
          {endedList.length > 0 && (
            <button type="button" className="scr-challenge-toggle-ended-link" onClick={toggleShowEnded}>
              {showEnded ? "종료된 너 나와! 접기" : "종료된 너 나와! 펼치기"}
            </button>
          )}

          <section className="scr-challenge-section">
            {activeList.length === 0 ? (
              <div className="scr-empty">{emptyLabel}</div>
            ) : (
              renderChallengeList(activeList)
            )}
          </section>
        </>
      )}

      {/* 우측 네비게이션 타임라인 — 스크롤 시에만 뜨고, 스스로 스크롤 불가 상태면 안 뜬다.
          너 나와는 과거(위)→미래(아래) 순이고, "오늘" 그룹에만 눈금을 찍는다(요청:
          "타임라인에 미정은 표시 X"). */}
      {!loading && (
        <ScrollNavTimeline
          headSelector=".scr-challenge-date-head"
          topLabel="과거"
          bottomLabel="미래"
          markers={[
            { key: "today", className: "scr-scroll-timeline-today", groupSelector: '.scr-challenge-date-group[data-today="1"]' },
          ]}
        />
      )}

      {formOpen && (
        <ChallengeFormModal
          onClose={() => setFormOpen(false)}
          onCreated={(c) => setChallenges((prev) => [c, ...prev])}
        />
      )}
    </div>
  );
}
