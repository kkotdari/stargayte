import { useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, MessageSquarePlus } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import OptionalDateTimeFields from "../../components/common/OptionalDateTimeFields";
import ChallengeTimeEditModal from "../../modals/ChallengeTimeEditModal";
import InlineCollapse from "../../components/common/InlineCollapse";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { shareThumb, type KakaoShareContent } from "../../utils/kakaoShare";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import {
  formatWhen, pad,
  DATE_INPUT_MIN, DATE_INPUT_MAX, gameNow,
} from "../../utils/date";
import type { Challenge, ChallengeResult, ChallengeSide, ChallengeTarget } from "../../types";

// 화면 표시 상태는 서버 status를 그대로 쓴다 — 서버가 4개(응답대기 pending/성사 confirmed/
// 완료 done/폐기 discarded)로 확정해 내려준다. 예정 시간이 지나도 결과가 없으면 계속 성사
// (confirmed)고, 거절·무응답·미실시·(레거시)취소는 모두 폐기(discarded)로 통합됐다. 프론트가
// 파생 계산을 하지 않는다(서버가 내려준 status를 그대로 쓴다).

type PillTone = "pending" | "accepted" | "rejected" | "discarded" | "canceled" | "expired";
const PILL_LABEL: Record<PillTone, string> = {
  accepted: "수락", rejected: "거절", discarded: "버림", pending: "대기",
  // 아무도 응답하지 않은 채 끝난 두 가지(요청) — 부른 사람이 거둬들였으면 "취소", 그냥
  // 마감이 지난 것이면 "만료". 둘은 canceledBy 유무로 갈린다.
  canceled: "취소", expired: "만료",
};

// 상대 한 명의 응답 톤 — 수락/거절/버림/대기로 구분한다. 각자의 실제 응답을 그대로 쓴다 —
// 무응답 거절(폐기)이어도 그 사람이 실제로는 응답하지 않았으므로 "대기"로 남는다. "버림"
// (discarded)은 편지봉투를 열지 않고 사유 없이 버린 것으로, 사유가 있는 "거절"(rejected)과
// 구분해 표시한다(요청: "버림으로 상태 표시(거절하고 다른 응답)").
function targetPillInfo(t: ChallengeTarget): { tone: PillTone } {
  if (t.response === "accepted") return { tone: "accepted" };
  if (t.response === "rejected") return { tone: "rejected" };
  if (t.response === "discarded") return { tone: "discarded" };
  return { tone: "pending" };
}

// 상대편 전체(팀전이면 여러 명)를 한 톤으로 요약한다 — 결과가 들어오기 전, 손 이모지 옆
// 공용 슬롯에 띄울 값이다(요청: "응답 상태를 결과 배지 부분과 공유"). 한 명이라도 거절했으면
// 거절, 전원 버려졌으면 버림, 전원 수락이면 수락, 그 외(한 명이라도 아직 대기)엔 대기로
// 본다 — 1:1이면 그 한 명의 응답이 곧 이 값이다.
function aggregateTargetTone(targets: ChallengeTarget[]): PillTone {
  if (targets.length === 0) return "pending";
  const tones = targets.map((t) => targetPillInfo(t).tone);
  if (tones.some((tone) => tone === "rejected")) return "rejected";
  if (tones.every((tone) => tone === "discarded")) return "discarded";
  if (tones.every((tone) => tone === "accepted")) return "accepted";
  return "pending";
}





