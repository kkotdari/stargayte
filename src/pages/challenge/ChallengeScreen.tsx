import { useCallback, useEffect, useMemo, useState } from "react";
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
import { challengeDateGroupLabel, challengeTimeLabel, fmt, isToday } from "../../utils/date";
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
            {targets && (
              <div className="scr-challenge-side-message">
                {t?.target.responseMessage ? `"${t.target.responseMessage}"` : " "}
              </div>
            )}
          </div>
        );
      })}
      {/* 도전자편의 한마디는 팀원 전체가 아니라 도전자 본인 몫이라 팀 전체 아래에 한 번만
          붙인다(요청: "한줄 메시지는 아래줄 도전자 프사 아래로 이동"). */}
      {message !== undefined && (
        <div className="scr-challenge-side-message">{message ? `"${message}"` : " "}</div>
      )}
    </div>
  );
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
  const timeLabel = challengeTimeLabel(challenge.scheduledAt);
  const overall = challengeDisplayStatus(challenge);

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");

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
  const creatorSideMembers: SideMember[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers: SideMember[] = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));
  const targetInfos = challenge.targets.map((t) => ({ target: t, overall }));

  return (
    <div className="scr-challenge-card">
      <div className="scr-challenge-card-body">
        <div className="scr-challenge-card-row scr-mono scr-challenge-card-when">
          {timeLabel ?? "시간 미정"}
        </div>

        {/* 매치업 — 도전자편/상대편을 세로로 쌓고, 손가락 이모지는 그 사이 한가운데(요청:
            "손가락 이모티콘을 좀더 도전자와 상대 가운데 느낌에 배치")에 하나만 둔다(팀전도
            팀당 한 개, 요청: "손가락은 한개만 표시"). "누가 도전장 보냄" 태그는 없앴고
            (요청: "이 부분 삭제"), 도전자의 한마디는 도전자편 아래로, 상대 응답 알약은
            그 사람 프로필 옆에 인라인으로, 응답 메시지는 그 아래로 옮겼다(요청: "상대프로필
            옆에 인라인으로 응답상태알약... 및 프로필 아래에 응답 메시지 표시"). */}
        <div className="scr-challenge-matchup">
          <ChallengeSide people={creatorSideMembers} message={challenge.message} />
          <span className="scr-challenge-arrow" aria-hidden="true">👉🏻</span>
          <ChallengeSide people={targetSideMembers} targets={targetInfos} />
        </div>
      </div>

      {err && <div className="scr-err">{err}</div>}

      {canRespond && (
        <div className="scr-challenge-card-actions">
          <button
            className="scr-btn scr-challenge-reject-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("rejected", "거절 사유를 입력해 주세요 (필수)", true)}
          >
            거절
          </button>
          <button
            className="scr-btn scr-challenge-accept-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("accepted", "한마디를 입력해 주세요 (선택)", false)}
          >
            {busy ? <Spinner /> : "승락"}
          </button>
        </div>
      )}

      {challenge.status === "confirmed" && (
        <div className="scr-challenge-card-actions">
          <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => onViewResults(challenge)}>
            결과 보기
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
          <div className="scr-challenge-card-actions">
            <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setReapplying(false)} disabled={busy}>취소</button>
            <button className="scr-btn scr-challenge-accept-btn scr-btn-sm" onClick={reapply} disabled={busy}>
              {busy ? <Spinner /> : "재신청"}
            </button>
          </div>
        </div>
      )}

      {!reapplying && (canCancel || canReapply) && (
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

  const upsert = (updated: Challenge) => {
    setChallenges((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
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
            <h2 className="scr-challenge-section-title">다가오는 대결</h2>
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
