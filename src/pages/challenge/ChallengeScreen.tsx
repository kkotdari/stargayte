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
import { formatChallengeSchedule, isToday } from "../../utils/date";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import { MATCH_TYPE_INFO } from "../../constants/matchTypes";
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
  return "대기중";
}
function challengeStatusClass(c: Challenge): string {
  if (c.status === "confirmed" && c.resultMatchId) return "scr-challenge-status-done";
  return `scr-challenge-status-${c.status}`;
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

  // 대기중인 상대는 타임라인에 따로 줄을 안 쌓으니(요청: "대기중은 굳이 로그에 쌓지
  // 마"), "도전장 보냄" 한 줄만 있고 그 뒤로 이어지는 줄이 하나도 없을 수도 있다 —
  // 그럴 땐 세로선으로 이을 대상 자체가 없으므로 선을 안 그린다(요청: "두번째 로그
  // 없으면 굳이 타임라인 잇지 않기").
  const hasTimelineFollowUp = challenge.ownMembers.length > 0
    || challenge.targets.some((t) => t.response !== "pending")
    || challenge.status === "canceled"
    || (challenge.status === "confirmed" && !!challenge.resultMatchId);

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

  return (
    <div className="scr-challenge-card">
      {/* 최상단엔 한눈에 훑을 최종 상태·일시·경기종류만 — 나머지 경과(누가 언제 뭘
          했는지)는 아래 타임라인이 순서대로 보여준다. 일시는 경기종류보다 앞(요청:
          "경기유형 앞에 일시를 먼저 표시")에 굵게(요청: "진하게") 둔다. */}
      <div className="scr-challenge-card-head">
        <span className={cx("scr-challenge-status", challengeStatusClass(challenge))}>
          {challengeStatusLabel(challenge)}
        </span>
        <span className="scr-mono scr-challenge-card-when">
          {challenge.status === "confirmed" && isToday(challenge.scheduledAt) && (
            <span className="scr-challenge-card-today-tag">오늘</span>
          )}
          {formatChallengeSchedule(challenge.scheduledAt)}
        </span>
        <span className="scr-challenge-card-type">{MATCH_TYPE_INFO[challenge.matchType]}</span>
      </div>

      {/* 요청(도전장 보냄) → 응답이 실제로 온 상대만 → (있으면) 취소/완료까지, 실제
          있었던 순서 그대로 아래로 쌓는다(요청: "요청 메시지 왼쪽에 도전장 보냄... 그
          위에 대기중/승락... 스택이 쌓여가는 형태" + "도전자 상대 로우 아래에 순서대로
          쌓기"). 아직 응답 안 한 대기중 상대는 따로 로그를 안 쌓고(요청: "대기중은
          굳이 로그에 쌓지 마") 대신 요청 한 줄 안에 "누구한테 보냈는지"로 모아
          보여준다(요청: "도전장 보냄 정보에 누구한테 보냈는지 프사와 닉네임 나열"). */}
      <div className={cx("scr-challenge-timeline", hasTimelineFollowUp && "scr-challenge-timeline-connected")}>
        <div className="scr-challenge-timeline-row">
          <Avatar member={creatorMember} size={29} />
          <div className="scr-challenge-timeline-body">
            {/* 예전엔 "도전장 보냄"만 있고 누구한테인지는 아래 "상대" 칩을 봐야 알 수
                있었는데, 요청대로 헤드라인 자체에 상대의 프사+닉네임을 바로 넣어("미친
                마법사 · [프사]태섭에게 도전장 보냄") 한눈에 읽히게 한다 — 상대가 여럿이면
                쉼표로 나열. 프사(22px)와 나머지 텍스트(14.85px)는 높이가 달라서, 이걸
                한 줄의 텍스트 흐름(inline+vertical-align)으로 섞으면 폰트 기준선 계산이
                미묘하게 어긋나 세로 정렬이 안 맞아 보였다(실제로 지적받은 문제) — 아예
                한 줄짜리 flex row로 묶어 flexbox의 align-items:center로 확실하게
                가운데를 맞춘다. */}
            <span className="scr-challenge-timeline-label scr-challenge-timeline-label-row">
              <span>{challenge.createdBy.nickname}</span>
              <span className="scr-dim">·</span>
              {challenge.targets.map((t, i) => (
                <span key={t.memberId} className="scr-challenge-timeline-sent-to">
                  <Avatar member={{ id: t.memberId, nickname: t.nickname, avatar: t.avatar }} size={22} />
                  <span className="scr-challenge-timeline-sent-to-name">
                    {t.nickname}{i < challenge.targets.length - 1 && ","}
                  </span>
                </span>
              ))}
              <span className="scr-dim">에게 도전장 보냄</span>
            </span>
            {/* 상대 프사/닉네임은 이제 위 헤드라인("~에게 도전장 보냄")에 이미 나오니
                여기선 중복해서 칩으로 안 보여준다(요청: "한마디에는 상대 프사랑 닉네임을
                없애고 그걸 ~에게 도전장 보냄에 넣는거야") — 한마디(메시지)만 남긴다. */}
            {challenge.message && (
              <span className="scr-challenge-timeline-detail scr-challenge-timeline-quote">"{challenge.message}"</span>
            )}
          </div>
        </div>

        {challenge.ownMembers.length > 0 && (
          <div className="scr-challenge-timeline-row scr-challenge-timeline-row-sub">
            <span className="scr-challenge-timeline-spacer" />
            <span className="scr-challenge-timeline-detail scr-dim">
              같은 팀: {challenge.ownMembers.map((m) => m.nickname).join(", ")}
            </span>
          </div>
        )}

        {challenge.targets.filter((t) => t.response !== "pending").map((t) => (
          <div key={t.memberId} className="scr-challenge-timeline-row">
            <Avatar member={{ id: t.memberId, nickname: t.nickname, avatar: t.avatar }} size={29} />
            <div className="scr-challenge-timeline-body">
              <span className={cx("scr-challenge-timeline-label", `scr-challenge-timeline-label-${t.response}`)}>
                {t.nickname} <span className="scr-dim">· {t.response === "accepted" ? "승락함" : "거절함"}</span>
              </span>
              {/* 거절 사유는 요청자에게만 온다(서버가 그 외 조회자에겐 null로 내려준다). */}
              {t.response === "rejected" && t.rejectReason && (
                <span className="scr-challenge-timeline-detail scr-challenge-timeline-quote">"{t.rejectReason}"</span>
              )}
            </div>
          </div>
        ))}

        {challenge.status === "canceled" && (
          <div className="scr-challenge-timeline-row scr-challenge-timeline-row-system">
            <Avatar member={creatorMember} size={29} />
            <div className="scr-challenge-timeline-body">
              <span className="scr-challenge-timeline-label">
                {challenge.createdBy.nickname} <span className="scr-dim">· 도전장 취소함</span>
              </span>
            </div>
          </div>
        )}
        {challenge.status === "confirmed" && challenge.resultMatchId && (
          <div className="scr-challenge-timeline-row scr-challenge-timeline-row-system">
            <span className="scr-challenge-timeline-spacer" />
            <div className="scr-challenge-timeline-body">
              <span className="scr-challenge-timeline-label">대결 종료</span>
              <span className="scr-challenge-timeline-detail">경기결과가 등록됐어요</span>
            </div>
          </div>
        )}
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

      {/* 예전엔 참가자(보낸 사람/지목된 상대/같은 팀)만 리플레이를 등록할 수 있었는데,
          정작 게임아이디 매핑(리플레이 속 이름 → 회원)은 등록하는 사람이 그 자리에서
          훑어보며 채워야 하는 일이라 — 참가자 중 아무도 방법을 모르거나 자리에 없으면
          아무도 못 채웠다. 지목/참가 여부와 무관하게 아무나 등록할 수 있게 넓힌다(요청:
          "결과등록 버튼을 참가자 전용에서 아무나 등록 가능하도록 권한 확장"). */}
      {challenge.status === "confirmed" && !challenge.resultMatchId && (
        <div className="scr-challenge-card-actions">
          <button
            type="button" className="scr-btn scr-btn-ghost scr-btn-sm"
            onClick={() => onRegisterReplay(challenge)}
          >
            <Upload size={12} /> 리플레이 등록
          </button>
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
                {upcomingChallenges.map((c) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    myId={user?.id}
                    onResponded={upsert}
                    onRegisterReplay={handleRegisterReplay}
                  />
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
                {endedChallenges.map((c) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    myId={user?.id}
                    onResponded={upsert}
                    onRegisterReplay={handleRegisterReplay}
                  />
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
