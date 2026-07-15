import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { suppressScrollHide } from "../../utils/scrollRoot";
import type { Challenge, ChallengeResult, ChallengeSide, ChallengeStatus, ChallengeTarget, Member } from "../../types";

// 실제 서버 status(pending/confirmed/rejected/canceled) 외에, 화면에서만 판단하는 파생
// 상태 "완료"(done) — 승락(confirmed)됐고 예정 매치 시각이 이미 지난 건(요청: "완료 기준은
// 예정 시간이 지났을때 승락상태면 완료"). 응답 기한 만료(무응답거절)는 이제 프론트가 계산
// 하지 않는다(요청: "프론트 마감 계산은 필요없어") — 기한이 지나면 서버 배치가 상태를
// rejected로 확정해서 내려주므로, 여기선 서버가 준 status를 그대로 쓰기만 한다.
type ChallengeDisplayStatus = "pending" | "confirmed" | "done" | "rejected" | "canceled";

// 도전장/재신청 체인 기록이 공통으로 갖는 최소 필드만 보면 파생 상태를 계산할 수 있다 —
// 살아있는 도전장(Challenge)과 이력 페이지(ChallengeHistoryEntry) 양쪽에 그대로 쓴다.
interface DisplayStatusInput {
  status: ChallengeStatus;
  scheduledAt: string | null;
  createdAt: string;
}

function displayStatusOf(c: DisplayStatusInput): ChallengeDisplayStatus {
  if (c.status === "canceled") return "canceled";
  if (c.status === "rejected") return "rejected";
  if (c.status === "pending") return "pending";
  // confirmed — 예정 시간(매치 시각)이 있고 이미 지났으면 "완료", 아니면(미정 포함) 계속 "승락".
  if (c.scheduledAt && new Date(c.scheduledAt).getTime() < Date.now()) return "done";
  return "confirmed";
}

