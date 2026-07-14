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
import { challengeDateGroupLabel, challengeTimeLabel, formatChallengeSchedule, fmt, isToday } from "../../utils/date";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import type { Challenge, ChallengeTarget, Member } from "../../types";

// 실제 서버 status(pending/confirmed/rejected/canceled) 외에, 화면에서만 판단하는 두 가지
// 파생 상태 — "완료"(예정 시간이 지난 승락 건, 요청: "완료 기준은 예정 시간이 지났을때
// 승락상태면 완료")와 "expired"(보낸지 3일 안에 응답이 없어 무응답으로 취소 처리, 요청:
// "보낸지 3일안에 응답 없는건은 무응답 취소 처리(끝난 경기 목록으로 이동)... 프론트에서만
// 그렇게 분류") — 둘 다 서버 status는 그대로 두고(배치처리 없음) 조회 시점마다 다시 계산한다.
type ChallengeDisplayStatus = "pending" | "confirmed" | "done" | "rejected" | "canceled" | "expired";

const EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;

function challengeDisplayStatus(c: Challenge): ChallengeDisplayStatus {
  if (c.status === "canceled") return "canceled";
  if (c.status === "rejected") return "rejected";
  if (c.status === "pending") {
    return Date.now() - new Date(c.createdAt).getTime() > EXPIRE_MS ? "expired" : "pending";
  }
  // confirmed — 예정 시간이 있고 이미 지났으면 "완료", 아니면(미정 포함) 계속 "승락".
  if (c.scheduledAt && new Date(c.scheduledAt).getTime() < Date.now()) return "done";
  return "confirmed";
}

// 종료된 것 = 더는 지켜볼 필요가 없는 건(거절/취소/무응답취소/완료). 그 외(응답대기중/
// 승락돼서 아직 안 뛴 것)는 전부 다가오는 쪽이다.
function isEndedStatus(s: ChallengeDisplayStatus): boolean {
  return s === "rejected" || s === "canceled" || s === "expired" || s === "done";
}

type PillTone = "pending" | "accepted" | "rejected" | "done" | "muted";

// 상대 한 명의 응답 알약 — 개별 response뿐 아니라 카드 전체의 파생 상태까지 함께 봐서
// 문구를 정한다. 예: 팀전에서 한 명이 거절하면 그 순간 전체가 rejected로 끝나버리는데,
// 아직 응답을 안 한 나머지 상대는 raw response가 여전히 "pending"이라 그대로 "대기"라고
// 보여주면 마치 아직 진행 중인 것처럼 헷갈린다 — 그럴 땐 "무응답"으로 구분한다.
function targetPillInfo(t: ChallengeTarget, overall: ChallengeDisplayStatus): { label: string; tone: PillTone } {
  if (overall === "canceled") return { label: "취소", tone: "muted" };
  if (overall === "expired") return { label: "무응답취소", tone: "muted" };
  if (t.response === "accepted") return overall === "done" ? { label: "완료", tone: "done" } : { label: "수락", tone: "accepted" };
  if (t.response === "rejected") return { label: "거절", tone: "rejected" };
  if (overall === "rejected") return { label: "무응답", tone: "muted" };
  return { label: "대기", tone: "pending" };
}

interface ChallengeDateGroup {
  label: string;
  isToday: boolean;
  items: Challenge[];
}

// 경기결과 화면처럼 날짜별로 묶어 보여준다(요청: "경기 화면처럼 날짜별로 그룹핑") —
// 넘어오는 목록은 이미 정렬돼 있어서(다가오는=임박순, 종료된=최근순) 같은 날짜 라벨이
// 연속으로 나올 때만 묶으면 된다. 일정 미정 도전장은 "일정 미정" 하나로 모인다.
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