/** 지금 이 너 나와가 어떤 상태인가 — 한 줄에 곁들일 짧은 말(요청: 목록 내용 칸에 상태).
 *  카드는 이 사실을 손 이모지 양옆 배지 두 개로 나눠 말하는데(누가 취소했나까지 자리로
 *  보여 준다), 한 줄에는 그럴 자리가 없으니 '무슨 일까지 왔나' 하나로 합친다. 판단 근거는
 *  아래 challengeSideBadges와 같다 — 서버가 확정해 준 status가 먼저고, 폐기된 건만
 *  어떤 끝이었는지(challengeEnding)와 상대의 응답으로 갈린다.
 *
 *  톤도 같이 돌려준다(요청: "너 나와 상태 본래 고유 색 사용") — 목록이 이 말을 카드의
 *  응답 배지와 같은 색으로 칠하려면 '무슨 상태인가'를 문자열에서 되짚지 말고 여기서
 *  받아 가야 한다. 색 이름은 .scr-challenge-avatar-badge-* 와 같은 톤 키다. */
export function challengeStatusInfo(c: Challenge): { text: string; tone: PillTone } {
  // 말은 한 낱말로 끝낸다(요청: "응답(거절) 말고 그냥 거절 수락 취소") — 이 자리에 오는
  // 값은 어차피 전부 '상대가 어떻게 나왔나'라, 그 사실을 "응답"이라고 매번 다시 말하면
  // 줄마다 같은 두 글자가 되풀이되면서 정작 다른 부분(수락/거절/버림)이 괄호 안으로
  // 밀려났다. 카드의 응답 배지도 이미 한 낱말만 적는다(PILL_LABEL).
  if (c.status === "pending") return { text: "대기중", tone: "pending" };
  if (c.status === "confirmed") return { text: PILL_LABEL.accepted, tone: "accepted" };
  // 완료는 실제로 붙어서 결과까지 들어온 건이다 — 카드는 그 자리에 승/무를 띄우므로 톤이
  // 따로 없다. 목록에선 '성사됐다'는 뜻이 가장 가까운 수락 색을 그대로 쓴다.
  if (c.status === "done") return { text: "완료", tone: "accepted" };
  const ending = challengeEnding(c);
  if (ending === "canceled") return { text: "취소", tone: "canceled" };
  if (ending === "expired") return { text: "만료", tone: "expired" };
  const tone = aggregateTargetTone(c.targets);
  // 응답이 하나도 없는데 폐기까지 간 건(미실시 등) — 여기서 "대기"는 말이 안 된다.
  return tone === "pending"
    ? { text: "종료", tone: "discarded" }
    : { text: PILL_LABEL[tone], tone };
}

/** 손 이모지 양옆에 붙는 배지 두 개 — 왼쪽이 부른 편, 오른쪽이 지목된 편이다. 카드가
 *  하던 판단(아래 ChallengeCard의 canceledByCreatorSide/targetSideTone과 승/무 배지)을
 *  그대로 한 곳에 모았다. 활동의 목록 보기가 같은 값을 써야 "카드에선 취소인데 목록에선
 *  대기"처럼 한 도전장이 두 얼굴을 갖는 일이 안 생긴다. 빈 자리는 null이다. */
export function challengeSideBadges(c: Challenge): { left: string | null; right: string | null } {
  const ending = challengeEnding(c);
  const canceledById = c.canceledBy?.id ?? null;
  const byCreatorSide = ending === "canceled" && canceledById !== null
    && (canceledById === c.createdBy.id || c.ownMembers.some((m) => m.memberId === canceledById));
  // 결과가 들어왔으면 그 승/무가 응답 상태를 대신한다(카드와 같은 규칙).
  if (c.resultWinnerSide) {
    const draw = c.resultWinnerSide === "draw";
    return {
      left: draw ? "무" : c.resultWinnerSide === "creator" ? "승" : null,
      right: draw ? "무" : c.resultWinnerSide === "target" ? "승" : null,
    };
  }
  const rightTone: PillTone = ending === "canceled" && !byCreatorSide ? "canceled"
    : ending === "expired" ? "expired" : aggregateTargetTone(c.targets);
  return {
    left: byCreatorSide ? PILL_LABEL.canceled : null,
    // 부른 쪽이 거둬들인 건은 상대가 답할 기회 자체가 없었다 — 끝난 건에 "대기"는 아직
    // 기다리는 것처럼 읽힌다(카드도 같은 자리를 비운다).
    right: byCreatorSide && rightTone === "pending" ? null : PILL_LABEL[rightTone],
  };
}