// 응답 마감 = 요청일(createdAt) + 1일. 응답대기중 카드에 남은 시간을 보여주는 카운트다운용
// (요청: "카운트 다운 필요해!") — 만료 판정 자체는 서버 배치가 하고(프론트는 마감 계산으로
// 상태를 바꾸지 않는다), 여기선 남은 시간 문구만 심플하게 만든다. 마감이 지나 잠깐 음수가
// 되면 "곧 마감"으로 대체한다.
const EXPIRE_MS = 24 * 60 * 60 * 1000;
function responseDeadlineLabel(createdAt: string): string {
  const remain = new Date(createdAt).getTime() + EXPIRE_MS - Date.now();
  if (remain <= 0) return "응답 마감 임박";
  const hours = Math.floor(remain / (60 * 60 * 1000));
  const mins = Math.floor((remain % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `응답 마감 ${hours}시간 남음` : `응답 마감 ${mins}분 남음`;
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

type PillTone = "pending" | "accepted" | "rejected";

// 상대 한 명의 응답 배지 — 완료/무응답거절/무응답처럼 세분화된 라벨은 텍스트 알약일 때나
// 의미가 있었지, 아바타에 겹쳐 그리는 작은 배지에서는 다 못 읽는다(요청: "응답 배지는
// 수락/거절/대기 세개로 통일하고 아바타에 겹쳐서 표시") — 완료는 수락에, 무응답거절/
// 무응답(카드 전체가 거절로 끝나 이 사람 응답이 의미 없어진 경우)은 거절에 합친다.
function targetPillInfo(t: ChallengeTarget, overall: ChallengeDisplayStatus): { tone: PillTone } {
  if (t.response === "accepted") return { tone: "accepted" };
  // 취소는 카드에 "취소" 알약으로 따로 표시하므로 여기선 각자의 실제 응답(수락/대기)을 그대로
  // 둔다 — 취소를 거절 톤으로 덮으면 상대가 거절한 것처럼 오해된다.
  if (t.response === "rejected" || overall === "rejected") return { tone: "rejected" };
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
        const tone = t ? targetPillInfo(t.target, t.overall).tone : null;
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
                  {tone === "accepted" ? "수락" : tone === "rejected" ? "거절" : "대기"}
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
  resultWinnerSide: ChallengeResult | null;
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

  const canRespond = !!myTarget && myTarget.response === "pending" && challenge.status !== "canceled";
  // 승패가 안 난 상태 — 결과 미입력이거나 "미실시"(not_held). 이 상태의 확정 대결은 취소/연기
  // 할 수 있다(요청: "미실시 상태면 카드에 취소/연기 노출"). 무승부/승패 결과는 대상 아님.
  const resultOpen = challenge.resultWinnerSide === null || challenge.resultWinnerSide === "not_held";
  // 취소는 응답 대기중(pending)이거나 확정+승패 미확정일 때, "생성자만"(요청: "취소는 생성자만").
  const canCancel = isCreator
    && (challenge.status === "pending" || (challenge.status === "confirmed" && resultOpen));
  // 재신청은 거절/무응답거절(status=rejected)이거나 취소(canceled)된 건에서 가능하다(요청:
  // "취소된 건은 재신청 가능해야 하지 않나"). 이미 다음 행으로 이어진 건(superseded)은 목록에
  // 아예 안 뜨니 여기선 status만 보면 된다. 미실시 상태 자체는 confirmed라 안 잡힌다(재신청 X).
  const canReapply = isCreator && (challenge.status === "rejected" || challenge.status === "canceled");
  // 예정 일시가 지난 확정 대결에서, 아직 결과가 안 들어왔으면 참가자가 결과를 입력한다.
  const schedulePassed = !!challenge.scheduledAt && new Date(challenge.scheduledAt).getTime() < Date.now();
  const canEnterResult = isParticipant && challenge.status === "confirmed" && schedulePassed && challenge.resultWinnerSide === null;
  // 결과가 입력됐고 내가 패배한 쪽이면 설욕전을 신청할 수 있다 — 무승부(draw)/미실시
  // (not_held)는 패자가 없어 설욕전 대상이 아니다(losingSide=null).
  const losingSide: ChallengeSide | null =
    challenge.resultWinnerSide === "creator" ? "target"
    : challenge.resultWinnerSide === "target" ? "creator"
    : null;
  const canRevenge = losingSide !== null && mySide !== null && mySide === losingSide;
  // 연기는 확정+승패 미확정(결과 미입력 또는 미실시)일 때 "참가자 누구나" 할 수 있다(요청:
  // "연기는 참가자 아무나"). 예정 일시가 지난 뒤에도 가능하다.
  const canPostpone = isParticipant && challenge.status === "confirmed" && resultOpen;

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
  // 각 페이지의 파생 라벨/상태는 그 페이지 자신의 값으로 계산한다 — 최신 페이지는 지금 실제
  // 일시/상태, 이력 페이지는 그 시점의 것(거절/무응답취소/완료 등). 아래에서 모든 페이지를
  // 한 칸에 겹쳐 렌더해(카드 높이를 최대 페이지에 고정) 페이지마다 렌더 시점에 계산한다.
  // 일정 자체가 없는 카드(=일정 미정 그룹)는 그룹 헤더가 이미 "일정 미정"이라 카드 안에 또
  // 표기하지 않는다(요청). 일시가 있으면 시간만 보여준다 — 날짜만 있고 시간만 미정인 경우는
  // 없다(일시는 날짜+시간이 항상 함께).
  const timeLabelOf = (p: ChallengePage, latest: boolean): string => {
    if (!latest) return formatChallengeSchedule(p.scheduledAt);
    if (!p.scheduledAt) return "";
    return challengeTimeLabel(p.scheduledAt) ?? "";
  };

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

  // 수락하며 시간을 정할 때 기본 시간은 오후 10시(요청: "수락할때 기본 시간 오후 10시").
  const startScheduling = () => { setMode("schedule"); setDateStr(""); setTimeStr("22:00"); setMessage(""); };
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
      setErr(e instanceof Error ? e.message : mode === "revenge" ? "재대결을 신청하지 못했어요." : "재신청하지 못했어요.");
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

  // 지금 실제로 보여주는 페이지(renderedIndex — 크로스페이드로 pageIndex보다 살짝 늦게
  // 따라온다) 하나만 자연 높이로 렌더한다. pages가 줄어드는 드문 경우에도 안전하게 클램프.
  const shownIndex = Math.min(renderedIndex, pages.length - 1);
  const activePage = pages[shownIndex];
  const shownLatest = shownIndex === pages.length - 1;
  const activeOverall = displayStatusOf(activePage);
  const activeTargetInfos = activePage.targets.map((t) => ({ target: t, overall: activeOverall }));
  // 재신청은 몇 번째인지도 알 수 있게 "n번째 재신청"으로 표시한다(요청: "다시 신청은
  // n번째 재신청으로 변경") — 체인 맨 앞부터 이 페이지까지 chainKind가 "reapply"인
  // 페이지 개수를 센다(설욕전은 별도 라벨이라 세지 않는다).
  const reapplyNo = pages.slice(0, shownIndex + 1).filter((p) => p.chainKind === "reapply").length;

  return (
    <div className="scr-challenge-card">
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
            <div className="scr-challenge-card-row scr-challenge-card-when">
              {timeLabelOf(activePage, shownLatest)}
              {/* 체인 라벨 — 이 기록이 재신청/재대결로 만들어진 것이면 어느 쪽인지 표시.
                  재신청은 몇 번째인지도 함께(요청: "다시 신청은 n번째 재신청으로 변경하고
                  다시 신청 -> 재신청으로 모두 변경" → "배지 N차 재신청으로 변경"). */}
              {activePage.chainKind && (
                <span className={cx("scr-challenge-chain-tag", `scr-challenge-chain-tag-${activePage.chainKind}`)}>
                  {activePage.chainKind === "revenge" ? "재대결" : `${reapplyNo}차 재신청`}
                </span>
              )}
              {/* 취소된 도전장도 이제 목록에 보이므로(요청) "취소" 알약으로 표시한다. */}
              {activePage.status === "canceled" && (
                <span className="scr-challenge-pill scr-challenge-pill-done">취소</span>
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
                <span className="scr-challenge-countdown">{responseDeadlineLabel(challenge.createdAt)}</span>
              )}
              {/* 결과 보기는 결과가 입력된 뒤에만 뜬다(요청: "결과보기는 결과 입력후에만
                  보이고"). 미실시는 볼 결과 자체가 없으니 버튼 대신 "미실시" 텍스트만
                  같은 자리에(요청: "미실시인 경우 결과보기 대신 미실시 표시"). */}
              {shownLatest && challenge.resultWinnerSide === "not_held" && (
                <span className="scr-challenge-result-link scr-challenge-result-link-static">미실시</span>
              )}
              {shownLatest && challenge.resultWinnerSide !== null && challenge.resultWinnerSide !== "not_held" && (
                <button type="button" className="scr-challenge-result-link" onClick={() => onViewResults(challenge)}>
                  결과 보기
                </button>
              )}
            </div>

            <div className="scr-challenge-matchup">
              <ChallengeSide people={creatorSideMembers} message={activePage.message} highlightMemberIds={highlightMemberIds} />
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
          </div>
        </div>

      </div>

      {err && <div className="scr-err">{err}</div>}

      {/* 응답 버튼(수락/거절) — 최신 페이지에서만 실제로 뜨지만, 이력 페이지에선 자리를
          예약(reserve)만 하고 투명하게 둬서 아래 페이지네이션이 안 튀게 한다. */}
      {canRespond && mode === "none" && (
        <div className={cx("scr-challenge-card-actions", !isLatestPage && "scr-challenge-card-actions-reserve")}>
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
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr("22:00"); }}
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
              재대결을 신청해요 — 이번엔 상대가 시간을 정하게 하려면 일시를 비워두세요.
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
              {busy ? <Spinner /> : mode === "revenge" ? "재대결 신청" : "재신청"}
            </button>
          </div>
        </div>
      )}

      {mode === "postpone" && (
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">새 일시로 대결을 연기해요.</p>
          <div className="scr-challenge-datetime">
            {/* 연기는 기존 시간이 기본값(요청) — 날짜를 지웠다 다시 골라도 기존 시각으로 돌아온다. */}
            <input
              type="date" className="scr-input" value={dateStr}
              onChange={(e) => { setDateStr(e.target.value); if (!e.target.value) setTimeStr(isoToInputs(challenge.scheduledAt).time); }}
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
      )}

      {/* 결과 입력/재대결/연기/취소/재신청 — 인라인 폼이 안 열려 있을 때만 뜨는 액션 줄.
          응답 버튼과 마찬가지로 이력 페이지에선 자리만 예약(투명)해 페이지네이션이 안 튀게. */}
      {mode === "none" && (canCancel || canReapply || canEnterResult || canRevenge || canPostpone) && (
        <div className={cx("scr-challenge-card-actions", !isLatestPage && "scr-challenge-card-actions-reserve")}>
          {canEnterResult && (
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={startResult} disabled={busy}>
              결과 입력
            </button>
          )}
          {canRevenge && (
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={startRevenge} disabled={busy}>
              재대결 신청
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

      {cancelConfirmOpen && (
        <ConfirmDialog
          title="도전장을 취소할까요?"
          message="취소하면 되돌릴 수 없어요 — 재신청하려면 새로 보내야 해요."
          confirmLabel="취소하기"
          onConfirm={cancel}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      )}
    </div>
  );
}

// "내것만"은 켜고 끄는 하나짜리 조건이라, 모바일에서 폭을 아끼려고 전체/내것만 두 칸짜리
// 탭 대신 체크박스 하나로 바꿨다(요청: "너 나와 필터 공간이 좁아(모바일) 내 것만은
// 체크박스로 변경할게"). 예전의 확정/응답대기/종료 상태 탭은 없앴고 목록은 상태와 무관하게
// 하나로 합쳐 보여준다.

// 기간 필터 — 경기 화면과 같은 패턴(전체/월 + 월 선택기), 기본은 월(요청: "너나와에
// 기간 필터 추가 전체 월까지" + "기본은 월"). 경기 화면과 달리 "일" 단위까지는 안 쪼갠다.
type ChallengePeriodUnit = "all" | "month";
const PERIOD_UNIT_OPTS: { value: ChallengePeriodUnit; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];

// 순수 날짜(예정 일시) 내림차순 한 줄로 정렬한다(요청: "순수 날짜 내림차순" — 진행/종료를
// 나눠 진행중을 위로 끌어올리던 예전 규칙 때문에 다가오는 경기(NEXT)가 날짜와 무관하게 맨
// 위로 올라오는 게 부자연스러웠다). 예정 일시가 없는 건(=아직 응답 대기중인 일정 미정. 종료된
// 건은 서버가 요청일+1일로 스탬프하므로 null이 남지 않는다)은 날짜가 없어 맨 위에 둔다. 일시가
// 같거나 둘 다 미정이면 최근 생성 순으로 가른다.
function compareChallenges(a: Challenge, b: Challenge): number {
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
  const [mineOnly, setMineOnly] = useState(false);
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

  // 기간 필터 — 월이면 예정 일시가 그 달에 속하는 것만. 아직 진행 중인 시간 미정 도전장
  // (scheduledAt 없음)은 특정 달에 속한다고 볼 수 없고 지금 진행 중이라 항상 보여준다.
  // 거절/무응답으로 끝난 시간 미정 건은 서버가 예정 일시를 요청일+1일로 확정하므로 여기서
  // 자연히 그 달 기준으로 걸린다(=지난 달 건은 이번 달 목록에서 빠진다).
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
  const activeList = mineOnly ? sortedChallenges.filter(isMine) : sortedChallenges;

  // 가장 가까운 예정된(수락) 대결의 시각 — 확정됐고 예정 일시가 아직 안 지난 것 중 가장 임박.
  // 같은 시각(exact)에 여러 대결이 잡혀 있으면 그것들 "모두"가 NEXT다(요청: "동일 시각 여러
  // 개가 next이면 모두 next 배지 + 글로우"). 화면 진입 시엔 그중 첫 카드로 스크롤한다.
  const nextTime = useMemo(() => {
    const now = Date.now();
    let best = Infinity;
    challenges.forEach((c) => {
      if (c.status !== "confirmed" || !c.scheduledAt) return;
      const t = new Date(c.scheduledAt).getTime();
      if (t >= now && t < best) best = t;
    });
    return best === Infinity ? null : best;
  }, [challenges]);
  const isNextCard = (c: Challenge): boolean =>
    nextTime !== null && c.status === "confirmed" && !!c.scheduledAt
    && new Date(c.scheduledAt).getTime() === nextTime;
  // 동일 시각 NEXT가 여럿이면 그중 목록상 첫 카드로만 스크롤한다(배지/글로우는 모두).
  const firstNextId = useMemo(
    () => activeList.find(isNextCard)?.id ?? null,
    [activeList, nextTime],
  );
  const nextCardRef = useRef<HTMLDivElement | null>(null);
  // 진입 후 첫 로드가 끝났을 때 딱 한 번만 스크롤한다 — 이후 응답/재조회로 목록이 바뀌어도
  // 보던 위치를 뺏지 않는다. scrollIntoView는 #scroll-root의 CSS scroll-behavior:smooth를
  // 따라 부드럽게 이동한다. 가운데가 아니라 화면 맨 위에 오게 한다(요청: "next 대결
  // 스크롤은 가운데가 아니라 상단에 오게(위의 목록은 안보이는 정도로)") — 위쪽 여유는
  // .scr-challenge-card-slot의 scroll-margin-top이 살짝만 남긴다.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (loading || didAutoScrollRef.current || firstNextId === null) return;
    const el = nextCardRef.current;
    if (!el) return;
    didAutoScrollRef.current = true;
    // 이 자동 스크롤이 "아래로 스크롤 = 숨김"으로 오인돼 탭바/필터·검색 아이콘이 같이
    // 숨던 문제를 막는다(요청: "next 대결 자동 스크롤하면서 탭바와 아이콘 숨겨지는 문제
    // 해결") — 부드러운 스크롤이 끝날 때까지 숨김 판정을 잠깐 억제한다.
    suppressScrollHide();
    el.scrollIntoView({ block: "start" });
  }, [loading, firstNextId]);

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
    : mineOnly ? "내 대결이 없어요" : "도전장이 없어요";

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
            {/* 기간이 먼저, 내것만이 뒤(요청: "기간이 먼저 내 것만이 뒤"). 기간 라벨은
                전체/월 알약만 봐도 알 수 있어 뗀다(요청: "필터중 기간 라벨은 모두 제거"). */}
            <FilterItem>
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
            <FilterItem>
              <label className="scr-checkbox-field">
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                내것만
              </label>
            </FilterItem>
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
                    {/* NEXT 배지는 카드가 아니라 그 날짜 헤더에 단다(요청: "글로우 없애고
                        NEXT 배지를 날짜에"). 가장 임박한 예정 대결이 속한 날짜 그룹에만
                        붙는다(동일 시각이면 같은 날짜라 한 그룹). */}
                    {g.items.some(isNextCard) && <span className="scr-challenge-next-tag">NEXT</span>}
                  </div>
                  {g.items.map((c) => (
                    // 슬롯 래퍼 — 진입 스크롤 목적지는 가장 임박한 예정 대결(그중 첫 카드)이다.
                    <div
                      key={c.id}
                      ref={c.id === firstNextId ? nextCardRef : undefined}
                      className="scr-challenge-card-slot"
                    >
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