// 한마디/응답 메시지 — 카드에서는 2줄로 잘리는데(global.css .scr-challenge-side-message),
// 길면 그 이상 읽을 방법이 없었다(요청: "너나와 카드에서 한줄 메시지가 잘리거든? 마우스오버/
// 클릭시 리플레이 툴팁같은 단순한 창으로 팝오버로 전체메시지를 다 볼수 있게 해줘") —
// ReplayLocationHint와 같은 패턴(attachPopover + 바깥 클릭/포커스이동 시 닫힘)으로 클릭하면
// 전체 텍스트를 팝오버로 보여준다. 내용이 없으면(자리만 예약하는 빈 칸) 그대로 정적인 div로
// 둔다 — 누를 게 없는데 버튼처럼 보이면 안 된다.
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
      {/* 2줄 말줄임(-webkit-line-clamp)은 <button> 자신에 걸면 사파리에서 버튼 내부의
          독자적인 렌더링 규칙 때문에 안 먹는다(요청: "한줄메시지도 두줄 넘어가면
          말줌임표로 줄여야됨" — 실제로 이 문제였다) — 잘리는 스타일(.scr-challenge-
          side-message)은 버튼 안의 평범한 span에 걸고, 버튼 자신은 그 span을 감싸는
          투명한 클릭 영역 역할만 한다. */}
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
  people, message, targets,
}: {
  people: SideMember[];
  // 도전자편(1개, 요청자 본인의 한마디) 또는 상대편(각 인원의 응답 알약+메시지) 중 하나만 채워진다.
  message?: string;
  targets?: { target: ChallengeTarget; overall: ChallengeDisplayStatus }[];
}) {
  return (
    <div className={cx("scr-challenge-side", targets && "scr-challenge-side-target")}>
      {people.map((p, i) => {
        const t = targets?.[i];
        return (
          <div key={p.id} className="scr-challenge-side-block">
            <div className="scr-challenge-side-row">
              <Avatar member={p} size={24} />
              <span className="scr-challenge-person-name">{p.nickname}</span>
              {t && (
                <span className={cx("scr-challenge-pill", `scr-challenge-pill-${targetPillInfo(t.target, t.overall).tone}`)}>
                  {targetPillInfo(t.target, t.overall).label}
                </span>
              )}
            </div>
            {/* 메시지 유무와 무관하게 항상 이 자리를 차지해야, 상대가 여럿일 때 어떤 사람은
                메시지가 있고 어떤 사람은 없어도 줄이 들쭉날쭉하지 않는다(요청: "메시지
                있건 없건 예약 자리 차지하게하기"). */}
            {targets && <ChallengeMessage text={t?.target.responseMessage} />}
          </div>
        );
      })}
      {/* 도전자편의 한마디는 팀원 전체가 아니라 도전자 본인 몫이라 팀 전체 아래에 한 번만
          붙인다(요청: "한줄 메시지는 아래줄 도전자 프사 아래로 이동"). */}
      {message !== undefined && <ChallengeMessage text={message} />}
    </div>
  );
}

// 카드 안에서 좌우로 슬라이드해 보여줄 "한 페이지" — 재신청 체인의 각 기록(과 지금
// 살아있는 도전장 자신)이 공통으로 갖는 필드만 뽑는다. 도전자/팀 구성은 체인 내내
// 안 바뀌므로 여기 안 담는다(요청: "재신청하면 원래건은 종료되고 새로운 도전 행이
// 만들어져 새 아이디로... 화면에서는 좌우로 슬라이드되게 구성하는거야").
interface ChallengePage {
  id: number;
  scheduledAt: string | null;
  message: string;
  targets: ChallengeTarget[];
}

interface ChallengeCardProps {
  challenge: Challenge;
  myId: string | undefined;
  onResponded: (updated: Challenge) => void;
  onViewResults: (challenge: Challenge) => void;
}

