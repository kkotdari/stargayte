import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import FilterItem from "../../components/common/FilterItem";
import PillTabs from "../../components/common/PillTabs";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import TeamMatchesModal from "../../modals/TeamMatchesModal";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import {
  challengeDateGroupLabel, challengeTimeLabel, currentMonthValue, formatChallengeSchedule, fmt, isToday,
  monthInputToRange, pad,
} from "../../utils/date";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import type { Challenge, ChallengeSide, ChallengeStatus, ChallengeTarget, Member } from "../../types";

// 실제 서버 status(pending/confirmed/rejected/canceled) 외에, 화면에서만 판단하는 두 가지
// 파생 상태 — "완료"(예정 시간이 지난 승락 건, 요청: "완료 기준은 예정 시간이 지났을때
// 승락상태면 완료")와 "expired"(응답 기한 안에 응답이 없어 무응답으로 취소 처리 — 처음
// 3일에서 1일로 줄였다(요청: "응답가능시간 1일로 축소"), 프론트에서만 그렇게 분류) — 둘 다
// 서버 status는 그대로 두고(배치처리 없음) 조회 시점마다 다시 계산한다.
type ChallengeDisplayStatus = "pending" | "confirmed" | "done" | "rejected" | "canceled" | "expired";

const EXPIRE_MS = 24 * 60 * 60 * 1000;
// 남은 시간이 이보다 적으면 카운트다운을 경고색으로 — 마감 임박.
const DEADLINE_URGENT_MS = 12 * 60 * 60 * 1000;

// 도전장/재신청 체인 기록이 공통으로 갖는 최소 필드만 보면 파생 상태를 계산할 수 있다 —
// 살아있는 도전장(Challenge)과 이력 페이지(ChallengeHistoryEntry) 양쪽에 그대로 쓴다.
interface DisplayStatusInput {
  status: ChallengeStatus;
  scheduledAt: string | null;
  createdAt: string;
}

// 응답(무응답거절) 마감 시각(ms) — 예정 일시가 지정돼 있으면 그 시각이 곧 마감이고(요청:
// "예정 일시는 종료 시간으로 지정해줘"), 시간 미정이면 createdAt + 1일. 백엔드
// _response_deadline과 같은 규칙이라 프론트 파생 상태와 서버 배치가 어긋나지 않는다.
function responseDeadlineMs(c: DisplayStatusInput): number {
  return c.scheduledAt ? new Date(c.scheduledAt).getTime() : new Date(c.createdAt).getTime() + EXPIRE_MS;
}

function displayStatusOf(c: DisplayStatusInput): ChallengeDisplayStatus {
  if (c.status === "canceled") return "canceled";
  if (c.status === "rejected") return "rejected";
  if (c.status === "pending") {
    return Date.now() > responseDeadlineMs(c) ? "expired" : "pending";
  }
  // confirmed — 예정 시간이 있고 이미 지났으면 "완료", 아니면(미정 포함) 계속 "승락".
  if (c.scheduledAt && new Date(c.scheduledAt).getTime() < Date.now()) return "done";
  return "confirmed";
}

