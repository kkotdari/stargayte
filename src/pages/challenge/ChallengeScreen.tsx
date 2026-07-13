import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import TeamMatchesModal from "../../modals/TeamMatchesModal";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { challengeDateGroupLabel, challengeTimeLabel, fmt, isToday } from "../../utils/date";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import type { Challenge, Member } from "../../types";

// 카드 상태 줄 하나로 충분하니 참가자별 개별 응답 배지는 없앤다(요청: "상태는
// 상단에만 나오게 하고 요청받은 사람 상태는 굳이 안보여줘도 될듯"). 그 김에 "확정"도
// 결과가 등록됐는지에 따라 "승락"(아직 안 뛴 확정)과 "완료"(결과까지 등록된 확정)로
// 더 갈랐다 — status 자체는 그대로 confirmed 하나지만 화면 표시는 둘로 나뉜다. 아직
// 응답 대기중이면 몇 명 중 몇 명이 응답했는지를 괄호로 덧붙인다(요청: "응답대기중(n/n)").
function challengeStatusLabel(c: Challenge): string {
  if (c.status === "confirmed") return c.resultMatchId ? "완료" : "승락";
  if (c.status === "rejected") return "거절";
  if (c.status === "canceled") return "취소";
  const responded = c.targets.filter((t) => t.response !== "pending").length;
  return `응답대기중(${responded}/${c.targets.length})`;
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

// 팀 구성 한 편(도전자편/상대편) — 인원수와 무관하게 프사+닉네임을 항상 가로로 심플하게
// 나열한다(요청: "프사와 닉네임은 가로로 심플하게 구성(세로구성x)") — 예전처럼 1명일 때만
// 크게 보여주는 특별 취급 없이 전부 같은 모양.
function PeopleRow({ people }: { people: { id: string; nickname: string; avatar: string | null }[] }) {
  return (
    <span className="scr-challenge-people">
      {people.map((p, i) => (
        <span key={p.id} className="scr-challenge-person">
          <Avatar member={p} size={20} />
          <span className="scr-challenge-person-name">{p.nickname}</span>
          {i < people.length - 1 && <span className="scr-challenge-person-sep">,</span>}
        </span>
      ))}
    </span>
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

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [message, setMessage] = useState("");

  // 카드에서 바로 승락/거절 — OS 기본 prompt로 한마디를 필수로 받는다(요청: "카드에
  // 승락 거절 버튼이 뜨는데 누르면 사유입력하는 창 뜨게(필수). os기본 입력컨펌 사용").
  // 취소를 누르거나(null) 빈 값만 입력하면(필수 위반) 아무 요청도 보내지 않는다.
  const respond = async (response: "accepted" | "rejected", promptLabel: string) => {
    const input = window.prompt(promptLabel);
    if (input === null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    setErr("");
    setBusy(true);
    try {
      const updated = await api.respondToChallenge(challenge.id, response, trimmed);
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

  // 상대가 여럿(팀전)이어도 응답 한마디는 첫 번째 상대 기준으로만 보여준다(요청:
  // "상대쪽에는 상대가 쓴 메시지 있으면 노출") — 그 한마디는 그 사람 개인의 응답이라 팀
  // 전체를 대표하긴 애매하지만, 화면 단순화 취지상 대표 한 명만 본다. 이제 거절뿐 아니라
  // 수락에도 한마디가 붙을 수 있어(요청: "편지지에 수락/거절 한줄 메시지 필수화")
  // response 종류와 무관하게 있으면 그대로 보여준다.
  const primaryTarget = challenge.targets[0];
  const targetMessage = primaryTarget?.responseMessage ?? null;

  // 요청자쪽 인원(본인+같은 편) — Member.avatar는 memberOf로 찾은 것, 없으면 null.
  const creatorSideMembers: { id: string; nickname: string; avatar: string | null }[] = [
    { id: challenge.createdBy.id, nickname: challenge.createdBy.nickname, avatar: creatorMember?.avatar ?? null },
    ...challenge.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetSideMembers = challenge.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  return (
    <div className="scr-challenge-card">
      {/* 화면이 너무 복잡하다는 피드백으로 전면 단순화한 뒤(요청: "챌린지 너무 화면이
          복잡"), 목록 아이템을 4줄 텍스트 + 오른쪽 사진 컬럼으로 재구성한다(요청:
          "목록 아이템 디자인 변경 — 시간 / 도전자프사닉임・도전한줄메시지 /
          도전자구성👉🏻상대구성 / 응답대기중(n/n)・메시지 / 오른쪽에 첨부사진"). */}
      <div className="scr-challenge-card-main">
        <div className="scr-challenge-card-body">
          <div className="scr-challenge-card-row scr-mono scr-challenge-card-when">
            {timeLabel ?? "시간 미정"}
          </div>

          {/* 아래 팀 구성 줄도 도전자 프사+닉네임으로 시작해 헷갈리기 쉬워서(요청: "첫줄은
              누가 도전장 보냄이라고 해야 밑에거랑 안헷갈릴듯") "~님이 도전장을 보냈어요"를
              덧붙여 이 줄이 발신자 소개줄임을 분명히 한다. */}
          <div className="scr-challenge-card-row">
            <span className="scr-challenge-person">
              <Avatar member={creatorSideMembers[0]} size={20} />
              <span className="scr-challenge-person-name">{challenge.createdBy.nickname}</span>
            </span>
            <span className="scr-challenge-card-sender-tag">도전장 보냄</span>
            {challenge.message && <span className="scr-challenge-card-msg">・ "{challenge.message}"</span>}
          </div>

          <div className="scr-challenge-card-row scr-challenge-card-versus">
            <PeopleRow people={creatorSideMembers} />
            <span className="scr-challenge-card-arrow" aria-hidden="true">👉🏻</span>
            <PeopleRow people={targetSideMembers} />
          </div>

          {/* 상태(응답대기중/승락/거절)는 상대쪽 응답이니 상대 프사 줄과 왼쪽을 맞춘다
              (요청: "승락 응답대기중 이런거는 상대쪽에 배치" → "상대 프로필에 좌측
              맞추면 될듯") — 위 매치업 줄과 똑같이 왼쪽에 도전자 칸만큼의 빈 자리 +
              화살표 자리(안 보이게)를 예약해, 상태 알약이 상대 프사와 정확히 같은
              x축에서 시작하게 한다. */}
          <div className="scr-challenge-card-row">
            <span className="scr-challenge-card-status-spacer" aria-hidden="true" />
            <span className="scr-challenge-card-arrow" aria-hidden="true" style={{ visibility: "hidden" }}>👉🏻</span>
            <span className={cx("scr-challenge-status", challengeStatusClass(challenge))}>
              {challengeStatusLabel(challenge)}
            </span>
            {targetMessage && <span className="scr-challenge-card-msg">・ "{targetMessage}"</span>}
          </div>
        </div>

        {challenge.photoUrl && (
          <div className="scr-challenge-card-photo">
            <img src={challenge.photoUrl} alt="첨부 사진" />
          </div>
        )}
      </div>

      {err && <div className="scr-err">{err}</div>}

      {canRespond && (
        <div className="scr-challenge-card-actions">
          <button
            className="scr-btn scr-challenge-reject-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("rejected", "거절 사유를 입력해 주세요 (필수)")}
          >
            거절
          </button>
          <button
            className="scr-btn scr-challenge-accept-btn scr-btn-sm" disabled={busy}
            onClick={() => respond("accepted", "한마디를 입력해 주세요 (필수)")}
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
        count={searchedChallenges.length}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저"
        suggestions={suggestions}
      />

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : (
        <>
          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title">다가오는 대결</h2>
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
                        onViewResults={setResultsTarget}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="scr-challenge-section">
            <h2 className="scr-challenge-section-title">종료된 대결</h2>
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
                        onViewResults={setResultsTarget}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
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