/** 아무 응답도 못 받고 끝난 너 나와가 어떤 끝이었나 — 부른 사람이 거둬들였으면 "취소",
 *  그냥 응답 마감이 지난 것이면 "만료"다(요청: 무응답 거절은 만료로, 취소는 취소로 표시).
 *  응답이 하나라도 있었거나(거절·버림) 결과가 들어온 건(미실시)은 여기 해당하지 않는다 —
 *  그건 그 사람의 응답·결과가 이미 말하고 있다. 아직 안 끝난 건이면 null. */
export function challengeEnding(c: Challenge): "canceled" | "expired" | null {
  if (c.status !== "discarded" || c.resultWinnerSide !== null) return null;
  if (c.canceledBy) return "canceled";
  return c.targets.every((t) => t.response === "pending") ? "expired" : null;
}

/* (삭제) isCanceledChallenge — 아무 응답 없이 끝난 건을 활동에서 통째로 빼던 판정이다.
   이제 활동가 그런 건도 싣고(요청: 거절/무응답거절/취소도 나오게), 취소와 만료를 갈라
   보여주므로(위 challengeEnding) 이 함수가 하던 일이 없어졌다. */

type SideMember = { id: string; nickname: string; avatar: string | null };

// 팀 구성 한 편(도전자편/상대편)을 세로로 쌓는다(요청: "각팀을 세로로 배치") — 1:1이든
// 팀전이든 모양은 같고, 인원이 하나든 여럿이든 그냥 줄 수만 늘어난다.
function ChallengeSide({
  people, targets, highlightMemberIds, messageOf,
}: {
  people: SideMember[];
  targets?: { target: ChallengeTarget }[];
  // 유저 검색에 걸린 사람 — 경기결과 로스터와 같은 반전색으로 프사+닉네임을 함께 칠한다
  // (요청: "랭킹, 너 나와 유저 검색시 하이라이팅 추가 단! 닉네임뿐 아니라 프사까지").
  highlightMemberIds?: Set<string>;
  // 그 사람의 한마디(호출자의 challenge.message / 지목자의 responseMessage) — 있으면
  // 그 사람 줄 바로 아래에 붙인다(지적: 예전 너 나와 때처럼 로스터의 해당 유저 아랫줄에
  // 줄 맞춰서). 없으면 아무것도 안 그린다.
  messageOf?: (personId: string) => string | null | undefined;
}) {
  return (
    <div className={cx("scr-challenge-side", targets && "scr-challenge-side-target")}>
      {people.map((p) => {
        const msg = messageOf?.(p.id);
        // 인스타그램식 배치(요청) — 아바타를 왼쪽 칸에 크게 두고, 닉네임·한마디는 전부
        // 오른쪽 칸에 세로로 쌓는다. 예전엔 아바타가 닉네임과 한 줄(scr-challenge-person)에
        // 나란히 있어 아바타를 키우기 어려웠고, 한마디도 그 줄 밑에 아바타 폭만큼
        // margin-left로 억지로 들여써야 했다.
        //
        // 응답 배지(대기/수락/거절)는 더 이상 여기(사람 옆)에 안 찍는다(요청: "응답 상태를
        // 결과 배지 부분과 공유해서 사용 — 결과 배지가 들어가면 응답 상태는 불필요") — 손
        // 이모지 옆 공용 슬롯(ChallengeCard의 scr-challenge-arrow-row) 하나가 결과 입력
        // 전에는 응답 상태를, 입력 후에는 승/무 결과를 보여준다.
        //
        // 그리드로 짠다(요청: "아바타가 닉네임 및 손 이모지, 응답 배지와 세로로 가운데
        // 정렬되게") — 아바타는 1행에만 놓여 그 행의 트랙 높이를 자기 크기(34px)만큼
        // 밀어 올리고, 닉네임 줄은 그 행 안에서 align-self:center로 가운데 앉는다(=아바타와
        // 같은 중심선). 한마디는 2행으로 따로 떨어져(요청: "말풍선은 아래쪽에 위치하는
        // 느낌으로") 아바타 높이와 무관하게 밑에 붙는다. flex였다면 아바타 높이가
        // 그대로 전체 블록 정렬 기준이 돼(align-items:center) 한마디까지 포함한 전체
        // 높이 기준으로 가운데 잡혀버렸을 것이다 — 그리드는 행이 갈려 있어 1행(닉네임)만
        // 따로 기준 삼을 수 있다.
        return (
          <div
            key={p.id}
            className={cx("scr-challenge-side-block", highlightMemberIds?.has(p.id) && "scr-challenge-person-hit")}
          >
            <Avatar member={p} size={34} className="scr-challenge-side-avatar" />
            <div className="scr-challenge-side-row">
              <span className="scr-challenge-person-name">{p.nickname}</span>
            </div>
            {/* 한마디 — 따옴표 없이, 닉네임보다 한 단계 작은 글자로(요청). 있든 없든 항상
                이 자리를 그린다(요청: "한마디가 있건 없건 레이아웃 유지되게 자리를 예약")
                — 없으면 보이지만 않게(visibility:hidden) 하고 자리는 그대로 차지해서,
                같은 편 안에서 어떤 사람은 한마디가 있고 어떤 사람은 없어도 줄 높이가
                들쭉날쭉해지지 않는다. */}
            {/* 글자는 한 겹 안쪽에 둔다 — 한 줄 넘김 자르기는 overflow:hidden을 요구하는데
                그걸 말풍선 자신에 걸면 상자 밖으로 나가 있는 꼬리(::before)까지 잘려 나간다. */}
            <span className={cx("scr-challenge-side-msg", !msg && "scr-challenge-side-msg-empty")}>
              <span className="scr-challenge-side-msg-text">{msg || " "}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 카드가 지금 어떤 인라인 폼을 펼치고 있는지 — 한 번에 하나만 열린다. result는 결과 입력 폼이다.
type CardMode = "none" | "result";

interface ChallengeCardProps {
  challenge: Challenge;
  myId: string | undefined;
  // 유저 검색에 걸린 사람들 — 카드 안 프사+닉네임을 반전색으로 칠한다.
  highlightMemberIds?: Set<string>;
  // 읽기 전용 — "버려진 도전장" 모달에서 쓴다. 응답/결과입력 등 모든 액션 버튼을 감춘다.
  readOnly?: boolean;
  onResponded: (updated: Challenge) => void;
}

export function ChallengeCard({ challenge, myId, highlightMemberIds, readOnly, onResponded }: ChallengeCardProps) {
  const memberOf = useAppStore((s) => s.memberOf);
  const user = useAppStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  // 카드에서 수락/거절을 하면, 인박스와 똑같이 확인창(+카카오 공유)을 띄운다(요청).
  // 이 창을 닫을 때 비로소 onResponded로 목록을 갱신한다.
  const [sharePrompt, setSharePrompt] = useState<
    { kind: "accepted" | "rejected"; updated: Challenge } | null
  >(null);
  const [err, setErr] = useState("");
  const myTarget = challenge.targets.find((t) => t.memberId === myId);
  const isCreator = challenge.createdBy.id === myId;
  const inOwnTeam = challenge.ownMembers.some((m) => m.memberId === myId);
  // 이 너 나와의 참가자인지 — 결과 입력 버튼 노출 판정에 쓴다.
  const isParticipant = isCreator || inOwnTeam || !!myTarget;
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
  /* 아무 응답 없이 끝난 두 가지(요청) — 취소는 취소한 사람 자리에, 만료는 상대 응답
     자리에 적는다. 손 이모지 양옆의 배지 자리를 그대로 쓴다: 왼쪽이 부른 편, 오른쪽이
     지목된 편이라, 누가 거둬들였는지가 자리만으로 읽힌다. */
  const ending = challengeEnding(challenge);
  const canceledById = challenge.canceledBy?.id ?? null;
  const canceledByCreatorSide = ending === "canceled" && canceledById !== null
    && (canceledById === challenge.createdBy.id
      || challenge.ownMembers.some((m) => m.memberId === canceledById));
  const canceledByTargetSide = ending === "canceled" && !canceledByCreatorSide;
  /* 지목된 편 배지 — 결과가 나오기 전에는 응답 상태를 보여주는 자리다. 아무도 응답 못 한
     채 끝났으면 그 사실("만료")이 "대기"보다 정확하다(요청: 무응답 거절은 만료로 표시). */
  const targetSideTone: PillTone = canceledByTargetSide ? "canceled"
    : ending === "expired" ? "expired" : aggregateTargetTone(challenge.targets);

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

  // 요청자쪽 인원(본인+같은 편).
  const creatorSideMembers: SideMember[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers: SideMember[] = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  // 확인창을 닫을 때 비로소 목록을 갱신한다.
  const dismissShare = () => {
    const p = sharePrompt;
    setSharePrompt(null);
    if (p) onResponded(p.updated);
  };
  // 확인창 제목/설명 — 수락/거절에 맞춰. (인박스의 응답 확인창과 같은 톤.)
  const sharePromptTitle = sharePrompt?.kind === "rejected" ? "대결 거절" : "대결 수락!";
  const sharePromptWhen = formatWhen(sharePrompt?.updated?.scheduledDate);
  const sharePromptDesc =
    sharePrompt?.kind === "rejected" ? "호출을 거절했어요." : `${sharePromptWhen}에 만나요.`;
  // 카카오 공유 내용 — 인박스 응답 공유(ChallengeInboxModal의 shareResponded)와 같은 문구다.
  // 공유 카드는 "누가 누구의 호출에 응답했다"까지만 말한다(요청) — 수락인지 거절인지도,
  // 대진도, 정해진 일시도 내지 않는다. 그걸 카드에 적으면 링크를 열어 볼 이유가 사라진다
  // (호출 공유가 지목 상대를 감추는 것과 같은 이유). 그래서 수락/거절이 같은 문구다.
  const buildShareContent = (): KakaoShareContent => {
    const caller = challenge.createdBy.nickname || "누군가";
    const me = user?.nickname || "누군가";
    const link = `${window.location.origin}/?sv=challenge&sid=${sharePrompt?.updated.id ?? challenge.id}`;
    return {
      title: `${me}님이 ${caller}님의 호출에 응답했어요`,
      description: "수락일까요, 거절일까요? 👀 탭해서 확인하기",
      ...shareThumb("challengeReply"), link,
      fallbackText: `[스타게이트] ${me}님이 ${caller}님의 호출에 응답했어요! 열어서 확인해보세요.`,
    };
  };

  const activeTargetInfos = challenge.targets.map((t) => ({ target: t }));

  // 이미 종료된 너 나와!(완료/미실시 등 status=done·discarded)은 패널을 더 어둡게, 아직 진행
  // 중인(응답대기·성사) 너 나와는 더 밝게 해서 목록에서 한눈에 구분되게 한다(요청).
  const isEnded = challenge.status === "done" || challenge.status === "discarded";

  return (
    <div className={cx("scr-challenge-card", isEnded ? "scr-challenge-card-ended" : "scr-challenge-card-active", challenge.matchType === "0102" && "scr-challenge-card-team", ending && "scr-challenge-card-canceled")}>
      {/* (삭제) 우상단 "취소" 라벨 — 예전엔 응답 없이 끝난 건을 카드 귀퉁이에 통째로 표시했다.
          이제 취소는 거둬들인 사람 자리에, 만료는 상대 응답 자리에 적히므로(요청) 같은 말을
          두 번 하는 셈이고, 절대 배치라 헤더가 바깥에 있는 활동에서는 로스터 첫 줄 위에
          겹치기까지 했다. 끝난 티는 카드 자체를 흐리게 하는 것(-canceled)으로 충분하다. */}
      {/* 편지지 배경 사진은 이 카드가 아니라 이 카드를 담은 활동 카드의 본문
          (.scr-activity-card-body)에 깔린다(요청) — ActivityScreen 참고. 여기 깔면
          로스터 폭만큼만 덮여, 카드가 아니라 로스터에 붙은 그림처럼 보인다. */}
      <div className="scr-challenge-card-body">
        {/* 약속한 "언제" — 로스터 바로 위에 그냥 글로 보여준다(요청: 인풋창이 아니라
            텍스트로). 안 적었으면 줄 자체를 안 만든다. */}
            {challenge.scheduledTimeNote.trim() && (
              <div className="scr-challenge-when-note">
                <span className="scr-challenge-when-label">언제</span>
                {challenge.scheduledTimeNote}
              </div>
            )}

            <div className="scr-challenge-matchup">
              <ChallengeSide
                people={creatorSideMembers} highlightMemberIds={highlightMemberIds}
                // 호출자의 한마디(challenge.message)는 호출자 본인 줄에만 붙는다 — 같은 편
                // 팀원(ownMembers)에게는 없다.
                messageOf={(id) => (id === challenge.createdBy.id ? challenge.message : null)}
              />
              {/* 승/무 배지 — 이긴 편 쪽으로(손 이모지 기준 이긴 편이 있는 방향에) 붙인다
                  (요청: "승리배지는 손 이모지 옆에 표시(이긴쪽에)"). 자리가 좁아 "승리"
                  대신 한 글자만(요청: "좁아서 그냥 승/무 한글자 배지로 표시해야할듯").
                  무승부는 어느 한쪽 편이 아니라 양쪽 다 표시한다. 도전자편은 개별 응답이
                  없어(ChallengeOwnMember 참고) 결과가 나오기 전엔 항상 자리만 예약해 두고
                  투명하게 비운다(visibility:hidden) — 안 그러면 페이지를 넘길 때 배지
                  유무에 따라 손 이모지가 좌우로 흔들린다(요청: "손이모지 양옆에도 승리/
                  무승부 배지 넣을 공간 예약해야함"). 상대편은 개별 응답이 있으므로, 결과가
                  나오기 전엔 그 자리에 응답 상태(대기/수락/거절/버림)를 대신 보여준다
                  (요청: "응답 상태를 결과 배지 부분과 공유해서 사용 — 결과 배지가 들어가면
                  응답 상태는 불필요하므로"). */}
              <span className="scr-challenge-arrow-row">
                {canceledByCreatorSide ? (
                  // 부른 쪽이 거둬들인 것 — 그 사람 자리에 "취소"라고 적는다(요청).
                  <span className="scr-challenge-inline-win scr-challenge-inline-status scr-challenge-avatar-badge-canceled">
                    {PILL_LABEL.canceled}
                  </span>
                ) : (
                  <span
                    className={cx(
                      "scr-challenge-inline-win",
                      challenge.resultWinnerSide === "draw" && "scr-challenge-inline-draw",
                      challenge.resultWinnerSide !== "creator" && challenge.resultWinnerSide !== "draw"
                        && "scr-challenge-inline-win-hidden",
                    )}
                  >
                    {challenge.resultWinnerSide === "draw" ? "무" : "승"}
                  </span>
                )}
                <span className="scr-challenge-arrow" aria-hidden="true">👉🏻</span>
                {challenge.resultWinnerSide ? (
                  <span
                    className={cx(
                      "scr-challenge-inline-win",
                      challenge.resultWinnerSide === "draw" && "scr-challenge-inline-draw",
                      challenge.resultWinnerSide !== "target" && challenge.resultWinnerSide !== "draw"
                        && "scr-challenge-inline-win-hidden",
                    )}
                  >
                    {challenge.resultWinnerSide === "draw" ? "무" : "승"}
                  </span>
                ) : (
                  <span
                    className={cx(
                      "scr-challenge-inline-win", "scr-challenge-inline-status",
                      `scr-challenge-avatar-badge-${targetSideTone}`,
                      // 부른 쪽이 거둬들인 건은 상대가 답할 기회 자체가 없었다 — 끝난 카드에
                      // "대기"는 아직 기다리는 것처럼 읽히므로 자리만 비워 둔다(우상단
                      // "취소" 라벨과 부른 쪽 배지가 이미 무슨 일이었는지 말한다).
                      canceledByCreatorSide && targetSideTone === "pending"
                        && "scr-challenge-inline-win-hidden",
                    )}
                  >
                    {PILL_LABEL[targetSideTone]}
                  </span>
                )}
              </span>
              <ChallengeSide
                people={targetSideMembers} targets={activeTargetInfos} highlightMemberIds={highlightMemberIds}
                // 지목된 상대의 응답 한마디 — 그 사람 줄 아래에(위 messageOf 참고).
                messageOf={(id) => challenge.targets.find((t) => t.memberId === id)?.responseMessage}
              />
            </div>
      </div>

      {err && <div className="scr-err">{err}</div>}

      {/* 응답 버튼(수락/거절) — 읽기 전용(버려진 도전장 모달)에서는 어떤 액션도 없다. */}
      {!readOnly && canRespond && (
        <InlineCollapse open={mode === "none"}>
        <div className="scr-challenge-respond">
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

      {/* 결과 입력 폼 — 조건부 마운트 대신 InlineCollapse로 늘 마운트해 두고 열림/닫힘
          모두 부드럽게 접었다 편다(요청: "트랜지션을 지금보다 길고 부드럽게, 취소로
          원복될 때도"). */}
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

      {/* 결과 입력 — 인라인 폼이 안 열려 있을 때만 뜨는 액션 줄. 이 줄도 InlineCollapse로
          감싸 폼이 열릴 땐 부드럽게 접히고, 취소로 폼이 접힐 땐 부드럽게 되살아난다. */}
      {!readOnly && canEnterResult && (
        <InlineCollapse open={mode === "none"}>
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={startResult} disabled={busy}>
              결과 입력
            </button>
          </div>
        </InlineCollapse>
      )}

      {/* 카드에서 수락/거절을 하면 뜨는 확인창 — 인박스와 똑같이 카카오 공유를
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
// timeLabel을 null로 주면 시각 라벨 없이 연필(수정 진입)만 남는다 — 활동에선 헤더행이
// 이미 시각을 보여주므로 중복 표기를 피해 연필만 그 옆에 얹는다(요청: "시간이 중복 표시").
//
// 수정은 이 자리에서 펼치지 않고 팝업으로 넘긴다(요청: "인라인 폐기하고 팝업으로") — 여기는
// 시각 한 줄이라 날짜·"언제"·취소·확인을 담을 폭이 없었다. 그래서 이 컴포넌트에는 남는 일이
// 라벨과 연필뿐이고, 높이 모핑(예전의 scr-challenge-time-head-wrap)도 필요 없어졌다.
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

  // 라벨도 없고 수정 권한도 없으면 그릴 게 없다(활동의 연필 전용 모드에서 비참가자).
  if (timeLabel === null && !canEdit) return null;

  return (
    <>
      <span className="scr-challenge-time-head">
        {timeLabel !== null && <span className="scr-challenge-time-head-label">{timeLabel}</span>}
        {canEdit && (
          <button
            type="button" className="scr-challenge-time-edit-btn"
            onClick={() => setEditing(true)} aria-label="일시 수정"
          >
            <Pencil size={13} />
          </button>
        )}
      </span>
      {editing && (
        <ChallengeTimeEditModal
          challenge={challenge}
          onClose={() => setEditing(false)}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}
