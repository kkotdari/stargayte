import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Mail, Upload } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import { challengeDateGroupLabel, challengeTimeLabel, isToday } from "../../utils/date";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import type { Challenge } from "../../types";

const MAX_REPLAY_FILES = 20;

// 카드 맨 위 상태 배지 하나로 충분하니 참가자별 개별 응답 배지는 없앤다(요청: "상태는
// 상단에만 나오게 하고 요청받은 사람 상태는 굳이 안보여줘도 될듯"). 그 김에 "확정"도
// 결과가 등록됐는지에 따라 "승락"(아직 안 뛴 확정)과 "완료"(결과까지 등록된 확정)로
// 더 갈랐다 — status 자체는 그대로 confirmed 하나지만 화면 표시는 둘로 나뉜다.
function challengeStatusLabel(c: Challenge): string {
  if (c.status === "confirmed") return c.resultMatchId ? "완료" : "승락";
  if (c.status === "rejected") return "거절";
  if (c.status === "canceled") return "취소";
  return "응답대기중";
}
function challengeStatusClass(c: Challenge): string {
  if (c.status === "confirmed" && c.resultMatchId) return "scr-challenge-status-done";
  return `scr-challenge-status-${c.status}`;
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

// 매치업 헤드라인의 한쪽(요청자편/상대편) — 1명이면 그 사람만 크게, 2명 이상(팀전,
// 4:4까지도)이면 전원을 아바타-이름씩 가로로 나란히 늘어놓는다(요청: "4대 4인 경우는
// 한팀의 플레이어를 가로로 배치"). 인원수에 따라 아바타/글자 크기를 다르게 둔다(요청:
// "그걸 생각해서 모든 요소의 크기 조절 필요") — 1명일 때만 크게, 여럿이면 한 줄에
// 다 들어오도록 작게.
function MatchupSideMembers({ people }: { people: { id: string; nickname: string; avatar: string | null }[] }) {
  if (people.length === 1) {
    const p = people[0];
    return (
      <>
        <Avatar member={p} size={40} />
        <span className="scr-challenge-matchup-name">{p.nickname}</span>
      </>
    );
  }
  return (
    <div className="scr-challenge-matchup-team">
      {people.map((p) => (
        <span key={p.id} className="scr-challenge-matchup-teammate">
          <Avatar member={p} size={28} />
          <span className="scr-challenge-matchup-teammate-name">{p.nickname}</span>
        </span>
      ))}
    </div>
  );
}

interface ChallengeCardProps {
  challenge: Challenge;
  myId: string | undefined;
  onResponded: (updated: Challenge) => void;
  onRegisterReplay: (challenge: Challenge) => void;
}

function ChallengeCard({ challenge, myId, onResponded, onRegisterReplay }: ChallengeCardProps) {
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
  const timeLabel = challengeTimeLabel(challenge.scheduledAt);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");

  const accept = async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.respondToChallenge(challenge.id, "accepted");
      onResponded(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.respondToChallenge(challenge.id, "rejected", rejectReason.trim() || undefined);
      onResponded(updated);
      setRejecting(false);
      setRejectReason("");
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

  // 상대가 여럿(팀전)이어도 거절 사유는 첫 번째 상대 기준으로만 보여준다(요청:
  // "상대쪽에는 상대가 쓴 메시지 있으면 노출") — 사유는 그 사람 개인의 응답이라 팀
  // 전체를 대표하긴 애매하지만, 화면 단순화 취지상 대표 한 명만 본다.
  const primaryTarget = challenge.targets[0];
  const targetMessage = primaryTarget?.response === "rejected" ? primaryTarget.rejectReason : null;

  // 요청자쪽 인원(본인+같은 편) — Member.avatar는 memberOf로 찾은 것, 없으면 null.
  const creatorSideMembers: { id: string; nickname: string; avatar: string | null }[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  return (
    <div className="scr-challenge-card">
      {/* 화면이 너무 복잡하다는 피드백으로 전면 단순화(요청: "챌린지 너무 화면이
          복잡") — 날짜는 이제 카드 바깥의 날짜 그룹 헤더가 보여주므로 카드 안엔
          시간만(요청: "각 카드엔 시간만 표시"), 경기유형(1:1/팀전) 라벨은 없앤다(요청:
          "일대일 팀전 라벨 제거"). 상태만 봐도 충분하다는 피드백으로 응답/취소/완료
          로그(타임라인)도 통째로 없앴다(요청: "로그 전체 삭제 그냥 상태만 봐도 충분히
          알수있음"). 시간을 상태보다 앞(왼쪽)에, 그리고 그 아래 매치업 바로 위 줄에
          가운데 정렬로 둔다(요청: "시간이 앞에" + "시간은 가운데 정렬(vs 대진
          윗줄에)"). */}
      <div className="scr-challenge-card-head">
        {/* 상태 알약은 카드 좌상단 끝으로, 시간은 그대로 줄 가운데 유지(요청: "시간은
            가운데 두고 상태 알약은 좌측끝에 배치(카드의 좌상단)") — 리플레이 버튼과
            같은 방식(절대배치)으로 시간의 중앙 정렬에 영향을 안 주게 뺀다. */}
        <span className={cx("scr-challenge-status", challengeStatusClass(challenge), "scr-challenge-card-head-status")}>
          {challengeStatusLabel(challenge)}
        </span>
        {timeLabel && <span className="scr-mono scr-challenge-card-when">{timeLabel}</span>}
        {/* 예전엔 카드 맨 아래 독립된 줄이었는데, 시간/상태 줄 오른쪽 구석으로 옮기고
            그 줄의 다른 요소들과 크기를 맞춘다(요청: "리플레이 등록 버튼은 시간 상태
            라인의 오른쪽 구석에 위치시키기(크기도 일치시키기)") — 참가자가 아니어도
            아무나 등록할 수 있는 건 그대로다(요청: "결과등록 버튼을 참가자 전용에서
            아무나 등록 가능하도록 권한 확장"). */}
        {challenge.status === "confirmed" && !challenge.resultMatchId && (
          <button
            type="button" className="scr-btn scr-btn-ghost scr-challenge-card-head-replay"
            onClick={() => onRegisterReplay(challenge)}
          >
            <Upload size={11} /> 리플레이 등록
          </button>
        )}
      </div>

      {/* 누가 누구와 붙는지를 "요청자 vs 상대" 구도로 크게 보여준다(요청: "요청자 vs
          상대 구도로 크게 헤드라인 노출" + "VS 가운데 세로 정렬하고 양쪽에 도전자와
          상대 배치") — 양쪽을 세로(아바타 위, 이름 아래)로 쌓아 VS가 그 사이에서
          자연스럽게 세로 가운데에 오게 한다. 팀전이면 같은 편(ownMembers)은 요청자
          쪽에, 지목된 상대는 전부 반대쪽에 묶인다. 누가 도전자인지 한눈에 알 수
          있도록 역할 라벨도 붙인다(요청: "도전자에 도전자라고 표시"). */}
      <div className="scr-challenge-matchup">
        <div className="scr-challenge-matchup-side">
          <span className="scr-challenge-matchup-role">도전자</span>
          <MatchupSideMembers people={creatorSideMembers} />
        </div>
        <span className="scr-challenge-matchup-vs">VS</span>
        <div className="scr-challenge-matchup-side">
          {/* "상대" 라벨 자체는 없앴지만(요청: "상대 라벨은 제거 도전자만 있어도 됨")
              그 자리를 완전히 비우면 도전자 쪽만 라벨만큼 위로 더 밀려서 양쪽 아바타
              높이가 어긋난다 — 안 보이게만(visibility:hidden) 자리를 예약해 아바타
              줄이 서로 나란하게 맞춘다. */}
          <span className="scr-challenge-matchup-role scr-challenge-matchup-role-hidden" aria-hidden="true">상대</span>
          <MatchupSideMembers people={targetSideMembers} />
        </div>
      </div>

      {/* 한마디/거절 사유는 아바타-이름이 있는 좁은 칸(양쪽·VS와 폭을 나눠 쓴다) 안에
          있으면 폭이 너무 좁아 줄바꿈이 잦았다(요청: "한마디 폭 공간 더 확보" + "한줄
          메시지 줄넘김 최대한 안생기게 공간 확보") — 매치업 바깥, 카드 전체 폭을
          절반씩 나눠 쓰는 별도 줄로 뺀다("메시지는 플레이어 아래에 배치"는 그대로
          유지 — 도전자 쪽은 왼쪽 절반, 상대 쪽은 오른쪽 절반). 메시지가 없어도 자리를
          그대로 예약해둔다(visibility:hidden — display:none이면 공간 자체가
          사라진다) — 그래야 메시지 유무와 무관하게 카드 높이가 항상 같게 유지된다
          (요청: "한줄 메시지 있고 없고에 따라 레이아웃 달라지지 않게" + "VS가 모든
          카드간 세로 열이 맞아야한다"). "상대" 역할 라벨은 없앤다(요청: "상대 라벨은
          제거 도전자만 있어도 됨"). */}
      <div className="scr-challenge-matchup-messages">
        <p className={cx(
          "scr-challenge-timeline-detail scr-challenge-timeline-quote scr-challenge-message",
          !challenge.message && "scr-challenge-message-empty",
        )}>
          {challenge.message ? `"${challenge.message}"` : " "}
        </p>
        {/* 매치업 줄과 똑같은 "VS"를 안 보이게(visibility:hidden) 가운데 끼워 넣어, 그
            폭만큼 이 줄의 두 칸도 위 아바타/이름 칸과 정확히 같은 너비로 나뉘게 한다 —
            그냥 절반씩 나누면 위쪽은 가운데에 VS(+양옆 gap)가 껴 있어 중심이 서로
            어긋났다(실제로 지적받은 문제 — "한마디가 중심이 안맞네 프사 닉네임이랑"). */}
        <span className="scr-challenge-matchup-vs" aria-hidden="true" style={{ visibility: "hidden" }}>VS</span>
        <p className={cx(
          "scr-challenge-timeline-detail scr-challenge-timeline-quote scr-challenge-message",
          !targetMessage && "scr-challenge-message-empty",
        )}>
          {targetMessage ? `"${targetMessage}"` : " "}
        </p>
      </div>

      {err && <div className="scr-err">{err}</div>}

      {rejecting && (
        <div className="scr-challenge-time-change-form">
          <label className="scr-field">
            <span className="scr-label">거절 사유 (선택)</span>
            <input
              type="text" className="scr-input" value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="예: 그날은 시간이 안 돼요"
              maxLength={60}
            />
          </label>
          <div className="scr-form-actions scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setRejecting(false)} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-reject-btn scr-btn-sm" onClick={reject} disabled={busy}>
              {busy ? <Spinner /> : "거절하기"}
            </button>
          </div>
        </div>
      )}

      {!rejecting && canRespond && (
        <div className="scr-form-actions scr-challenge-card-actions">
          <button className="scr-btn scr-challenge-reject-btn scr-btn-sm" onClick={() => setRejecting(true)} disabled={busy}>거절</button>
          <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={accept} disabled={busy}>
            {busy ? <Spinner /> : "승락"}
          </button>
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
          <div className="scr-form-actions scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setReapplying(false)} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={reapply} disabled={busy}>
              {busy ? <Spinner /> : "재신청"}
            </button>
          </div>
        </div>
      )}

      {!reapplying && (canCancel || canReapply) && (
        <div className="scr-form-actions scr-challenge-card-actions">
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

  const upsert = (updated: Challenge) => {
    setChallenges((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
    });
  };

  // 아직 결판이 안 난 것("다가오는")과 끝난 것("종료된")을 나눈다 — 확정됐어도 결과가
  // 아직 안 올라왔으면(resultMatchId 없음) 여전히 "다가오는" 쪽이다(요청: "다가오는/
  // 종료된 목록 분리 및 정렬").
  const isUpcoming = (c: Challenge): boolean => (
    c.status === "pending" || (c.status === "confirmed" && !c.resultMatchId)
  );

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

  // 확정된 도전장에서 "리플레이 등록"을 누르면, 경기결과 화면과 완전히 같은 방식으로
  // 리플레이를 분석/등록한다(등록된 경기는 그대로 경기결과/전적통계에도 포함된다).
  const [replayTarget, setReplayTarget] = useState<Challenge | null>(null);
  const replayInputRef = useRef<HTMLInputElement>(null);
  const [parsingReplays, setParsingReplays] = useState(false);
  const [replayDrafts, setReplayDrafts] = useState<ReplayDraft[] | null>(null);
  const [replayTruncated, setReplayTruncated] = useState(false);

  const handleRegisterReplay = (challenge: Challenge) => {
    setReplayTarget(challenge);
    replayInputRef.current?.click();
  };

  const handleReplayFilesChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (chosen.length === 0) return;
    const truncated = chosen.length > MAX_REPLAY_FILES;
    const batch = chosen.slice(0, MAX_REPLAY_FILES);
    setReplayTruncated(truncated);
    setParsingReplays(true);
    try {
      const [drafts] = await Promise.all([
        buildReplayDrafts(batch, members),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      if (hasAppUpdatePreloadErrorOccurred()) return;
      setReplayDrafts(drafts);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      setParsingReplays(false);
    }
  };

  return (
    <div className="scr-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">
          챌린지 <span className="scr-challenge-title-subtitle">너 나와!</span>
        </h1>
        <div className="scr-v2-toolbar-actions">
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => setFormOpen(true)}>
            <Mail size={17} className="scr-challenge-send-icon" />
            도전장 보내기
          </button>
        </div>
      </div>

      <SearchFilterBar
        count={searchedChallenges.length}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저"
        suggestions={suggestions}
      />

      {error && <div className="scr-err">{error}</div>}

      {parsingReplays && createPortal(
        <div className="scr-match-list-overlay"><Spinner size={22} /></div>,
        document.body,
      )}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : (
        <>
          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title">다가오는</h2>
            {upcomingChallenges.length === 0 ? (
              <div className="scr-empty">
                {searchTerms.length > 0 ? "검색 결과가 없어요" : "다가오는 도전장이 없어요"}
              </div>
            ) : (
              <div className="scr-challenge-list">
                {groupChallengesByDate(upcomingChallenges).map((g) => (
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
                        onRegisterReplay={handleRegisterReplay}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title">종료된</h2>
            {endedChallenges.length === 0 ? (
              <div className="scr-empty">
                {searchTerms.length > 0 ? "검색 결과가 없어요" : "종료된 도전장이 없어요"}
              </div>
            ) : (
              <div className="scr-challenge-list">
                {groupChallengesByDate(endedChallenges).map((g) => (
                  <div key={g.label} className="scr-challenge-date-group">
                    {/* 종료된 목록은 이미 끝난 일이라 "오늘" 태그가 굳이 필요 없다(요청:
                        "종료된 목록에 오늘 배지 제거") — 다가오는 목록에서만 남긴다. */}
                    <div className="scr-challenge-date-head scr-mono">{g.label}</div>
                    {g.items.map((c) => (
                      <ChallengeCard
                        key={c.id}
                        challenge={c}
                        myId={user?.id}
                        onResponded={upsert}
                        onRegisterReplay={handleRegisterReplay}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <input
        ref={replayInputRef}
        type="file"
        accept=".rep,application/octet-stream"
        multiple
        hidden
        onChange={handleReplayFilesChosen}
      />

      {formOpen && (
        <ChallengeFormModal
          onClose={() => setFormOpen(false)}
          onCreated={(c) => setChallenges((prev) => [c, ...prev])}
        />
      )}

      {replayDrafts && (
        <ReplayReviewModal
          drafts={replayDrafts}
          truncated={replayTruncated}
          attachToChallengeId={replayTarget?.id}
          onClose={() => { setReplayDrafts(null); setReplayTarget(null); }}
          onSaved={async () => {
            if (replayTarget) load();
          }}
        />
      )}
    </div>
  );
}
