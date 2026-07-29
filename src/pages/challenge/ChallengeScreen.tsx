import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, MessageSquarePlus, X, Check, Calendar } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import OptionalDateTimeFields, {
  openPicker, TIME_NOTE_MAX, TIME_NOTE_PLACEHOLDER,
} from "../../components/common/OptionalDateTimeFields";
import InlineCollapse from "../../components/common/InlineCollapse";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import {
  formatWhen, formatRelativeSchedule, pad,
  DATE_INPUT_MIN, DATE_INPUT_MAX, gameNow,
} from "../../utils/date";
import type { Challenge, ChallengeResult, ChallengeSide, ChallengeStatus, ChallengeTarget } from "../../types";

// 화면 표시 상태는 서버 status를 그대로 쓴다 — 서버가 4개(응답대기 pending/성사 confirmed/
// 완료 done/폐기 discarded)로 확정해 내려준다. 예정 시간이 지나도 결과가 없으면 계속 성사
// (confirmed)고, 거절·무응답·미실시·(레거시)취소는 모두 폐기(discarded)로 통합됐다. 프론트가
// 파생 계산을 하지 않는다(서버가 내려준 status를 그대로 쓴다).

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
                <Avatar member={p} size={20} />
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
  scheduledDate: string | null;
  scheduledTimeNote: string;
  targets: ChallengeTarget[];
  status: ChallengeStatus;
  createdAt: string;
  resultWinnerSide: ChallengeResult | null;
}

// 카드가 지금 어떤 인라인 폼을 펼치고 있는지 — 한 번에 하나만 열린다. schedule은 일시 미정
// 도전장을 수락하며 시간을 정하는 폼, revenge는 리벤지 신청, result는 결과 입력.
type CardMode = "none" | "revenge" | "result";

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