function ChallengeCard({ challenge, myId, onResponded, onViewResults }: ChallengeCardProps) {
  const memberOf = useAppStore((s) => s.memberOf);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const myTarget = challenge.targets.find((t) => t.memberId === myId);
  const isCreator = challenge.createdBy.id === myId;
  // 응답(ChallengeAuthor)엔 프사가 없어서(닉네임만) 로컬 회원 목록에서 찾아 보여준다 —
  // 지목된 상대(targets)는 서버가 프사까지 내려주니 그대로 쓴다.
  const creatorMember = memberOf(challenge.createdBy.id);

  const canRespond = !!myTarget && myTarget.response === "pending" && challenge.status !== "canceled";
  const canCancel = isCreator && challenge.status === "pending";
  const canReapply = isCreator && challenge.status === "rejected";
  const overall = challengeDisplayStatus(challenge);

  // 재신청 이력(오래된 순) 뒤에 지금 살아있는 도전장을 붙여 "페이지" 목록을 만든다 —
  // 기본으로는 맨 뒤(최신, 지금 살아있는 도전장)를 보여준다. 이력이 없으면(challenge.
  // history가 비어있으면) 페이지가 하나뿐이라 슬라이드 UI 자체가 안 뜬다. pages.length는
  // 이 카드가 떠 있는 동안 안 바뀐다(재신청으로 이력이 늘어나는 건 이 도전장 자신이
  // 재신청될 때인데, 그 순간 새 id의 도전장으로 통째로 교체돼 이 카드는 언마운트되고
  // 새 카드가 뜬다) — useState 초기값으로만 계산해도 충분하다.
  const pages: ChallengePage[] = useMemo(
    () => [
      ...challenge.history.map((h) => ({ id: h.id, scheduledAt: h.scheduledAt, message: h.message, targets: h.targets })),
      { id: challenge.id, scheduledAt: challenge.scheduledAt, message: challenge.message, targets: challenge.targets },
    ],
    [challenge],
  );
  const [pageIndex, setPageIndex] = useState(pages.length - 1);
  const isLatestPage = pageIndex === pages.length - 1;
  const page = pages[pageIndex];
  // 최신 페이지는 목록의 날짜 그룹 헤더가 이미 날짜를 보여주니 시간만 표시하지만, 이전
  // 기록 페이지는 그 헤더의 날짜와 다를 수 있어(재신청 때 날짜 자체가 바뀌었을 수 있다)
  // 시간만으론 헷갈린다(요청: "이전 기록 카드에는 날짜도 표시해야할듯") — 날짜까지 함께
  // 보여준다.
  const pageTimeLabel = isLatestPage
    ? (challengeTimeLabel(page.scheduledAt) ?? "시간 미정")
    : formatChallengeSchedule(page.scheduledAt);
  // 이력 페이지는 전부 "거절되고 재신청된" 기록이라 항상 rejected다(재신청 자체가
  // 거절된 도전장에만 허용되므로) — 최신 페이지만 지금 실제 상태(overall, 완료/무응답
  // 취소 등 파생 상태까지 반영)를 쓴다.
  const pageOverall: ChallengeDisplayStatus = isLatestPage ? overall : "rejected";
  const pageTargetInfos = page.targets.map((t) => ({ target: t, overall: pageOverall }));

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");
  // 요청자가 "시간 지정"을 끄고 보낸(scheduledAt 없음) 도전장을 카드에서 바로 승락하려는
  // 경우 — window.prompt 한 줄로는 날짜+시간을 받을 수 없어 재신청과 같은 인라인 폼으로
  // 전환한다(요청: "도전자/상대 모두 시간을 지정하지 않았는데 수락이 된 경우가 있네
  // 이러면 안되는데" — 승락하는 이 시점에 상대가 직접 정하게 해서 막는다).
  const [scheduling, setScheduling] = useState(false);

  // 카드에서 바로 승락/거절 — OS 기본 prompt로 한마디를 받는다. 승락은 이제 선택(요청:
  // "승락시에는 메시지 필수 아니게 변경"), 거절은 여전히 필수다(요청: "거절일때는 필수") —
  // required가 그 둘을 가른다. 취소를 누르면(null) 아무 요청도 보내지 않고, 승락인데
  // 빈 값이면 메시지 없이 그대로 보낸다.
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

  const startScheduling = () => {
    setScheduling(true);
    setDateStr("");
    setTimeStr("");
    setMessage("");
  };

  const acceptWithSchedule = async () => {
    if (!dateStr || !timeStr) return;
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = new Date(`${dateStr}T${timeStr}`).toISOString();
      const updated = await api.respondToChallenge(challenge.id, "accepted", message.trim() || undefined, scheduledAt);
      onResponded(updated);
      setScheduling(false);
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

  const startReapply = () => {
    setReapplying(true);
    setDateStr("");
    setTimeStr("");
    setMessage(challenge.message);
  };

  const reapply = async () => {
    setErr("");
    setBusy(true);
    try {
      const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr || "00:00"}`).toISOString() : undefined;
      const updated = await api.reapplyChallenge(challenge.id, { scheduledAt, message });
      onResponded(updated);
      setReapplying(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "재신청하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 요청자쪽 인원(본인+같은 편) — Member.avatar는 memberOf로 찾은 것, 없으면 null.
  // 도전자/팀 구성은 재신청 체인 내내 그대로라 페이지와 무관하게 고정이다.
  const creatorSideMembers: SideMember[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers: SideMember[] = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  return (
    <div className="scr-challenge-card">
      <div className="scr-challenge-card-body">
        <div className="scr-challenge-card-row scr-mono scr-challenge-card-when">
          {pageTimeLabel}
          {/* 재신청 이력이 있을 때만 "몇 번째 기록"인지 보여준다(요청: "재신청하면 원래건은
              종료되고 새로운 도전 행이 만들어져... 화면에서는 좌우로 슬라이드되게
              구성하는거야"). */}
          {pages.length > 1 && (
            <span className="scr-challenge-page-note">
              {isLatestPage ? "최신" : `이전 기록 ${pageIndex + 1}/${pages.length}`}
            </span>
          )}
          {/* 결과 보기는 버튼 줄로 따로 한 줄 차지하는 대신 시간 옆에 텍스트 링크로 붙인다
              (요청: "결과보기 버튼은 시간 옆에 텍스트로 배치해서 레이아웃 공간 차지하지
              않게 하자") — 확정 여부와 무관하게 카드 높이가 항상 같아진다. */}
          {isLatestPage && challenge.status === "confirmed" && (
            <button type="button" className="scr-challenge-result-link" onClick={() => onViewResults(challenge)}>
              결과 보기
            </button>
          )}
        </div>

        {/* 매치업 — 도전자편/상대편을 세로로 쌓고, 손가락 이모지는 그 사이 한가운데(요청:
            "손가락 이모티콘을 좀더 도전자와 상대 가운데 느낌에 배치")에 하나만 둔다(팀전도
            팀당 한 개, 요청: "손가락은 한개만 표시"). "누가 도전장 보냄" 태그는 없앴고
            (요청: "이 부분 삭제"), 도전자의 한마디는 도전자편 아래로, 상대 응답 알약은
            그 사람 프로필 옆에 인라인으로, 응답 메시지는 그 아래로 옮겼다(요청: "상대프로필
            옆에 인라인으로 응답상태알약... 및 프로필 아래에 응답 메시지 표시"). */}
        <div className="scr-challenge-matchup">
          <ChallengeSide people={creatorSideMembers} message={page.message} />
          <span className="scr-challenge-arrow" aria-hidden="true">👉🏻</span>
          <ChallengeSide people={targetSideMembers} targets={pageTargetInfos} />
        </div>

        {/* 재신청 이력 탐색은 스와이프(제스처) 없이 화살표/점 버튼으로만 한다(요청: "대결
            카드 슬라이드로 넘기기는 삭제하고 버튼이나 페이징으로만 이동") — 매치업 위에
            겹쳐 뜨던 화살표가 한 줄짜리 한마디와 겹쳤어서(요청: "좌우 버튼을 좀 더
            아래쪽에 배치(지금 한줄메시지랑 겹침)") 아예 매치업 아래, 점과 한 줄로
            묶어 배치한다. 재신청 이력이 없는 카드(대다수)는 이 줄 자체가 안 뜨는데,
            그 자리까지 예약해둬야 이력 있는 카드와 없는 카드가 목록에서 높이가 안
            흔들린다(요청: "아래 페이징 점이 있고 없고에 따라 레이아웃이 흔들리지
            않게 해줘"). */}
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

      {err && <div className="scr-err">{err}</div>}

      {isLatestPage && canRespond && !scheduling && (
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
              // 시간이 아직 안 정해진 도전장이면(요청자가 "상대가 정해도 된다"로
              // 보낸 경우) window.prompt 한 줄로는 날짜+시간을 못 받으니 인라인 폼을
              // 연다 — 이미 시간이 정해진 도전장은 그대로 한마디만 받고 바로 승락한다.
              if (challenge.scheduledAt === null) startScheduling();
              else respond("accepted", "한마디를 입력해 주세요 (선택)", false);
            }}
          >
            {busy ? <Spinner /> : "승락"}
          </button>
        </div>
      )}

      {scheduling && (
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
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setScheduling(false)} disabled={busy}>취소</button>
            <button
              className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={acceptWithSchedule}
              disabled={busy || !dateStr || !timeStr}
            >
              {busy ? <Spinner /> : "승락"}
            </button>
          </div>
        </div>
      )}

      {reapplying && (
        <div className="scr-challenge-time-change-form">
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
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setReapplying(false)} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={reapply} disabled={busy}>
              {busy ? <Spinner /> : "재신청"}
            </button>
          </div>
        </div>
      )}

      {isLatestPage && !reapplying && (canCancel || canReapply) && (
        <div className="scr-challenge-card-actions">
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

type ChallengeFilter = "upcoming" | "ended";
const FILTER_OPTS: { value: ChallengeFilter; label: string }[] = [
  { value: "upcoming", label: "다가오는" }, { value: "ended", label: "종료된" },
];

// 도전장("너 나와!") 게시판 — 예전 "일정" 메뉴 자리를 대체한다. 경기결과/예약 시스템과는
// 독립적인 별도 게시판이라, 화면 자체도 기간 필터 없이 전체 목록을 그대로 보여준다.
export default function ChallengeScreen() {
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);
  const memberOf = useAppStore((s) => s.memberOf);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 다가오는/종료된을 두 섹션에 동시에 늘어놓던 걸 라디오 필터로 바꿔 하나만 보여준다
  // (요청: "다가오는/종료된 대결 구분을 필터창 라디오버튼으로 변경(목록 완전 구분)").
  const [filter, setFilter] = useState<ChallengeFilter>("upcoming");
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getChallenges()
      .then((res) => setChallenges(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // 재신청은 이제 같은 행을 고쳐 쓰지 않고 새 id로 새 도전장을 만든다(요청: "재신청하면
  // 원래건은 종료되고 새로운 도전 행이 만들어져 새 아이디로") — 그 응답(updated)의
  // reappliedFromId가 채워져 있으면, 목록에서 그 원래 도전장은 지우고 새 도전장으로
  // 바꿔 끼운다. 다른 액션(승락/거절/취소 등)은 reappliedFromId가 없으니 이 필터는
  // 그냥 아무 일도 안 한다.
  const upsert = (updated: Challenge) => {
    setChallenges((prev) => {
      const withoutSuperseded = updated.reappliedFromId != null
        ? prev.filter((c) => c.id !== updated.reappliedFromId)
        : prev;
      const exists = withoutSuperseded.some((c) => c.id === updated.id);
      return exists
        ? withoutSuperseded.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...withoutSuperseded];
    });
  };

  const isUpcoming = (c: Challenge): boolean => !isEndedStatus(challengeDisplayStatus(c));

  // 도전장에 관여된 사람(보낸 사람/지목된 상대/같은 팀) 중 검색어와 맞는 사람이 있으면
  // 그 도전장이 남는다 — 경기결과 화면의 참가자 검색과 같은 방식(AND: 검색어 전부가
  // 각각 다른 사람이어도 무방하게 누군가와는 맞아야 한다). 지금 회원인 사람은
  // memberOf로 찾아 닉네임/배틀태그/게임아이디(리플레이 별칭)까지 다 검색하고, 탈퇴 등
  // 으로 더 이상 회원이 아니면 도전장에 남아있는 닉네임 문자열만으로 비교한다.
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

  // 다가오는 = 일시가 얼마 안 남은 순서(임박순) — 미정(날짜 없음)은 임박한 게 아니니
  // 맨 뒤로 보낸다. 종료된 = 그 반대(최근순) — 가장 최근에 마무리된 것부터. 둘 다
  // 일시가 같거나 둘 다 미정이면 등록 순서로 갈린다(다가오는=먼저 등록된 것부터,
  // 종료된=나중에 등록된 것부터).
  const upcomingChallenges = useMemo(() => searchedChallenges.filter(isUpcoming).sort((a, b) => {
    if (a.scheduledAt && b.scheduledAt) {
      if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt ? -1 : 1;
    } else if (a.scheduledAt || b.scheduledAt) {
      return a.scheduledAt ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }), [searchedChallenges]);
  const endedChallenges = useMemo(() => searchedChallenges.filter((c) => !isUpcoming(c)).sort((a, b) => {
    if (a.scheduledAt && b.scheduledAt) {
      if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt > b.scheduledAt ? -1 : 1;
    } else if (a.scheduledAt || b.scheduledAt) {
      return a.scheduledAt ? -1 : 1;
    }
    return a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0;
  }), [searchedChallenges]);

  // "내 대결" — 일정이 지나지 않은(다가오는) 도전장 중 내가 보냈거나(창작자) 지목된
  // (상대) 것만 모아 맨 위에 둔다(요청: "내 대결 파트 추가 (일정이 지나지 않은 내가
  // 보낸/받은 초대장 목록을 보여주는 곳 순서는 일정 시간 가까운 순) 다가오는 대결
  // 목록 위에 배치"). upcomingChallenges가 이미 임박순으로 정렬돼 있어 그대로 필터만
  // 하면 순서가 맞는다. "응답하라!"/"다가오는 대결"과 달리 여기서 뺀다고 저 아래
  // 목록에서 또 안 빼지는 않는다 — 이건 "내 것만 빠르게 훑어보는" 요약이라 전체 목록
  // (다가오는 대결/응답하라!)과 겹쳐도 무방하다.
  const myUpcomingChallenges = useMemo(
    () => upcomingChallenges.filter(
      (c) => c.createdBy.id === user?.id || c.targets.some((t) => t.memberId === user?.id),
    ),
    [upcomingChallenges, user?.id],
  );

  // "응답하라!" — 다가오는 목록 중 아직 응답이 안 끝난 건 전부 모아 맨 위에 둔다(요청:
  // "다가오는 대결에는 응답하라! 섹션을 만들고 맨 위에 배치" → "응답하라는 내꺼 뿐만
  // 아니라 모두다") — 내가 지목된 것만이 아니라, 클럽 전체에서 아직 상대의 응답을
  // 기다리는 도전장이면 누구 것이든 다 보여준다. 날짜 그룹핑 아래 목록에서는 중복으로
  // 또 나오지 않게 뺀다.
  const needsResponse = (c: Challenge): boolean => challengeDisplayStatus(c) === "pending";
  const respondChallenges = useMemo(
    () => upcomingChallenges.filter(needsResponse),
    [upcomingChallenges],
  );
  const restUpcomingChallenges = useMemo(
    () => upcomingChallenges.filter((c) => !needsResponse(c)),
    [upcomingChallenges],
  );

  // "결과 보기" — 리플레이를 직접 여기서 등록하는 대신(리플레이 등록 버튼 제거, 요청:
  // "리플레이 등록 버튼 제거하고 대신 결과 보기 버튼 추가"), 랭킹 화면의 팀 경기 목록
  // 모달을 그대로 재사용해 그 도전장의 팀 구성이 그 날짜에 등록한 경기를 보여준다(요청:
  // "랭킹의 결과 모달 재사용하고 해당일에 등록된 해당 팀구성의 경기 목록 보여주기").
  const [resultsTarget, setResultsTarget] = useState<Challenge | null>(null);
  const resultsMembers: Member[] = useMemo(() => {
    if (!resultsTarget) return [];
    const ids = [resultsTarget.createdBy.id, ...resultsTarget.ownMembers.map((m) => m.memberId)];
    return ids.map((id) => memberOf(id)).filter((m): m is Member => !!m);
  }, [resultsTarget, memberOf]);
  const resultsDateStr = resultsTarget?.scheduledAt ? fmt(new Date(resultsTarget.scheduledAt)) : undefined;

  const activeList = filter === "upcoming" ? upcomingChallenges : endedChallenges;
  const emptyLabel = searchTerms.length > 0
    ? "검색 결과가 없어요"
    : (filter === "upcoming" ? "다가오는 도전장이 없어요" : "종료된 도전장이 없어요");

  return (
    <div className="scr-screen scr-challenge-screen-v2">
      <div className="scr-v2-toolbar">
        {/* 코너명을 "챌린지"에서 "너 나와!"로 완전히 바꾼다(요청: "챌린지 코너명 너
            나와! 로 완전 변경") — 부제가 아니라 타이틀 그 자체. */}
        <h1 className="scr-title scr-v2-toolbar-title">너 나와!</h1>
        <div className="scr-v2-toolbar-actions">
          {/* 아이콘 대신 새가 편지를 물어다 주는 이모지로(요청: "아이콘 삭제하고
              이모티콘 중 새가 편지지 물고 있는거로 교체") — 메신저 비둘기를 상징하는
              🕊️를 쓴다. */}
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
          <FilterItem label="구분">
            <PillTabs options={FILTER_OPTS} value={filter} onChange={setFilter} aria-label="다가오는/종료된 선택" />
          </FilterItem>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : filter === "upcoming" ? (
        <>
          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title">내 대결</h2>
            {/* 없으면 공간을 아끼려고 다른 섹션의 .scr-empty(64px 높이 박스)보다 훨씬
                간단하게 한 줄만 표시한다(요청: "없으면 아주 간단하게 대결 없음 한줄
                표시(공간 절약)"). */}
            {myUpcomingChallenges.length === 0 ? (
              <p className="scr-challenge-my-empty">대결 없음</p>
            ) : (
              <div className="scr-challenge-list">
                {groupChallengesByDate(myUpcomingChallenges).map((g) => (
                  <div key={g.label} className="scr-challenge-date-group">
                    <div className="scr-challenge-date-head scr-mono">
                      {g.isToday && <span className="scr-challenge-card-today-tag">오늘</span>}
                      {g.label}
                    </div>
                    {g.items.map((c) => (
                      <ChallengeCard
                        key={c.id}
                        challenge={c}
                        myId={user?.id}
                        onResponded={upsert}
                        onViewResults={setResultsTarget}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title scr-challenge-section-title-upcoming">다가오는 대결</h2>
            {restUpcomingChallenges.length === 0 ? (
              <div className="scr-empty">{emptyLabel}</div>
            ) : (
              <div className="scr-challenge-list">
                {groupChallengesByDate(restUpcomingChallenges).map((g) => (
                  <div key={g.label} className="scr-challenge-date-group">
                    <div className="scr-challenge-date-head scr-mono">
                      {g.isToday && <span className="scr-challenge-card-today-tag">오늘</span>}
                      {g.label}
                    </div>
                    {g.items.map((c) => (
                      <ChallengeCard
                        key={c.id}
                        challenge={c}
                        myId={user?.id}
                        onResponded={upsert}
                        onViewResults={setResultsTarget}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 응답할 게 없어도 섹션 자체(소타이틀 포함)는 항상 보여준다 — 그래야 "응답하라!"
              라는 영역이 있다는 것 자체가 눈에 띄고, 비어 있을 땐 그 사실을 바로 알 수
              있다(요청: "응답하라! 영역이 없네 소타이틀도 있어야해"). 요청: "응답하라
              목록이 다가오는 아래에 배치" — 처음엔 맨 위였지만 이제 "다가오는 대결"
              아래로 옮긴다. */}
          <section className="scr-challenge-section scr-challenge-section-respond">
            <h2 className="scr-challenge-section-title scr-challenge-section-title-respond">응답하라!</h2>
            {respondChallenges.length === 0 ? (
              <div className="scr-empty">응답할 도전장이 없어요</div>
            ) : (
              <div className="scr-challenge-list">
                {groupChallengesByDate(respondChallenges).map((g) => (
                  <div key={g.label} className="scr-challenge-date-group">
                    <div className="scr-challenge-date-head scr-mono">
                      {g.isToday && <span className="scr-challenge-card-today-tag">오늘</span>}
                      {g.label}
                    </div>
                    {g.items.map((c) => (
                      <ChallengeCard
                        key={c.id}
                        challenge={c}
                        myId={user?.id}
                        onResponded={upsert}
                        onViewResults={setResultsTarget}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="scr-challenge-section">
          <h2 className="scr-challenge-section-title">종료된 대결</h2>
          {endedChallenges.length === 0 ? (
            <div className="scr-empty">{emptyLabel}</div>
          ) : (
            <div className="scr-challenge-list">
              {groupChallengesByDate(endedChallenges).map((g) => (
                <div key={g.label} className="scr-challenge-date-group">
                  <div className="scr-challenge-date-head scr-mono">{g.label}</div>
                  {g.items.map((c) => (
                    <ChallengeCard
                      key={c.id}
                      challenge={c}
                      myId={user?.id}
                      onResponded={upsert}
                      onViewResults={setResultsTarget}
                    />
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