// 응답대기중 카드의 카운트다운 — 마감(예정 일시가 있으면 그 시각, 없으면 createdAt +
// 1일)까지 남은 시간을 "N일 N시간 남음"으로. 기한이 지나면 파생 상태가 expired로 넘어가
// 이 문구는 더 안 뜨지만, 경계에서 잠깐 음수가 될 수 있어 그 경우는 "곧 응답 마감"으로 대체한다.
function responseDeadlineLabel(c: DisplayStatusInput): { text: string; urgent: boolean } {
  const remain = responseDeadlineMs(c) - Date.now();
  if (remain <= 0) return { text: "곧 응답 마감", urgent: true };
  const totalMin = Math.floor(remain / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  const text = days > 0
    ? `응답 마감까지 ${days}일 ${hours}시간 남음`
    : hours > 0
      ? `응답 마감까지 ${hours}시간 ${mins}분 남음`
      : `응답 마감까지 ${mins}분 남음`;
  return { text, urgent: remain < DEADLINE_URGENT_MS };
}

// ISO 문자열을 <input type="date">/<input type="time"> 값으로 — 연기 폼의 기존 일시 프리필용.
function isoToInputs(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const sideLabel = (side: ChallengeSide): string => (side === "creator" ? "도전자편 승" : "상대편 승");

type PillTone = "pending" | "accepted" | "rejected" | "done" | "muted" | "expired";

// 상대 한 명의 응답 알약 — 개별 response뿐 아니라 카드 전체의 파생 상태까지 함께 봐서
// 문구를 정한다. 예: 팀전에서 한 명이 거절하면 그 순간 전체가 rejected로 끝나버리는데,
// 아직 응답을 안 한 나머지 상대는 raw response가 여전히 "pending"이라 그대로 "대기"라고
// 보여주면 마치 아직 진행 중인 것처럼 헷갈린다 — 그럴 땐 "무응답"으로 구분한다.
function targetPillInfo(t: ChallengeTarget, overall: ChallengeDisplayStatus): { label: string; tone: PillTone } {
  if (overall === "canceled") return { label: "취소", tone: "muted" };
  // 무응답 만료는 취소가 아니다 — 요청자가 재신청하라고 살려두는 상태라, 취소선 그은
  // 죽은 톤(muted) 대신 취소선 없는 앰버로 구분해 "아직 할 수 있다"는 느낌을 준다
  // (요청: "무응답 취소된 건은 재신청을 위해 보여주는건데.. 취소처럼 보여주지 말까").
  // 서버가 배치로 이미 무응답거절(rejected, 메시지 없음)로 확정하기 전의 짧은 순간
  // (아직 pending인데 마감이 지난)엔 이 파생 상태로 잡힌다 — 아래 rejected 분기와 같은 모양.
  if (overall === "expired") return { label: "무응답", tone: "expired" };
  if (t.response === "accepted") return overall === "done" ? { label: "완료", tone: "done" } : { label: "수락", tone: "accepted" };
  // 거절 중에서도 사람이 직접 거절한 건(한마디 있음)은 빨강 "거절", 서버 배치가 마감
  // 경과로 확정한 무응답거절(한마디 없음)은 앰버 "무응답"으로 가른다 — UI에서 직접
  // 거절할 땐 항상 한마디를 필수로 받으므로 "한마디 없는 거절 = 무응답"이 성립한다.
  if (t.response === "rejected") {
    return t.responseMessage ? { label: "거절", tone: "rejected" } : { label: "무응답", tone: "expired" };
  }
  if (overall === "rejected") return { label: "무응답", tone: "muted" };
  return { label: "응답대기중", tone: "pending" };
}

interface ChallengeDateGroup {
  label: string;
  isToday: boolean;
  items: Challenge[];
}

// 경기결과 화면처럼 날짜별로 묶어 보여준다(요청: "경기 화면처럼 날짜별로 그룹핑") —
// 넘어오는 목록은 이미 정렬돼 있어서 같은 날짜 라벨이 연속으로 나올 때만 묶으면 된다.
// 일정 미정 도전장은 "일정 미정" 하나로 모인다.
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

// 한마디/응답 메시지 — 카드에서는 2줄로 잘리는데, 길면 그 이상 읽을 방법이 없었다(요청:
// "마우스오버/클릭시 리플레이 툴팁같은 단순한 창으로 팝오버로 전체메시지를 다 볼수 있게") —
// ReplayLocationHint와 같은 패턴(attachPopover + 바깥 클릭/포커스이동 시 닫힘)으로 클릭하면
// 전체 텍스트를 팝오버로 보여준다. 내용이 없으면 그대로 정적인 div로 둔다.
function ChallengeMessage({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current || !popRef.current) return;
    return attachPopover(anchorRef.current, popRef.current, { growFromAnchor: true, maxWidth: 280 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  if (!text) return <div className="scr-challenge-side-message"> </div>;
  const quoted = `"${text}"`;

  return (
    <>
      <button
        type="button"
        className="scr-challenge-side-message-btn"
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        title="전체 메시지 보기"
      >
        <span className="scr-challenge-side-message">{quoted}</span>
      </button>
      {open && createPortal(
        <div className="scr-challenge-msg-pop" ref={popRef}>{quoted}</div>,
        document.body,
      )}
    </>
  );
}

type SideMember = { id: string; nickname: string; avatar: string | null };

// 팀 구성 한 편(도전자편/상대편)을 세로로 쌓는다(요청: "각팀을 세로로 배치") — 1:1이든
// 팀전이든 모양은 같고, 인원이 하나든 여럿이든 그냥 줄 수만 늘어난다.
function ChallengeSide({
  people, message, targets, highlightMemberIds,
}: {
  people: SideMember[];
  message?: string;
  targets?: { target: ChallengeTarget; overall: ChallengeDisplayStatus }[];
  // 유저 검색에 걸린 사람 — 경기결과 로스터와 같은 반전색으로 프사+닉네임을 함께 칠한다
  // (요청: "랭킹, 너 나와 유저 검색시 하이라이팅 추가 단! 닉네임뿐 아니라 프사까지").
  highlightMemberIds?: Set<string>;
}) {
  return (
    <div className={cx("scr-challenge-side", targets && "scr-challenge-side-target")}>
      {people.map((p, i) => {
        const t = targets?.[i];
        return (
          <div key={p.id} className="scr-challenge-side-block">
            <div className="scr-challenge-side-row">
              <span className={cx("scr-challenge-person", highlightMemberIds?.has(p.id) && "scr-challenge-person-hit")}>
                <Avatar member={p} size={24} />
                <span className="scr-challenge-person-name">{p.nickname}</span>
              </span>
              {t && (
                <span className={cx("scr-challenge-pill", `scr-challenge-pill-${targetPillInfo(t.target, t.overall).tone}`)}>
                  {targetPillInfo(t.target, t.overall).label}
                </span>
              )}
            </div>
            {targets && <ChallengeMessage text={t?.target.responseMessage} />}
            {/* 도전자편 한마디는 팀 전체 아래가 아니라 실제로 쓴 사람 — 도전자 본인,
                people의 첫 번째(creatorSideMembers가 [본인, ...팀원] 순) — 바로 아래에
                붙인다(요청: "팀전에서 도전자 한마디도 실제 입력한 사람 밑에 보이게"). */}
            {message !== undefined && i === 0 && <ChallengeMessage text={message} />}
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
  message: string;
  targets: ChallengeTarget[];
  status: ChallengeStatus;
  createdAt: string;
  resultWinnerSide: ChallengeSide | null;
  chainKind: "reapply" | "revenge" | null;
}

// 카드가 지금 어떤 인라인 폼을 펼치고 있는지 — 한 번에 하나만 열린다.
type CardMode = "none" | "schedule" | "reapply" | "revenge" | "postpone" | "result";

interface ChallengeCardProps {
  challenge: Challenge;
  myId: string | undefined;
  // 유저 검색에 걸린 사람들 — 카드 안 프사+닉네임을 반전색으로 칠한다.
  highlightMemberIds?: Set<string>;
  onResponded: (updated: Challenge) => void;
  onViewResults: (challenge: Challenge) => void;
}

function ChallengeCard({ challenge, myId, highlightMemberIds, onResponded, onViewResults }: ChallengeCardProps) {
  const memberOf = useAppStore((s) => s.memberOf);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const myTarget = challenge.targets.find((t) => t.memberId === myId);
  const isCreator = challenge.createdBy.id === myId;
  const inOwnTeam = challenge.ownMembers.some((m) => m.memberId === myId);
  // 이 대결의 참가자인지, 참가자라면 어느 편인지 — 결과 입력/설욕전/연기 노출 판정에 쓴다.
  const isParticipant = isCreator || inOwnTeam || !!myTarget;
  const mySide: ChallengeSide | null = isCreator || inOwnTeam ? "creator" : myTarget ? "target" : null;
  // 응답(ChallengeAuthor)엔 프사가 없어서(닉네임만) 로컬 회원 목록에서 찾아 보여준다 —
  // 지목된 상대(targets)는 서버가 프사까지 내려주니 그대로 쓴다.
  const creatorMember = memberOf(challenge.createdBy.id);

  const overall = displayStatusOf(challenge);
  const canRespond = !!myTarget && myTarget.response === "pending" && challenge.status !== "canceled";
  const canCancel = isCreator && challenge.status === "pending";
  // 재신청은 거절뿐 아니라 기한(1일) 무응답으로 만료된 도전장에도 허용한다(서버도 같은 기준).
  const canReapply = isCreator && (challenge.status === "rejected" || overall === "expired");
  // 예정 일시가 지난 확정 대결에서, 아직 결과가 안 들어왔으면 참가자가 결과를 입력한다.
  const schedulePassed = !!challenge.scheduledAt && new Date(challenge.scheduledAt).getTime() < Date.now();
  const canEnterResult = isParticipant && challenge.status === "confirmed" && schedulePassed && challenge.resultWinnerSide === null;
  // 결과가 입력됐고 내가 패배한 쪽이면 설욕전을 신청할 수 있다.
  const losingSide: ChallengeSide | null = challenge.resultWinnerSide === null
    ? null
    : challenge.resultWinnerSide === "creator" ? "target" : "creator";
  const canRevenge = challenge.resultWinnerSide !== null && mySide !== null && mySide === losingSide;
  // 확정된 대결은 예정 일시가 지난 뒤에도 참가자 누구나 연기할 수 있다.
  const canPostpone = isParticipant && challenge.status === "confirmed";

  // 재신청/설욕전 이력(오래된 순) 뒤에 지금 살아있는 도전장을 붙여 "페이지" 목록을 만든다 —
  // 기본으로는 맨 뒤(최신)를 보여준다. 이력이 없으면 페이지가 하나뿐이라 슬라이드 UI 자체가
  // 안 뜬다. pages.length는 이 카드가 떠 있는 동안 안 바뀐다(재신청/설욕전으로 이력이
  // 늘어나는 순간 새 id의 도전장으로 통째로 교체돼 이 카드는 언마운트된다).
  const pages: ChallengePage[] = useMemo(
    () => [
      ...challenge.history.map((h) => ({
        id: h.id, scheduledAt: h.scheduledAt, message: h.message, targets: h.targets,
        status: h.status, createdAt: h.createdAt, resultWinnerSide: h.resultWinnerSide, chainKind: h.chainKind,
      })),
      {
        id: challenge.id, scheduledAt: challenge.scheduledAt, message: challenge.message, targets: challenge.targets,
        status: challenge.status, createdAt: challenge.createdAt, resultWinnerSide: challenge.resultWinnerSide,
        chainKind: challenge.chainKind,
      },
    ],
    [challenge],
  );
  const [pageIndex, setPageIndex] = useState(pages.length - 1);
  const isLatestPage = pageIndex === pages.length - 1;
  const page = pages[pageIndex];
  const pageTimeLabel = isLatestPage
    ? (challengeTimeLabel(page.scheduledAt) ?? "시간 미정")
    : formatChallengeSchedule(page.scheduledAt);
  // 각 페이지의 파생 상태는 그 페이지 자신의 status/일시로 계산한다 — 최신 페이지는 지금
  // 실제 상태(overall)와 같고, 이력 페이지는 그 시점의 상태(거절/무응답취소/완료 등)가 된다.
  const pageOverall = displayStatusOf(page);
  const pageTargetInfos = page.targets.map((t) => ({ target: t, overall: pageOverall }));

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [mode, setMode] = useState<CardMode>("none");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");

  // 카드에서 바로 승락/거절 — OS 기본 prompt로 한마디를 받는다. 승락은 선택(요청: "승락시
  // 메시지 필수 아니게"), 거절은 필수다 — required가 그 둘을 가른다.
  const respond = async (response: "accepted" | "rejected", promptLabel: string, required: boolean) => {
    const input = window.prompt(promptLabel);
    if (input === null) return;
    const trimmed = input.trim();
    if (required && !trimmed) return;
    setErr("");
    setBusy(true);
    try {
      const updated = await api.respondToChallenge(challenge.id, response, trimmed || undefined);
      onResponded(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const startScheduling = () => { setMode("schedule"); setDateStr(""); setTimeStr(""); setMessage(""); };
  const startReapply = () => { setMode("reapply"); setDateStr(""); setTimeStr(""); setMessage(challenge.message); };
  const startRevenge = () => { setMode("revenge"); setDateStr(""); setTimeStr(""); setMessage(""); };
  const startPostpone = () => {
    setMode("postpone");
    const cur = isoToInputs(challenge.scheduledAt);
    setDateStr(cur.date);
    setTimeStr(cur.time);
  };
  const startResult = () => { setMode("result"); setErr(""); };
  const closeMode = () => setMode("none");

  const acceptWithSchedule = async () => {
    if (!dateStr || !timeStr) return;
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = new Date(`${dateStr}T${timeStr}`).toISOString();
      const updated = await api.respondToChallenge(challenge.id, "accepted", message.trim() || undefined, scheduledAt);
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setCancelConfirmOpen(false);
    setErr("");
    setBusy(true);
    try {
      const updated = await api.cancelChallenge(challenge.id);
      onResponded(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "취소하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 재신청/설욕전은 시간/메모 입력 폼이 같다 — 모드만 보고 어느 API를 부를지 가른다.
  // 재신청은 시간을 비우면 원래 도전장 값을 물려받고, 설욕전은 비우면 시간 미정(승리한
  // 쪽이 수락하며 정함)이 된다.
  const submitReapplyOrRevenge = async () => {
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || "00:00"}`).toISOString() : undefined;
      const payload = { scheduledAt, message };
      const updated = mode === "revenge"
        ? await api.requestRevenge(challenge.id, payload)
        : await api.reapplyChallenge(challenge.id, payload);
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : mode === "revenge" ? "설욕전을 신청하지 못했어요." : "재신청하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const postpone = async () => {
    if (!dateStr || !timeStr) return;
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = new Date(`${dateStr}T${timeStr}`).toISOString();
      const updated = await api.postponeChallenge(challenge.id, scheduledAt);
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "연기하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (winnerSide: ChallengeSide) => {
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

  const deadline = isLatestPage && overall === "pending" ? responseDeadlineLabel(challenge) : null;

  return (
    <div className="scr-challenge-card">
      <div className="scr-challenge-card-body">
        <div className="scr-challenge-card-row scr-challenge-card-when">
          {pageTimeLabel}
          {/* 체인 라벨 — 이 기록이 재신청/설욕전으로 만들어진 것이면 어느 쪽인지 표시. */}
          {page.chainKind && (
            <span className={cx("scr-challenge-chain-tag", `scr-challenge-chain-tag-${page.chainKind}`)}>
              {page.chainKind === "revenge" ? "설욕전" : "재신청"}
            </span>
          )}
          {/* 결과가 입력된 대결은 이긴 편을 알약으로 표시. */}
          {page.resultWinnerSide && (
            <span className="scr-challenge-pill scr-challenge-pill-done">{sideLabel(page.resultWinnerSide)}</span>
          )}
          {isLatestPage && challenge.status === "confirmed" && (
            <button type="button" className="scr-challenge-result-link" onClick={() => onViewResults(challenge)}>
              결과 보기
            </button>
          )}
        </div>

        <div className="scr-challenge-matchup">
          <ChallengeSide people={creatorSideMembers} message={page.message} highlightMemberIds={highlightMemberIds} />
          <span className="scr-challenge-arrow" aria-hidden="true">👉🏻</span>
          <ChallengeSide people={targetSideMembers} targets={pageTargetInfos} highlightMemberIds={highlightMemberIds} />
        </div>

        <div className={cx("scr-challenge-page-nav-row", pages.length > 1 && "scr-challenge-page-nav-row-active")}>
          {pages.length > 1 && (
            <>
              <button
                type="button" className="scr-challenge-page-nav scr-challenge-page-nav-prev"
                onClick={() => setPageIndex((i) => i - 1)} disabled={pageIndex === 0}
                aria-label="이전 기록 보기"
              >
                <ChevronLeft size={30} />
              </button>
              <div className="scr-challenge-page-dots">
                {pages.map((p, i) => (
                  <button
                    key={p.id} type="button"
                    className={cx("scr-challenge-page-dot", i === pageIndex && "scr-challenge-page-dot-active")}
                    onClick={() => setPageIndex(i)}
                    aria-label={`${i + 1}번째 기록 보기`}
                  />
                ))}
              </div>
              <button
                type="button" className="scr-challenge-page-nav scr-challenge-page-nav-next"
                onClick={() => setPageIndex((i) => i + 1)} disabled={pageIndex === pages.length - 1}
                aria-label="다음 기록 보기"
              >
                <ChevronRight size={30} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 응답대기중 카드에만 뜨는 마감 카운트다운 — 기한(1일) 무응답이면 자동으로 종료(expired)된다. */}
      {deadline && (
        <div className={cx("scr-challenge-countdown", deadline.urgent && "scr-challenge-countdown-urgent")}>
          {deadline.text}
        </div>
      )}

      {err && <div className="scr-err">{err}</div>}

      {isLatestPage && canRespond && mode === "none" && (
        <div className="scr-challenge-card-actions">
          <button
            className="scr-btn scr-challenge-reject-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("rejected", "거절 사유를 입력해 주세요 (필수)", true)}
          >
            거절
          </button>
          <button
            className="scr-btn scr-challenge-accept-btn scr-btn-sm" disabled={busy}
            onClick={() => {
              // 시간이 아직 안 정해진 도전장이면(요청자가 "상대가 정해도 된다"로 보낸 경우)
              // window.prompt 한 줄로는 날짜+시간을 못 받으니 인라인 폼을 연다.
              if (challenge.scheduledAt === null) startScheduling();
              else respond("accepted", "한마디를 입력해 주세요 (선택)", false);
            }}
          >
            {busy ? <Spinner /> : "승락"}
          </button>
        </div>
      )}

      {mode === "schedule" && (
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">
            아직 시간이 정해지지 않은 도전장이에요 — 승락하며 시간을 정해주세요.
          </p>
          <div className="scr-challenge-datetime">
            <input
              type="date" className="scr-input" value={dateStr}
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(""); }}
            />
            <input
              type="time" className="scr-input" value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              disabled={!dateStr}
            />
          </div>
          <input
            type="text" className="scr-input" value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="한마디 (선택)"
            maxLength={60}
          />
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
            <button
              className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={acceptWithSchedule}
              disabled={busy || !dateStr || !timeStr}
            >
              {busy ? <Spinner /> : "승락"}
            </button>
          </div>
        </div>
      )}

      {(mode === "reapply" || mode === "revenge") && (
        <div className="scr-challenge-time-change-form">
          {mode === "revenge" && (
            <p className="scr-challenge-inbox-message">
              설욕전을 신청해요 — 이번엔 상대가 시간을 정하게 하려면 일시를 비워두세요.
            </p>
          )}
          <div className="scr-challenge-datetime">
            <input
              type="date" className="scr-input" value={dateStr}
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(""); }}
            />
            <input
              type="time" className="scr-input" value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              disabled={!dateStr}
            />
          </div>
          <input
            type="text" className="scr-input" value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="한마디 (선택)"
            maxLength={60}
          />
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={submitReapplyOrRevenge} disabled={busy}>
              {busy ? <Spinner /> : mode === "revenge" ? "설욕전 신청" : "재신청"}
            </button>
          </div>
        </div>
      )}

      {mode === "postpone" && (
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">새 일시로 대결을 연기해요.</p>
          <div className="scr-challenge-datetime">
            <input
              type="date" className="scr-input" value={dateStr}
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(""); }}
            />
            <input
              type="time" className="scr-input" value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              disabled={!dateStr}
            />
          </div>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
            <button
              className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={postpone}
              disabled={busy || !dateStr || !timeStr}
            >
              {busy ? <Spinner /> : "연기"}
            </button>
          </div>
        </div>
      )}

      {mode === "result" && (
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">
            누가 이겼나요? — 먼저 입력하는 쪽이 그대로 인정돼요.
          </p>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => submitResult("creator")} disabled={busy}>
              도전자편 승
            </button>
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => submitResult("target")} disabled={busy}>
              상대편 승
            </button>
          </div>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={closeMode} disabled={busy}>취소</button>
          </div>
        </div>
      )}

      {/* 결과 입력/설욕전/연기/취소/재신청 — 인라인 폼이 안 열려 있을 때만 뜨는 액션 줄. */}
      {isLatestPage && mode === "none" && (canCancel || canReapply || canEnterResult || canRevenge || canPostpone) && (
        <div className="scr-challenge-card-actions">
          {canEnterResult && (
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={startResult} disabled={busy}>
              결과 입력
            </button>
          )}
          {canRevenge && (
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={startRevenge} disabled={busy}>
              설욕전 신청
            </button>
          )}
          {canPostpone && (
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={startPostpone} disabled={busy}>
              연기
            </button>
          )}
          {canCancel && (
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setCancelConfirmOpen(true)} disabled={busy}>
              도전장 취소
            </button>
          )}
          {canReapply && (
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={startReapply} disabled={busy}>
              재신청
            </button>
          )}
        </div>
      )}

      {cancelConfirmOpen && (
        <ConfirmDialog
          title="도전장을 취소할까요?"
          message="취소하면 되돌릴 수 없어요 — 다시 신청하려면 새로 보내야 해요."
          confirmLabel="취소하기"
          onConfirm={cancel}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      )}
    </div>
  );
}

// 필터는 전체/내것만 둘뿐이다(요청: "전체 / 내것만 두 개짜리 필터로 교체") — 예전의
// 확정/응답대기/종료 상태 탭은 없애고, 목록은 상태와 무관하게 하나로 합쳐 보여준다.
type ChallengeView = "all" | "mine";
const VIEW_OPTS: { value: ChallengeView; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "mine", label: "내것만" },
];

// 기간 필터 — 경기 화면과 같은 패턴(전체/월 + 월 선택기), 기본은 월(요청: "너나와에
// 기간 필터 추가 전체 월까지" + "기본은 월"). 경기 화면과 달리 "일" 단위까지는 안 쪼갠다.
type ChallengePeriodUnit = "all" | "month";
const PERIOD_UNIT_OPTS: { value: ChallengePeriodUnit; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];

// 더는 지켜볼 필요가 없는 종료 상태 — 거절/취소/무응답취소(만료)/완료.
function isEndedChallenge(c: Challenge): boolean {
  const s = displayStatusOf(c);
  return s === "rejected" || s === "canceled" || s === "expired" || s === "done";
}

// 단일 리스트 정렬. 먼저 "진행 중(응답 대기/예정)"을 "종료된 것"보다 항상 위에 둔다 —
// 안 그러면 시간을 안 정한 채(scheduledAt=null) 무응답으로 만료된 도전장이, 종료됐는데도
// "일정 미정"이라 계속 목록 맨 위에 박제된다(요청: "상대방이 시간 지정으로 보냈는데
// 무응답이면 시간이 없잖아.. 계속 일정 미정으로 위에 뜰텐데"). "일정 미정 최상단"이라는
// 규칙은 아직 살아있는(응답 대기) 도전장에만 의미가 있기 때문이다.
// 같은 그룹 안에서는 scheduledAt 내림차순(늦은 일시가 위), 일시 미정은 그 그룹 최상단,
// 일시가 같거나 둘 다 미정이면 최근 생성 순으로 가른다.
function compareChallenges(a: Challenge, b: Challenge): number {
  const aEnded = isEndedChallenge(a);
  const bEnded = isEndedChallenge(b);
  if (aEnded !== bEnded) return aEnded ? 1 : -1;
  const aNull = !a.scheduledAt;
  const bNull = !b.scheduledAt;
  if (aNull && bNull) return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  if (aNull) return -1;
  if (bNull) return 1;
  if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt! > b.scheduledAt! ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

// 도전장("너 나와!") 게시판 — 경기결과/예약 시스템과는 독립적인 별도 게시판이라, 화면 자체도
// 기간 필터 없이 전체 목록을 그대로 보여준다.
export default function ChallengeScreen() {
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);
  const memberOf = useAppStore((s) => s.memberOf);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ChallengeView>("all");
  const [periodUnit, setPeriodUnit] = useState<ChallengePeriodUnit>("month");
  const [periodMonth, setPeriodMonth] = useState(currentMonthValue);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

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

  // 재신청/설욕전은 같은 행을 고쳐 쓰지 않고 새 id로 새 도전장을 만든다 — 그 응답(updated)의
  // reappliedFromId가 채워져 있으면, 목록에서 그 원래 도전장은 지우고 새 도전장으로 바꿔
  // 끼운다. 다른 액션(승락/거절/취소/결과입력/연기 등)은 reappliedFromId가 없으니 이 필터는
  // 그냥 아무 일도 안 한다.
  const upsert = (updated: Challenge) => {
    setChallenges((prev) => {
      // 취소된 도전장은 서버 목록 조회에서도 아예 빠지므로(canceled_at 소프트 취소)
      // 로컬 목록에서도 그 자리에서 제거한다 — 끼워 넣으면 새로고침 전까지 "취소"
      // 카드가 남아 서버 목록과 어긋난다.
      if (updated.status === "canceled") return prev.filter((c) => c.id !== updated.id);
      const withoutSuperseded = updated.reappliedFromId != null
        ? prev.filter((c) => c.id !== updated.reappliedFromId)
        : prev;
      const exists = withoutSuperseded.some((c) => c.id === updated.id);
      return exists
        ? withoutSuperseded.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...withoutSuperseded];
    });
  };

  // 도전장에 관여된 사람(보낸 사람/지목된 상대/같은 팀) 중 검색어와 맞는 사람이 있으면 그
  // 도전장이 남는다 — 경기결과 화면의 참가자 검색과 같은 방식(AND: 검색어 전부가 각각 다른
  // 사람이어도 무방하게 누군가와는 맞아야 한다).
  const challengePersonMatchesTerm = (
    p: { memberId: string; nickname: string }, term: string,
  ): boolean => {
    const m = memberOf(p.memberId);
    if (m) return memberMatchesTerm(m, term);
    return p.nickname.toLowerCase().includes(term);
  };
  const challengeMatchesTerm = (c: Challenge, term: string): boolean => (
    challengePersonMatchesTerm({ memberId: c.createdBy.id, nickname: c.createdBy.nickname }, term)
    || c.targets.some((t) => challengePersonMatchesTerm(t, term))
    || c.ownMembers.some((m) => challengePersonMatchesTerm(m, term))
  );
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const searchedChallenges = useMemo(() => {
    if (searchTerms.length === 0) return challenges;
    return challenges.filter((c) => searchTerms.every((t) => challengeMatchesTerm(c, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- challengeMatchesTerm은 memberOf 참조 함수라 매 렌더 새로 만들어져도 무방(값 자체는 members로 충분히 표현됨)
  }, [challenges, searchTerms, members]);

  // 검색어에 걸린 사람들 — 남은 카드 안에서 누구 때문에 걸렸는지 프사+닉네임을 반전색으로
  // 짚어준다(랭킹 화면과 같은 방식, 요청: "랭킹, 너 나와 유저 검색시 하이라이팅 추가").
  const highlightMemberIds = useMemo(() => {
    const ids = new Set<string>();
    if (searchTerms.length === 0) return ids;
    members.forEach((m) => { if (searchTerms.some((t) => memberMatchesTerm(m, t))) ids.add(m.id); });
    return ids;
  }, [members, searchTerms]);

  // 기간 필터 — 월이면 예정 일시(scheduledAt)가 그 달에 속하는 것만. 일정 미정(응답 전
  // 시간 미정) 도전장은 특정 달에 속한다고 볼 수 없고 지금 진행 중인 건이라 항상 보여준다.
  const periodChallenges = useMemo(() => {
    if (periodUnit !== "month") return searchedChallenges;
    const { from, to } = monthInputToRange(periodMonth);
    return searchedChallenges.filter((c) => {
      if (!c.scheduledAt) return true;
      const d = fmt(new Date(c.scheduledAt));
      return d >= from && d <= to;
    });
  }, [searchedChallenges, periodUnit, periodMonth]);

  // 상태 구분 없이 하나의 목록으로 합치고 scheduledAt 내림차순으로 정렬한다.
  const sortedChallenges = useMemo(
    () => [...periodChallenges].sort(compareChallenges),
    [periodChallenges],
  );

  // "내것만" — 내가 보냈거나(창작자/같은 팀) 지목된(상대) 도전장만 남긴다.
  const isMine = (c: Challenge): boolean => (
    c.createdBy.id === user?.id
    || c.targets.some((t) => t.memberId === user?.id)
    || c.ownMembers.some((m) => m.memberId === user?.id)
  );
  const activeList = view === "mine" ? sortedChallenges.filter(isMine) : sortedChallenges;

  // 가장 가까운 예정된(수락) 대결 — 확정됐고 예정 일시가 아직 안 지난 것 중 가장 임박한
  // 것 하나. 카드 밖 좌상단에 NEXT 라벨을 달고, 화면 진입 시 그 카드로 스크롤한다(요청:
  // "너나와 진입시 가장 가까운 예정된(수락) 경기에 스크롤 및 해당 카드에 NEXT 문구 노출").
  const nextChallengeId = useMemo(() => {
    const now = Date.now();
    let bestId: number | null = null;
    let bestTime = Infinity;
    challenges.forEach((c) => {
      if (c.status !== "confirmed" || !c.scheduledAt) return;
      const t = new Date(c.scheduledAt).getTime();
      if (t < now || t >= bestTime) return;
      bestTime = t;
      bestId = c.id;
    });
    return bestId;
  }, [challenges]);
  const nextCardRef = useRef<HTMLDivElement | null>(null);
  // 진입 후 첫 로드가 끝났을 때 딱 한 번만 스크롤한다 — 이후 응답/재조회로 목록이 바뀌어도
  // 보던 위치를 뺏지 않는다. scrollIntoView는 #scroll-root의 CSS scroll-behavior:smooth를
  // 따라 부드럽게 이동한다. 가운데가 아니라 화면 맨 위에 오게 한다(요청: "next 대결
  // 스크롤은 가운데가 아니라 상단에 오게(위의 목록은 안보이는 정도로)") — 위쪽 여유는
  // .scr-challenge-card-slot의 scroll-margin-top이 살짝만 남긴다.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (loading || didAutoScrollRef.current || nextChallengeId === null) return;
    const el = nextCardRef.current;
    if (!el) return;
    didAutoScrollRef.current = true;
    el.scrollIntoView({ block: "start" });
  }, [loading, nextChallengeId]);

  // "결과 보기" — 랭킹 화면의 팀 경기 목록 모달을 그대로 재사용해 그 도전장의 팀 구성이 그
  // 날짜에 등록한 경기를 보여준다.
  const [resultsTarget, setResultsTarget] = useState<Challenge | null>(null);
  const resultsMembers: Member[] = useMemo(() => {
    if (!resultsTarget) return [];
    const ids = [resultsTarget.createdBy.id, ...resultsTarget.ownMembers.map((m) => m.memberId)];
    return ids.map((id) => memberOf(id)).filter((m): m is Member => !!m);
  }, [resultsTarget, memberOf]);
  const resultsDateStr = resultsTarget?.scheduledAt ? fmt(new Date(resultsTarget.scheduledAt)) : undefined;

  const emptyLabel = searchTerms.length > 0
    ? "검색 결과가 없어요"
    : view === "mine" ? "내 대결이 없어요" : "도전장이 없어요";

  return (
    <div className="scr-screen scr-challenge-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">너 나와!</h1>
        <div className="scr-v2-toolbar-actions">
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => setFormOpen(true)}>
            🕊️ 도전장 보내기
          </button>
        </div>
      </div>

      <SearchFilterBar
        count={activeList.length}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저"
        suggestions={suggestions}
        filterPanel={
          <>
            <FilterItem label="범위">
              <PillTabs options={VIEW_OPTS} value={view} onChange={setView} aria-label="전체/내것만 선택" />
            </FilterItem>
            <FilterItem label="기간">
              <PillTabs options={PERIOD_UNIT_OPTS} value={periodUnit} onChange={setPeriodUnit} aria-label="기간" />
            </FilterItem>
            {periodUnit === "month" && (
              <FilterItem>
                <input
                  type="month" className="scr-filter-month-input"
                  value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)}
                  aria-label="조회할 월"
                />
              </FilterItem>
            )}
          </>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : (
        <section className="scr-challenge-section">
          {activeList.length === 0 ? (
            <div className="scr-empty">{emptyLabel}</div>
          ) : (
            <div className="scr-challenge-list">
              {groupChallengesByDate(activeList).map((g) => (
                <div key={g.label} className="scr-challenge-date-group">
                  <div className="scr-challenge-date-head">
                    {g.isToday && <span className="scr-challenge-card-today-tag">오늘</span>}
                    {g.label}
                  </div>
                  {g.items.map((c) => (
                    // 슬롯 래퍼 — 가장 가까운 예정(수락) 대결에만 카드 밖 좌상단 NEXT
                    // 라벨을 달고, 진입 스크롤의 목적지가 된다.
                    <div
                      key={c.id}
                      ref={c.id === nextChallengeId ? nextCardRef : undefined}
                      className="scr-challenge-card-slot"
                    >
                      {c.id === nextChallengeId && <div className="scr-challenge-next-tag">NEXT</div>}
                      <ChallengeCard
                        challenge={c}
                        myId={user?.id}
                        highlightMemberIds={highlightMemberIds}
                        onResponded={upsert}
                        onViewResults={setResultsTarget}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {formOpen && (
        <ChallengeFormModal
          onClose={() => setFormOpen(false)}
          onCreated={(c) => setChallenges((prev) => [c, ...prev])}
        />
      )}

      {resultsTarget && (
        <TeamMatchesModal
          members={resultsMembers}
          matchType={resultsTarget.matchType}
          dateFrom={resultsDateStr}
          dateTo={resultsDateStr}
          highlightMembers={false}
          onClose={() => setResultsTarget(null)}
        />
      )}
    </div>
  );
}