export function ChallengeCard({ challenge, myId, highlightMemberIds, readOnly, onResponded }: ChallengeCardProps) {
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
        id: h.id, scheduledAt: h.scheduledAt, scheduledDate: h.scheduledDate,
        scheduledTimeNote: h.scheduledTimeNote,
        targets: h.targets, status: h.status, createdAt: h.createdAt, resultWinnerSide: h.resultWinnerSide,
      })),
      {
        id: challenge.id, scheduledAt: challenge.scheduledAt, scheduledDate: challenge.scheduledDate,
        scheduledTimeNote: challenge.scheduledTimeNote, targets: challenge.targets,
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
  const [noteStr, setNoteStr] = useState("");
  // 요청자가 이미 정해서 온 값은 응답자가 못 바꾸게 잠근다(요청: "이미 입력되어 온 값은
  // 수정불가"). 날짜만 온 도전장은 날짜는 잠긴 채 "언제"만 덧붙일 수 있다(요청).
  const dateLocked = challenge.scheduledDate !== null;
  const noteLocked = challenge.scheduledTimeNote.trim() !== "";
  // 응답 한마디(선택) — 아이콘 버튼을 눌러야 입력창이 트랜지션으로 열린다(요청).
  const [respondMessage, setRespondMessage] = useState("");
  const [respondMsgOpen, setRespondMsgOpen] = useState(false);
  // 리벤지 한마디(선택) — 응답 한마디와 같은 방식(요청: 리벤지 요청에도 한마디).
  const [revengeMessage, setRevengeMessage] = useState("");
  const [revengeMsgOpen, setRevengeMsgOpen] = useState(false);

  // 카드에서 바로 승락/거절 — 한마디(선택)와 함께 응답한다. 네이티브 confirm 창은 띄우지
  // 않고(요청) 누르는 즉시 응답하고, 성공하면 공유 확인창으로 넘어간다.
  const respond = async (response: "accepted" | "rejected") => {
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

  const startRevenge = () => { setMode("revenge"); setDateStr(""); setNoteStr(""); setRevengeMessage(""); setRevengeMsgOpen(false); };
  // 결과 입력을 열 때 날짜를 미리 채운다 — 이미 예정 날짜가 있으면 그걸로, 없으면 오늘로
  // 시작한다(시각은 더 이상 다루지 않는다). 실제 값은 사용자가 확인/수정한다.
  const startResult = () => {
    const now = gameNow();
    setDateStr(challenge.scheduledDate ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    setMode("result");
    setErr("");
  };
  const closeMode = () => setMode("none");

  const acceptWithSchedule = async () => {
    setErr("");
    setBusy(true);
    try {
      // 확정 일정 = 이미 정해져 온 값(잠김)이 있으면 그걸, 없으면 응답자가 입력한 값.
      // 날짜가 없으면 "언제"도 버린다 — 가리킬 날이 없다.
      const finalDate = challenge.scheduledDate ?? (dateStr || null);
      const note = challenge.scheduledTimeNote.trim() || (finalDate ? noteStr.trim() : "");
      const schedule = { scheduledDate: finalDate, scheduledTimeNote: note };
      const updated = await api.respondToChallenge(challenge.id, "accepted", schedule, respondMessage.trim());
      closeMode();
      setSharePrompt({ kind: "accepted", updated });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 리벤지(설욕전) 신청 — 날짜는 비워서 보낼 수 있다(승리한 쪽이 수락하며 정함).
  const submitRevenge = async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.requestRevenge(challenge.id, {
        scheduledDate: dateStr || null,
        scheduledTimeNote: dateStr ? noteStr.trim() : "",
        message: revengeMessage.trim(),
      });
      closeMode();
      setSharePrompt({ kind: "revenge", updated });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "설욕전을 신청하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (winnerSide: ChallengeResult) => {
    // 결과 입력 시엔 날짜가 무조건 필요하다(요청. 시각은 더 이상 다루지 않는다).
    if (!dateStr) { setErr("실제 대결 날짜를 입력하세요."); return; }
    setErr("");
    setBusy(true);
    try {
      const updated = await api.enterChallengeResult(challenge.id, winnerSide, dateStr);
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
  const sharePromptWhen = formatWhen(sharePrompt?.updated?.scheduledDate);
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
    const imageUrl = `${window.location.origin}/images/challenge/challenge_share_thumb.jpg`;
    if (sharePrompt?.kind === "rejected") {
      return { title: "대결 거절", description: matchup, imageUrl, link,
        fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출을 거절했어요.\n${matchup}` };
    }
    if (sharePrompt?.kind === "revenge") {
      return { title: "설욕전 신청!", description: matchup, imageUrl, link,
        fallbackText: `[스타게이트] ${me}님이 설욕전을 신청했어요!\n${matchup}` };
    }
    return { title: "대결 수락!", description: `${matchup} · ${sharePromptWhen}`, imageUrl, link,
      fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출을 수락했어요!\n${matchup}\n일시: ${sharePromptWhen}` };
  };

  // 지금 실제로 보여주는 페이지(renderedIndex — 크로스페이드로 pageIndex보다 살짝 늦게
  // 따라온다) 하나만 자연 높이로 렌더한다. pages가 줄어드는 드문 경우에도 안전하게 클램프.
  const shownIndex = Math.min(renderedIndex, pages.length - 1);
  const activePage = pages[shownIndex];
  const activeTargetInfos = activePage.targets.map((t) => ({ target: t }));
  // 체인은 이제 리벤지(revenge) 하나뿐 — 체인의 첫 페이지(원본)를 뺀 나머지 페이지가 곧
  // 리벤지 기록이다(reappliedFromId를 따로 안 봐도 페이지 순번으로 안다).
  const isRevengePage = shownIndex > 0;

  // 상태 배지(무승부/완료/결과 입력 대기/미실시)와 카드 내 카운트다운은 전부 삭제됐다(요청:
  // "종료 이런 배지 부분 완전 삭제" — 카운트다운은 피드 헤더행으로 이동). 이 맨 윗줄엔
  // 리벤지 체인 라벨만 남는다.
  const whenHasContent = isRevengePage;

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
                <span className="scr-challenge-chain-tag scr-challenge-chain-tag-revenge">설욕전</span>
              )}
            </div>
            )}

            {/* 약속한 "언제" — 로스터 바로 위에 그냥 글로 보여준다(요청: 인풋창이 아니라
                텍스트로). 안 적었으면 줄 자체를 안 만든다. 최신 페이지만 이 값을 갖는다
                (체인 앞 기록은 페이지 데이터에 담아 온 값을 쓴다). */}
            {activePage.scheduledTimeNote.trim() && (
              <div className="scr-challenge-when-note">{activePage.scheduledTimeNote}</div>
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
                    activePage.resultWinnerSide === "draw" && "scr-challenge-inline-draw",
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
                    activePage.resultWinnerSide === "draw" && "scr-challenge-inline-draw",
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
          {/* 날짜·"언제"를 입력칸 형태로 보여준다(요청: "텍스트가 아니라 인풋창 그대로").
              이미 정해져 온 값은 잠긴(수정불가) 입력칸으로, 비어 있는 쪽은 지금 채울 수 있다 —
              날짜만 온 도전장은 "언제"만 덧붙일 수 있다(요청). */}
          <OptionalDateTimeFields
            dateStr={dateLocked ? challenge.scheduledDate! : dateStr}
            onDateChange={setDateStr}
            noteStr={noteLocked ? challenge.scheduledTimeNote : noteStr}
            onNoteChange={setNoteStr}
            dateLocked={dateLocked}
            noteLocked={noteLocked}
          />
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
            onClick={acceptWithSchedule}
          >
            {busy ? <Spinner /> : ((challenge.scheduledDate ?? dateStr) ? "승락" : "시간 미정 승락")}
          </button>
          </div>
        </div>
        </InlineCollapse>
      )}

      {/* 인라인 폼들(승락 시간지정/리벤지/결과입력) — 조건부 마운트 대신 InlineCollapse로
          늘 마운트해 두고 열림/닫힘 모두 부드럽게 접었다 편다(요청: "트랜지션을 지금보다
          길고 부드럽게, 취소로 원복될 때도"). */}
      <InlineCollapse open={mode === "revenge"}>
        <div className="scr-challenge-time-change-form">
          {/* 날짜·"언제"는 승락 폼과 같은 공용 컴포넌트로(요청: "인라인 응답에서 수정한거
              참고해서 공통화") — 날 것의 네이티브 인풋을 그대로 쓰면 피드 카드 폭을 뚫고
              나가는 등 스타일이 깨진다(지적). 라벨/지우기 동작도 함께 통일된다. */}
          <OptionalDateTimeFields
            dateStr={dateStr}
            onDateChange={setDateStr}
            noteStr={noteStr}
            onNoteChange={setNoteStr}
          />
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
              {busy ? <Spinner /> : "설욕전 신청"}
            </button>
          </div>
        </div>
      </InlineCollapse>

      <InlineCollapse open={mode === "result"}>
        <div className="scr-challenge-result-form">
          <p className="scr-challenge-inbox-message">
            실제 대결 날짜·시간을 정하고, 승리한 팀을 눌러주세요 — 먼저 입력하는 쪽이 그대로 인정돼요.
          </p>
          {/* 결과 입력 시엔 날짜/시간을 무조건 함께 넣는다(요청). 시간 칸은 비어 있을 때
              누르면 21시로 열린다(onFocus). */}
          <div className="scr-challenge-time-edit-row scr-challenge-result-when">
            <input
              type="date" className="scr-input scr-challenge-time-edit-input"
              value={dateStr} min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </div>
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
                설욕전 신청
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
        <div className="scr-challenge-page-when">{formatRelativeSchedule(activePage)}</div>
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
                <KakaoShareButton variant="full" iconOnly content={buildShareContent} />
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




// 시각 헤더(scr-challenge-time-head)는 같은 시각의 카드들 맨 위에 한 번만 뜨는데, 진행중
// (성사)인 너 나와는 그 시각 옆에 연필 아이콘으로 일시를 바로 수정할 수 있다(요청: "너나와
// 목록에서 진행중인건은 날짜와 시간 수정이 가능하게할거야, 시간 옆에 연필모양 아이콘 추가,
// 권한은 참가자 또는 운영자는 가능하게"). 같은 시각에 서로 다른 너 나와가 여럿 묶이면(드묾)
// 어느 것을 수정할지 모호해지므로, 그 시각 그룹에 너 나와가 정확히 하나일 때만 연필을
// 보여준다 — 호출부(groupByTime map)에서 tg.items.length===1일 때만 이 컴포넌트를 쓴다.
// timeLabel을 null로 주면 시각 라벨 없이 연필(수정 진입)만 남는다 — 피드에선 헤더행이
// 이미 시각을 보여주므로 중복 표기를 피해 연필만 그 옆에 얹는다(요청: "시간이 중복 표시").
export function ChallengeTimeHeadEdit({
  challenge, timeLabel, myId, onUpdated,
}: {
  challenge: Challenge; timeLabel: string | null; myId: string | undefined;
  onUpdated: (updated: Challenge) => void;
}) {
  const isParticipant =
    challenge.createdBy.id === myId
    || challenge.ownMembers.some((m) => m.memberId === myId)
    || challenge.targets.some((t) => t.memberId === myId);
  // 일시 수정은 참가자만 — 운영자여도 참가자가 아니면 못 고친다(요청).
  const canEdit = challenge.status === "confirmed" && isParticipant;

  const [editing, setEditing] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [noteStr, setNoteStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const startEdit = () => {
    // 저장된 날짜와 "언제"를 그대로 열어 편집한다 — 안 적혀 있으면 빈 칸으로 연다.
    setDateStr(challenge.scheduledDate ?? "");
    setNoteStr(challenge.scheduledTimeNote);
    setErr("");
    setEditing(true);
  };

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      // 날짜/"언제" 모두 선택 — 날짜를 비우면 일정 전체 미정이 된다(요청: "제약 없이 다 열어두기").
      const updated = await api.rescheduleChallenge(
        challenge.id, dateStr || null, dateStr ? noteStr.trim() : "",
      );
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

  // 라벨도 없고 수정 권한도 없으면 그릴 게 없다(피드의 연필 전용 모드에서 비참가자).
  if (timeLabel === null && !canEdit) return null;

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
              <span className="scr-datetime-input-wrap scr-challenge-time-edit-cell">
                <input
                  type="date" className="scr-input scr-challenge-time-edit-input"
                  value={dateStr}
                  min={DATE_INPUT_MIN} max={DATE_INPUT_MAX}
                  onClick={openPicker}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateStr(v);
                    // 날짜를 지우면 "언제"도 비운다 — 가리킬 날이 없다.
                    if (!v) setNoteStr("");
                  }}
                />
                {/* 스왑(요청): 값 있으면 지우기 ×, 없으면 달력 아이콘 — 같은 오른쪽 자리. */}
                {dateStr ? (
                  <button
                    type="button" className="scr-datetime-clear" aria-label="날짜 지우기"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setDateStr(""); setNoteStr(""); }}
                  >
                    <X size={12} />
                  </button>
                ) : (
                  <span className="scr-datetime-picker-icon" aria-hidden="true"><Calendar size={15} /></span>
                )}
              </span>
              {/* "언제"(자유 텍스트) — 시각 대신 사람 말로 적는 자리(요청). */}
              <span className="scr-datetime-input-wrap scr-challenge-time-edit-cell">
                <input
                  type="text" className="scr-input scr-challenge-time-edit-input"
                  value={noteStr} placeholder={TIME_NOTE_PLACEHOLDER} maxLength={TIME_NOTE_MAX}
                  onChange={(e) => setNoteStr(e.target.value)} disabled={!dateStr}
                />
                {dateStr && noteStr && (
                  <button
                    type="button" className="scr-datetime-clear" aria-label="언제 지우기"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setNoteStr("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
              {/* 취소/확인을 기존 아이콘 버튼(scr-icon-btn) 스타일로, 크기만 이 행에 맞게
                  살짝 줄인다(요청). 확인은 체크에 포인트 색을 준다. */}
              <button
                type="button" className="scr-icon-btn scr-time-edit-action"
                onClick={() => setEditing(false)} disabled={busy} aria-label="취소"
              >
                <X size={16} />
              </button>
              <button
                type="button" className="scr-icon-btn scr-time-edit-action scr-time-edit-confirm"
                onClick={save} disabled={busy} aria-label="확인"
              >
                {busy ? <Spinner /> : <Check size={16} />}
              </button>
            </div>
            {err && <div className="scr-err">{err}</div>}
          </div>
        ) : (
          <div className="scr-challenge-time-head">
            {timeLabel !== null && <span className="scr-challenge-time-head-label">{timeLabel}</span>}
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
