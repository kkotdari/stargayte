import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Swords } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import OptionalDateTimeFields from "../../components/common/OptionalDateTimeFields";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import MatchRequestCorner from "./MatchRequestCorner";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import {
  challengeDateGroupLabel, challengeTimeLabel, formatRelativeSchedule, isToday,
} from "../../utils/date";
import { getScrollMetrics, getScrollRoot } from "../../utils/scrollRoot";
import type { Challenge, ChallengeResult, ChallengeSide, ChallengeStatus, ChallengeTarget } from "../../types";

// 화면 표시 상태는 서버 status를 그대로 쓴다 — 서버가 4개(응답대기 pending/성사 confirmed/
// 완료 done/폐기 discarded)로 확정해 내려준다. 예정 시간이 지나도 결과가 없으면 계속 성사
// (confirmed)고, 거절·무응답·미실시·(레거시)취소는 모두 폐기(discarded)로 통합됐다. 프론트가
// 파생 계산을 하지 않는다(서버가 내려준 status를 그대로 쓴다).

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
}

// 카드가 지금 어떤 인라인 폼을 펼치고 있는지 — 한 번에 하나만 열린다. schedule은 일시 미정
// 도전장을 수락하며 시간을 정하는 폼, revenge는 재대결 신청, result는 결과 입력.
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

  // 응답(수락/거절)은 아직 응답 안 한 지목자가, 아직 응답대기(pending)인 도전장에서만.
  const canRespond = !!myTarget && myTarget.response === "pending" && challenge.status === "pending";
  // 결과 입력 가능 시점 — 예정 일시가 지났거나, 시간 미정으로 수락된 대결(요청: "시간 미정
  // 수락 가능, 완료 시점으로 입력됨")은 언제든. 후자는 서버가 결과 입력 시점을 예정 일시로 채운다.
  const schedulePassed = !!challenge.scheduledAt && new Date(challenge.scheduledAt).getTime() < Date.now();
  const resultInputOpen = schedulePassed || !challenge.scheduledAt;
  const canEnterResult = isParticipant && challenge.status === "confirmed" && resultInputOpen && challenge.resultWinnerSide === null;
  // 완료된 대결에서 내가 패배한 쪽이면 재대결(설욕전)을 신청할 수 있다 — 무승부(draw)/미실시
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
        id: h.id, scheduledAt: h.scheduledAt, message: h.message, targets: h.targets,
        status: h.status, createdAt: h.createdAt, resultWinnerSide: h.resultWinnerSide,
      })),
      {
        id: challenge.id, scheduledAt: challenge.scheduledAt, message: challenge.message, targets: challenge.targets,
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

  // 수락하며 시간을 정할 때 — 날짜/시간 체크박스가 각각 꺼진 채로 시작한다(OptionalDateTimeFields가
  // 시간 체크박스를 켤 때 기본 시간 22:00을 채운다 — 요청: "수락할때 기본 시간 오후 10시").
  const startScheduling = () => { setMode("schedule"); setDateStr(""); setTimeStr(""); setMessage(""); };
  const startRevenge = () => { setMode("revenge"); setDateStr(""); setTimeStr(""); setMessage(""); };
  const startResult = () => { setMode("result"); setErr(""); };
  const closeMode = () => setMode("none");

  const acceptWithSchedule = async () => {
    setErr("");
    setBusy(true);
    try {
      // 날짜를 정했으면 그 일시로(시간을 안 정했으면 기본 22:00으로 채운다), 날짜도
      // 안 정하면 시간 미정으로 수락한다(요청: "시간 미정 수락 가능" — 실제 일시는
      // 완료(결과 입력) 시점에 서버가 채운다).
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || "22:00"}`).toISOString() : undefined;
      const updated = await api.respondToChallenge(challenge.id, "accepted", message.trim() || undefined, scheduledAt);
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 재대결(설욕전) 신청 — 시간/메모는 비워서 보낼 수 있다(승리한 쪽이 수락하며 시간을 정함).
  const submitRevenge = async () => {
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || "00:00"}`).toISOString() : undefined;
      const updated = await api.requestRevenge(challenge.id, { scheduledAt, message });
      onResponded(updated);
      closeMode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "재대결을 신청하지 못했어요.");
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
  const activeTargetInfos = activePage.targets.map((t) => ({ target: t }));
  // 체인은 이제 재대결(revenge) 하나뿐 — 체인의 첫 페이지(원본)를 뺀 나머지 페이지가 곧
  // 재대결 기록이다(reappliedFromId를 따로 안 봐도 페이지 순번으로 안다).
  const isRevengePage = shownIndex > 0;

  // 결과 입력 대기 = 성사(수락)됐고 예정 일시가 지났는데 아직 결과가 안 들어온 상태(요청:
  // "끝났으면 결과 입력 대기"). 완료 = 승패가 입력된 상태(요청: "결과보기 삭제하고 그자리에
  // 상태 배지 완료"). 무승부/미실시는 각자 알약/텍스트로 따로 표시한다.
  const isResultPending =
    shownLatest && challenge.status === "confirmed" && resultInputOpen && challenge.resultWinnerSide === null;
  const isDoneWin =
    shownLatest && (challenge.resultWinnerSide === "creator" || challenge.resultWinnerSide === "target");

  // 이 "맨 윗줄"에 실제로 보여줄 게 하나라도 있을 때만 줄을 그린다(전부 없으면 빈 줄이
  // 남아 어색하다). 재대결 라벨/무승부·완료·결과입력대기 배지/카운트다운/미실시 중 하나라도.
  const whenHasContent =
    isRevengePage
    || activePage.resultWinnerSide === "draw"
    || (shownLatest && challenge.status === "pending")
    || (shownLatest && challenge.resultWinnerSide !== null)
    || isResultPending;

  // 이미 종료된 대결(완료/미실시 등 status=done·discarded)은 패널을 더 어둡게, 아직 진행
  // 중인(응답대기·성사) 대결은 더 밝게 해서 목록에서 한눈에 구분되게 한다(요청).
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
              {/* 체인 라벨 — 이 페이지가 재대결(설욕전) 기록이면 표시한다. 체인은 이제 재대결
                  하나뿐이라, 원본(첫 페이지)을 뺀 모든 페이지가 재대결이다(isRevengePage). */}
              {isRevengePage && (
                <span className="scr-challenge-chain-tag scr-challenge-chain-tag-revenge">재대결</span>
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
          예약(reserve)만 하고 투명하게 둬서 아래 페이지네이션이 안 튀게 한다. 읽기 전용
          (버려진 도전장 모달)에서는 어떤 액션도 없다. */}
      {!readOnly && canRespond && mode === "none" && (
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
            시간을 정하거나, 비워두면 시간 미정으로 수락돼요 (완료할 때 그 시각으로 기록).
          </p>
          <OptionalDateTimeFields
            dateStr={dateStr} onDateChange={setDateStr}
            timeStr={timeStr} onTimeChange={setTimeStr}
          />
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
              disabled={busy}
            >
              {busy ? <Spinner /> : (dateStr ? "승락" : "시간 미정 승락")}
            </button>
          </div>
        </div>
      )}

      {mode === "revenge" && (
        <div className="scr-challenge-time-change-form">
          <p className="scr-challenge-inbox-message">
            재대결을 신청해요 — 이번엔 상대가 시간을 정하게 하려면 일시를 비워두세요.
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
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={submitRevenge} disabled={busy}>
              {busy ? <Spinner /> : "재대결 신청"}
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

      {/* 결과 입력/재대결 — 인라인 폼이 안 열려 있을 때만 뜨는 액션 줄. 응답 버튼과 마찬가지로
          이력 페이지에선 자리만 예약(투명)해 페이지네이션이 안 튀게. (취소/연기/재신청 제거됨) */}
      {!readOnly && mode === "none" && (canEnterResult || canRevenge) && (
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
        </div>
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
    </div>
  );
}

// "수락만"은 켜고 끄는 하나짜리 조건이라, 모바일에서 폭을 아끼려고 탭 대신 체크박스 하나로
// 둔다(요청: "필터를 수락만으로 변경하고 수락한 건들만 노출"). 평소 목록은 상태와 무관하게
// 하나로 합쳐 보여주고, 이 체크박스를 켜면 성사된(confirmed) 대결만 남긴다.


// 폐기(휴지통)된 건 — 본 목록에서는 감추고 "휴지통" 모달에만 보여준다. 서버가 거절·무응답·
// 미실시·(레거시)취소를 모두 status="discarded"로 확정해 내려주므로 그것만 보면 된다.
function isDiscarded(c: Challenge): boolean {
  return c.status === "discarded";
}

// 순수 날짜(예정 일시) 내림차순 한 줄로 정렬한다(요청: "순수 날짜 내림차순" — 진행/종료를
// 나눠 진행중을 위로 끌어올리던 예전 규칙 때문에 다가오는 경기(NEXT)가 날짜와 무관하게 맨
// 위로 올라오는 게 부자연스러웠다). 예정 일시가 없는 건(=아직 응답 대기중인 일정 미정. 종료된
// 건은 서버가 요청일+1일로 스탬프하므로 null이 남지 않는다)은 날짜가 없어 맨 위에 둔다. 일시가
// 같거나 둘 다 미정이면 최근 생성 순으로 가른다.
// 정렬: "일정 미정"(응답 대기중, scheduledAt 없음)은 맨 위 "대기중" 묶음으로, 그 아래
// 날짜 있는 대결은 과거(위) → 미래(아래) 오름차순으로 둔다(요청: 타임라인 "위가 과거,
// 아래가 미래" — 아래로 스크롤할수록 미래). 같은 시각/대기중끼리는 최신 생성이 위.
function compareChallenges(a: Challenge, b: Challenge): number {
  const aNull = !a.scheduledAt;
  const bNull = !b.scheduledAt;
  if (aNull && bNull) return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  if (aNull) return -1;
  if (bNull) return 1;
  if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt! > b.scheduledAt! ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

// 도전장("너 나와!") 게시판 — 경기결과/예약 시스템과는 독립적인 별도 게시판이라, 화면 자체도
// 기간 필터 없이 전체 목록을 그대로 보여준다.
export default function ChallengeScreen() {
  const user = useAppStore((s) => s.user);

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
  // "기록" 메뉴는 폐지하고 완료된 대결도 같은 목록에 합친다(요청: "기록 메뉴 제거 및 원래
  // 목록에 통합. 결과적으로 대결 목록은 1개만 존재") — 폐기(휴지통)된 건만 뺀다.
  const unifiedList = useMemo(
    () => challenges.filter((c) => !isDiscarded(c)).sort(compareChallenges),
    [challenges],
  );

  // 가장 가까운 예정된(수락) 대결의 시각 — 확정됐고 예정 일시가 아직 안 지난 것 중 가장 임박.
  // "다가오는 매치" 이전(과거에 끝난 대결들)은 기본적으로 접어서 감춘다(요청: "다가오는 매치
  // 이전은 모두 접혀서 안보임").
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
  // 목록(과거→미래로 정렬됨) 안에서 "다가오는 매치"가 처음 나오는 자리 — 그 앞은 전부
  // 접힌다. 다가오는 매치가 아예 없으면(전부 과거이거나 확정된 예정이 없으면) 접을 기준이
  // 없으니 전체를 그대로 보여준다.
  const boundaryIndex = useMemo(() => {
    if (nextTime === null) return 0;
    const idx = unifiedList.findIndex(isNextCard);
    return idx === -1 ? 0 : idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedList, nextTime]);

  // "종료된 대결 보기" 토글 — 누르면 접혀 있던 앞부분이 지금 보이는 목록 위로 나타난다.
  // 콘텐츠가 뷰포트 위쪽에 삽입되면 브라우저가 스크롤 위치(px)를 그대로 유지해 화면에 보이던
  // 내용이 아래로 밀려 보인다(요청: "스크롤이 튀지 않게 조심") — 토글 직전 스크롤 높이를
  // 기억해뒀다가, 다음 렌더 직후(레이아웃 반영 후) 늘어난/줄어든 높이만큼 스크롤 위치를 같이
  // 옮겨서 화면에 보이던 내용이 그 자리에 그대로 있는 것처럼 보이게 한다.
  const [showEnded, setShowEnded] = useState(false);
  const prevScrollHeightRef = useRef<number | null>(null);
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
    if (root instanceof Window) window.scrollBy(0, delta);
    else root.scrollTop += delta;
  }, [showEnded]);

  const activeList = showEnded ? unifiedList : unifiedList.slice(boundaryIndex);

  useEffect(() => {
    const root = document.getElementById("scroll-root");
    if (!root) return;
    root.classList.add("scr-snap-today");
    return () => root.classList.remove("scr-snap-today");
  }, []);

  const emptyLabel = "도전장이 없어요";

  return (
    <div className="scr-screen scr-challenge-screen-v2">
      {/* "기록" 메뉴는 폐지됐다(요청) — 목록이 하나뿐이라 타이틀 툴바엔 더 이상 액션이
          없다. 도전장 쓰기 버튼은 타이틀 줄 아래 별도 줄에 가운데 정렬, 1.2배 확대(요청). */}
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">너 나와!</h1>
      </div>

      <div className="scr-v2-primary-row">
        <button
          type="button"
          className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
          onClick={() => setFormOpen(true)}
        >
          <Swords size={15} />
          도전장 쓰기
        </button>
      </div>

      {/* 최상단 대결 요청 코너 — 자유 텍스트 + 인라인 언급 칩. 언급된 사람에겐 알림이 간다. */}
      <MatchRequestCorner />

      {/* 목록 중타이틀 — 요청 코너와 실제 도전장 목록을 구분한다. */}
      <h2 className="scr-challenge-list-heading">대결 목록</h2>

      {/* 완료된 대결도 이제 같은 목록에 섞여 있지만, 다가오는 매치 이전(과거에 끝난 대결)은
          기본적으로 접혀서 안 보인다(요청) — 누르면 그 위로 펼쳐진다. 접을 게 없으면
          (boundaryIndex 0) 링크 자체를 안 보여준다. */}
      {boundaryIndex > 0 && (
        <button type="button" className="scr-challenge-toggle-ended-link" onClick={toggleShowEnded}>
          {showEnded ? "종료된 대결 접기" : "종료된 대결 보기"}
        </button>
      )}

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
                <Fragment key={g.label}>
                  <div
                    className="scr-challenge-date-group"
                    data-today={g.isToday ? "1" : undefined}
                    // "일정 미정" 그룹(scheduledAt 없는 대기중 묶음, 맨 위)에 표식을 달아
                    // 우측 타임라인이 눈금+라벨을 찍고 스크롤 스냅 타깃으로 삼는다.
                    data-undecided={g.items.some((c) => !c.scheduledAt) ? "1" : undefined}
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
                          <div className="scr-challenge-time-head">
                            <span className="scr-challenge-time-head-label">{tg.timeLabel}</span>
                          </div>
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
          )}
        </section>
      )}

      {/* 우측 네비게이션 타임라인 — 스크롤 시에만 뜨고, 스스로 스크롤 불가 상태면 안 뜬다.
          너 나와는 과거(위)→미래(아래) 순이고, "오늘"/"미정" 그룹에 눈금을 찍는다. */}
      {!loading && (
        <ScrollNavTimeline
          headSelector=".scr-challenge-date-head"
          topLabel="과거"
          bottomLabel="미래"
          markers={[
            { key: "undecided", className: "scr-scroll-timeline-undecided", groupSelector: '.scr-challenge-date-group[data-undecided="1"]' },
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
