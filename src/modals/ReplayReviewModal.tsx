import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import MemberMultiSelect from "../components/select/MemberMultiSelect";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { cx } from "../utils/format";
import { hasComputerSlot, validateReplayDraft, resolveUnmatchedAsUnregistered, type ReplayDraft, type UnmatchedPlayer } from "../utils/replayDraft";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { api } from "../api/client";
import { newComputerSlotId } from "../constants/computerSlot";
import { newUnregisteredSlotId } from "../constants/unregisteredSlot";
import { useDefaultRaceResolver } from "../hooks/useDefaultRaceResolver";
import type { MatchSlot, MatchResult, NewMatch, Race, Member } from "../types";

interface ReplayReviewModalProps {
  // 분석은 이 모달을 열기 전에 이미 끝나 있다(부모가 buildReplayDrafts로 미리 만들어 전달).
  drafts: ReplayDraft[];
  truncated?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  // 리플레이 하나가 실제로 등록될 때마다 그 파일명을 알려준다 — 배치 등록처럼 자기 쪽
  // 목록을 갖고 있는 호출부가 "이건 이제 등록됐다"고 표시를 갱신할 수 있게. 전체 저장이
  // 끝난 뒤의 onSaved만으로는 어떤 파일이 등록되고 어떤 게 제외됐는지 구분할 수 없다.
  onRegistered?: (fileName: string) => void;
  // 챌린지(도전장) 카드의 "리플레이 등록"에서 열렸을 때만 넘어온다 — 등록에 성공한 첫
  // 경기를 그 도전장의 결과로 연결한다(challenge.resultMatchId). 배치로 여러 파일을
  // 골라도 도전장 하나엔 결과 하나만 있으면 되므로 첫 건만 연결한다.
  attachToChallengeId?: number;
}

// v2 "등록 내용 확인" 모달 — 예전엔 매칭이 끝났거나 파싱이 성공한 리플레이는 이 모달을
// 열기 전에(MatchScreenV2) 조용히 자동 등록되고, 여기는 사람이 매핑해야 하는 것만 보여줬다.
// 지금은 등록 전에 한 번은 항상 훑어보게, 중복(이미 등록된 경기)만 빼고 나머지는 매핑이
// 끝났든 아니든 전부 같은 형식(팀1/VS/팀2 칩 그리드)으로 보여준다 — 매핑이 끝난 리플레이를
// 결과 카드 같은 다른 모양으로 바꿔 보여주면 오히려 어색해서, 형식은 그대로 두고 매핑
// 모드(MemberMultiSelect의 mappingMode)에서 이미 분석돼 들어온 데이터(매칭된 팀 구성)는
// 제거 버튼을 아예 없애 바꿀 수 없게만 한다 — 실제로 손댈 수 있는 건 아직 못 찾은 선수를
// 회원/컴퓨터/비회원으로 연결하는 것뿐이다. 제외는 매핑 여부와 무관하게 둘 다 가능하다.
// 회원 연결/컴퓨터/비회원 지정은 배치 전체에 걸쳐 이름 기준으로 함께 반영된다
// (MemberMultiSelect 참고) — 한 리플레이에서 매핑하면 같은 이름이 나온 다른 리플레이 행도
// 같이 사라진다.
export default function ReplayReviewModal({
  drafts: initialDrafts, truncated = false, onClose, onSaved, onRegistered, attachToChallengeId,
}: ReplayReviewModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const addMatch = useAppStore((s) => s.addMatch);
  const addMemberReplayAlias = useAppStore((s) => s.addMemberReplayAlias);

  const [drafts, setDrafts] = useState<ReplayDraft[]>(initialDrafts);
  // 제외되지 않은 드래프트 중 실제로 등록에 성공한 것들의 인덱스.
  const [submittedIndices, setSubmittedIndices] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [excludeComputer, setExcludeComputer] = useState(false);

  const resolveDefaultRace = useDefaultRaceResolver(members);

  const updateDraft = (index: number, patch: Partial<ReplayDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const setTeam = (index: number, side: "team1" | "team2", rows: MatchSlot[]) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== index) return d;
      if (side === "team1") {
        const matchType = rows.length === 1 && d.team2.length === 1 ? "0101" : "0102";
        return { ...d, team1: rows, matchType };
      }
      const matchType = d.team1.length === 1 && rows.length === 1 ? "0101" : "0102";
      return { ...d, team2: rows, matchType };
    }));
  };

  // 미매칭 선수를 회원과 연결: 같은 이름(rawName)이 나온 배치 안의 다른 리플레이(드래프트)에도
  // 한 번에 반영한다. 팀은 경기마다 무작위로 갈리므로 같은 이름이 어떤 드래프트에선 팀1,
  // 다른 드래프트에선 팀2에 있을 수 있다 — 그래서 side를 고정해서 찾지 않고 드래프트마다
  // 양쪽 팀을 모두 검사한다(예전엔 클릭한 쪽 side로만 찾아서 반대쪽에 있으면 반영이 안 됐다).
  // 연결하면 다음부터 자동 매칭되도록 이 이름을 그 회원의 replayAlias로도 저장한다(저장이
  // 실패해도 팀 배정 자체는 그대로 유지한다).
  const assignUnmatched = (player: UnmatchedPlayer, member: Member) => {
    setDrafts((prev) => prev.map((d) => {
      if (d.team1.some((r) => r.memberId === member.id) || d.team2.some((r) => r.memberId === member.id)) return d;
      const t1Match = d.unmatchedTeam1.find((p) => p.rawName === player.rawName);
      const t2Match = d.unmatchedTeam2.find((p) => p.rawName === player.rawName);
      if (!t1Match && !t2Match) return d;
      // 회원으로 연결해도 리플레이 원본 게임 아이디(rawName)는 그대로 들고 간다 —
      // member.battletag는 나중에 바뀔 수 있어 이 값이 이 경기 시점의 유일한 증거다.
      const toSlot = (match: UnmatchedPlayer): MatchSlot => ({
        memberId: member.id, race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount,
      });
      return {
        ...d,
        team1: t1Match ? [...d.team1, toSlot(t1Match)] : d.team1,
        unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== player.rawName),
        team2: t2Match ? [...d.team2, toSlot(t2Match)] : d.team2,
        unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== player.rawName),
      };
    }));
    addMemberReplayAlias(member.id, player.rawName).catch(() => {});
  };

  // 컴퓨터/비회원으로 지정 — assignUnmatched와 같은 이유로 side를 고정하지 않고 드래프트마다
  // 양쪽 팀을 모두 검사해 같은 이름이 나온 다른 드래프트에도 함께 반영한다. 다음에 같은
  // 이름이 또 매칭 안 되면 자동으로 같은 분류가 적용되도록 서버에도 기억시킨다.
  const markUnmatchedAs = (kind: "computer" | "unregistered", player: UnmatchedPlayer) => {
    setDrafts((prev) => prev.map((d) => {
      const t1Match = d.unmatchedTeam1.find((p) => p.rawName === player.rawName);
      const t2Match = d.unmatchedTeam2.find((p) => p.rawName === player.rawName);
      if (!t1Match && !t2Match) return d;
      const toSlot = (match: UnmatchedPlayer): MatchSlot => ({
        memberId: kind === "computer" ? newComputerSlotId() : newUnregisteredSlotId(),
        race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount,
      });
      return {
        ...d,
        team1: t1Match ? [...d.team1, toSlot(t1Match)] : d.team1,
        unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== player.rawName),
        team2: t2Match ? [...d.team2, toSlot(t2Match)] : d.team2,
        unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== player.rawName),
      };
    }));
    api.setReplayNameClassification(player.rawName, kind).catch(() => {});
  };

  // 미매칭 선수의 종족은 리플레이 파싱값이 기본이지만, 잘못 인식됐으면 연결 전에 바로 고칠
  // 수 있게 열어둔다 — 그 드래프트에만 적용(다른 드래프트는 각자 다른 경기일 수 있어 전파하지 않음).
  const setUnmatchedRace = (index: number, side: "team1" | "team2", rawName: string, race: Race | "") => {
    const d = drafts[index];
    if (side === "team1") updateDraft(index, { unmatchedTeam1: d.unmatchedTeam1.map((p) => (p.rawName === rawName ? { ...p, race } : p)) });
    else updateDraft(index, { unmatchedTeam2: d.unmatchedTeam2.map((p) => (p.rawName === rawName ? { ...p, race } : p)) });
  };

  // 관전자로 의심되는(노란 글로우) 미매칭 선수를 로스터에서 통째로 뺀다 — 회원/비회원/
  // 컴퓨터 어디로도 확정하지 않는다. 확실한 참가자는 반드시 셋 중 하나로 확정해야 하므로
  // 이 길은 MemberMultiSelect가 suspected한 사람에게만 열어준다.
  const removeUnmatched = (index: number, side: "team1" | "team2", rawName: string) => {
    const d = drafts[index];
    if (side === "team1") updateDraft(index, { unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== rawName) });
    else updateDraft(index, { unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== rawName) });
  };

  // teamSplitUncertain(screp이 팀을 못 나눔) 전용 — 이미 회원/컴퓨터/비회원으로 확정된
  // 슬롯을 반대 팀으로 통째로 옮긴다. mappingMode라 원래는 팀 구성을 못 바꾸지만, 이
  // 경우는 애초에 자동 분석이 실패한 상태라 사람이 직접 편을 갈라야 한다.
  const moveToOtherTeam = (index: number, fromSide: "team1" | "team2", row: MatchSlot) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== index) return d;
      const team1 = fromSide === "team1" ? d.team1.filter((r) => r !== row) : [...d.team1, row];
      const team2 = fromSide === "team2" ? d.team2.filter((r) => r !== row) : [...d.team2, row];
      const matchType = team1.length === 1 && team2.length === 1 ? "0101" : "0102";
      return { ...d, team1, team2, matchType };
    }));
  };

  // 위와 같은 이유로, 아직 회원 연결 전(미매칭)인 선수도 팀을 옮길 수 있어야 한다.
  const moveUnresolvedToOtherTeam = (index: number, fromSide: "team1" | "team2", rawName: string) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== index) return d;
      const fromList = fromSide === "team1" ? d.unmatchedTeam1 : d.unmatchedTeam2;
      const entry = fromList.find((p) => p.rawName === rawName);
      if (!entry) return d;
      if (fromSide === "team1") {
        return { ...d, unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== rawName), unmatchedTeam2: [...d.unmatchedTeam2, entry] };
      }
      return { ...d, unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== rawName), unmatchedTeam1: [...d.unmatchedTeam1, entry] };
    }));
  };

  // 중복으로 판정돼 제외된 것은(excludeReason==="duplicate") 되돌리면 같은 경기가 중복
  // 저장되므로 막는다(버튼 자체를 숨김). 이미 등록된 것도 건드리지 않는다.
  const toggleExcluded = (index: number) => {
    if (submittedIndices.has(index)) return;
    if (drafts[index].excludeReason === "duplicate") return;
    // 사용자가 직접 손대면 그 뒤로는 체크박스가 되돌리지 못하게 자동 제외 표시를 지운다.
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, excluded: !d.excluded, excludeReason: null } : d)));
  };

  // "컴퓨터 낀 경기 제외" — 컴퓨터(AI)가 한 자리라도 있는 리플레이를 통째로 등록에서 뺀다.
  // 체크를 풀면 이 체크박스가 뺐던 것만 되돌린다(excludeReason으로 누가 뺐는지 구분) —
  // 사용자가 직접 제외한 것과 중복 제외는 건드리지 않는다.
  const toggleExcludeComputer = (next: boolean) => {
    setExcludeComputer(next);
    setDrafts((prev) => prev.map((d, i) => {
      if (submittedIndices.has(i) || d.excludeReason === "duplicate" || !hasComputerSlot(d)) return d;
      if (next) return { ...d, excluded: true, excludeReason: "computer" as const };
      if (d.excludeReason !== "computer") return d;
      return { ...d, excluded: false, excludeReason: null };
    }));
  };

  // 중복(이미 등록된 경기)만 빼고 나머지는 매핑이 끝났든 아니든 전부 보여준다 — 등록 전에
  // 한 번은 항상 내용을 훑어보게 하기 위해서다. 제외를 누르면 그 자리에서 바로 사라지는
  // 대신(되돌릴 방법이 없어 보임) 계속 목록에 남아 딤 처리만 되고, 제외를 다시 풀 수도
  // 있다 — 자동 제외(중복)는 애초에 되돌릴 수 없으므로(버튼 자체가 숨겨짐) 여기 남겨둘
  // 이유가 없어 뺀다. 등록이 끝난 건 사라진다.
  const visibleIndices = drafts
    .map((_, i) => i)
    .filter((i) => !submittedIndices.has(i) && drafts[i].excludeReason !== "duplicate");

  const pendingIndices = drafts.map((_, i) => i).filter((i) => !drafts[i].excluded && !submittedIndices.has(i));
  const nonExcludedCount = drafts.filter((d) => !d.excluded).length;

  const requestClose = () => {
    if (pendingIndices.length > 0) setConfirmCloseOpen(true);
    else onClose();
  };

  const submitAll = async () => {
    if (pendingIndices.length === 0) { setErr("등록할 리플레이가 없어요 — 제외를 해제해 주세요."); return; }
    // 배틀태그로 못 찾아 남아있는 선수는 등록을 막는 대신 비회원("모름")로 채워서
    // 진행한다 — 나중에 유저 매핑 관리 화면에서 실제 회원으로 다시 연결할 수 있다.
    const resolved = drafts.map((d, i) => (pendingIndices.includes(i) ? resolveUnmatchedAsUnregistered(d) : d));
    for (const i of pendingIndices) {
      const problem = validateReplayDraft(resolved[i]);
      if (problem) { setErr(`"${resolved[i].fileName}": ${problem}`); return; }
    }
    setErr("");
    setBusy(true);
    try {
      let firstCreatedMatchId: number | null = null;
      for (const i of pendingIndices) {
        const d = resolved[i];
        const payload: NewMatch = {
          // validateReplayDraft가 바로 위에서 빈 승패(리플레이가 승자를 못 가려낸 경기)를 걸렀다.
          date: d.date, team1: d.team1, team2: d.team2, result: d.result as MatchResult, matchType: d.matchType,
          note: d.note, attachment: d.attachment,
          mapName: d.mapName || null, gameStartedAt: d.gameStartedAt, durationSeconds: d.durationSeconds,
        };
        const created = await addMatch(payload);
        if (firstCreatedMatchId === null) firstCreatedMatchId = created.id;
        setSubmittedIndices((prev) => new Set(prev).add(i));
        onRegistered?.(d.fileName);
      }
      // 도전장의 "리플레이 등록"에서 열렸을 때만(attachToChallengeId) 방금 만든 첫 경기를
      // 그 도전장의 결과로 연결한다 — 실패해도(예: 그 사이 다른 사람이 먼저 연결) 경기
      // 자체는 이미 등록됐으니 전체 저장을 실패로 되돌리지 않고 조용히 넘어간다.
      if (attachToChallengeId && firstCreatedMatchId !== null) {
        try {
          await api.attachChallengeResult(attachToChallengeId, firstCreatedMatchId);
        } catch {
          // 경기 등록 자체는 이미 성공했으므로 여기서 막지 않는다.
        }
      }
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className={cx("scr-modal scr-modal-match", visibleIndices.length === 0 && "scr-modal-match-compact")}>
        <div className="scr-modal-head">
          <span>등록 내용 확인 {visibleIndices.length > 0 && `(${visibleIndices.length}건)`}</span>
          <button className="scr-icon-btn" onClick={requestClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {truncated && (
            <div className="scr-hint scr-hint-left">
              한 번에 최대 {drafts.length}개까지만 등록할 수 있어 처음 {drafts.length}개만 불러왔어요.
            </div>
          )}

          {visibleIndices.length > 0 && (
            <label className="scr-checkbox-field">
              <input
                type="checkbox"
                checked={excludeComputer}
                onChange={(e) => toggleExcludeComputer(e.target.checked)}
              />
              컴퓨터 낀 경기 제외
            </label>
          )}

          {visibleIndices.length === 0 ? (
            <div className="scr-empty">등록할 리플레이가 없어요 — 모두 이미 등록된 경기예요.</div>
          ) : (
            <div className="scr-replay-mapping-list">
              {visibleIndices.map((i) => {
                const d = drafts[i];
                const t1Ids = d.team1.map((r) => r.memberId);
                const t2Ids = d.team2.map((r) => r.memberId);
                const usedIds = new Set([...t1Ids, ...t2Ids]);
                const candidates = members.filter((m) => m.status === "active" && !usedIds.has(m.id));
                const suspectedSet = new Set(d.guessedObservers);

                return (
                  <div key={d.fileName + i} className={cx("scr-replay-mapping-row", d.excluded && "scr-replay-draft-body-excluded")}>
                    <div className="scr-replay-mapping-row-head">
                      <span className="scr-mono scr-replay-mapping-row-name">
                        {d.fileName}{d.mapName ? ` · ${d.mapName}` : ""}
                      </span>
                      {d.excludeReason === "duplicate" ? (
                        <span className="scr-hint">이미 등록된 경기예요</span>
                      ) : (
                        <button
                          type="button" className="scr-btn scr-btn-ghost scr-btn-sm"
                          onClick={() => toggleExcluded(i)} disabled={submittedIndices.has(i)}
                        >
                          {d.excluded ? "제외 취소" : "제외"}
                        </button>
                      )}
                    </div>

                    {d.parseError && <div className="scr-err">{d.parseError}</div>}

                    {/* 일부 UMS 맵(슈퍼빨무 등)은 관전 슬롯이 섞이면 screp이 실제 참가자
                        전원에게 같은 팀 번호를 매겨버려 자동으로 편을 못 나눈다 — 아래
                        로스터에 전원이 1팀으로 몰려있고 2팀은 비어있을 거라고 미리 알려준다. */}
                    {d.teamSplitUncertain && (
                      <div className="scr-err">
                        이 리플레이는 팀을 자동으로 나누지 못했어요(맵 자체의 한계) — 아래에서 직접 편을 갈라 주세요.
                      </div>
                    )}

                    {/* 조작량이 적어 관전자로 의심되는 사람 — 로스터에서 빼지 않고 아래
                        칩에 노란 글로우로 표시했다. 진짜 관전자면 그 칩에서 직접 빼면 된다. */}
                    {d.guessedObservers.length > 0 && (
                      <div className="scr-hint scr-hint-left scr-hint-point">
                        관전자로 의심돼요(노란 표시): {d.guessedObservers.join(", ")} — 실제로 안 뛰었다면 그 칩에서 제거해 주세요.
                      </div>
                    )}

                    {/* 리플레이가 승자를 못 가려낸 경기만 승패 버튼이 나온다 — 판별된 경기는
                        그 값을 그대로 쓰므로 굳이 고를 게 없다(이 모달은 목록이라 행마다
                        버튼을 다 깔면 훑어보기 어렵다). */}
                    {!d.result && !d.parseError && (
                      <div className="scr-replay-mapping-result">
                        <span className="scr-hint scr-hint-point">승자를 자동으로 판별하지 못했어요 — 직접 선택해 주세요.</span>
                        <div className="scr-replay-mapping-result-btns">
                          {([
                            ["team1", "1팀승"], ["draw", "무"], ["team2", "2팀승"],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              className={cx("scr-result-btn", d.result === value && "scr-result-btn-active")}
                              onClick={() => updateDraft(i, { result: value })}
                              disabled={d.excluded}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="scr-team-grid scr-team-grid-noresult">
                      <div className="scr-team-grid-team1">
                        <MemberMultiSelect
                          members={members} addableMembers={candidates} rows={d.team1} setRows={(rows) => setTeam(i, "team1", rows)}
                          resolveDefaultRace={resolveDefaultRace}
                          unresolved={d.unmatchedTeam1.map((p) => ({ key: p.rawName, rawName: p.rawName, race: p.race }))}
                          unresolvedCandidates={candidates}
                          onResolve={(rawName, m) => assignUnmatched(d.unmatchedTeam1.find((p) => p.rawName === rawName)!, m)}
                          onUnresolvedRaceChange={(rawName, race) => setUnmatchedRace(i, "team1", rawName, race)}
                          onMarkComputer={(rawName) => markUnmatchedAs("computer", d.unmatchedTeam1.find((p) => p.rawName === rawName)!)}
                          onMarkUnregistered={(rawName) => markUnmatchedAs("unregistered", d.unmatchedTeam1.find((p) => p.rawName === rawName)!)}
                          onRemoveUnresolved={(rawName) => removeUnmatched(i, "team1", rawName)}
                          onMoveToOtherTeam={d.teamSplitUncertain ? (row) => moveToOtherTeam(i, "team1", row) : undefined}
                          onMoveUnresolvedToOtherTeam={d.teamSplitUncertain ? (rawName) => moveUnresolvedToOtherTeam(i, "team1", rawName) : undefined}
                          suspectedNames={suspectedSet}
                          disabled={d.excluded}
                          mappingMode
                        />
                      </div>
                      <span className="scr-vs-text scr-team-grid-vs">VS</span>
                      <div className="scr-team-grid-team2">
                        <MemberMultiSelect
                          members={members} addableMembers={candidates} rows={d.team2} setRows={(rows) => setTeam(i, "team2", rows)}
                          resolveDefaultRace={resolveDefaultRace}
                          unresolved={d.unmatchedTeam2.map((p) => ({ key: p.rawName, rawName: p.rawName, race: p.race }))}
                          unresolvedCandidates={candidates}
                          onResolve={(rawName, m) => assignUnmatched(d.unmatchedTeam2.find((p) => p.rawName === rawName)!, m)}
                          onUnresolvedRaceChange={(rawName, race) => setUnmatchedRace(i, "team2", rawName, race)}
                          onMarkComputer={(rawName) => markUnmatchedAs("computer", d.unmatchedTeam2.find((p) => p.rawName === rawName)!)}
                          onMarkUnregistered={(rawName) => markUnmatchedAs("unregistered", d.unmatchedTeam2.find((p) => p.rawName === rawName)!)}
                          onRemoveUnresolved={(rawName) => removeUnmatched(i, "team2", rawName)}
                          onMoveToOtherTeam={d.teamSplitUncertain ? (row) => moveToOtherTeam(i, "team2", row) : undefined}
                          onMoveUnresolvedToOtherTeam={d.teamSplitUncertain ? (rawName) => moveUnresolvedToOtherTeam(i, "team2", rawName) : undefined}
                          suspectedNames={suspectedSet}
                          disabled={d.excluded}
                          mappingMode
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-ghost" onClick={requestClose}>취소</button>
            <button type="button" className="scr-btn scr-btn-primary" onClick={submitAll} disabled={busy}>
              {busy ? <><Spinner /> 등록 중... ({submittedIndices.size}/{nonExcludedCount})</> : `등록 (${pendingIndices.length})`}
            </button>
          </div>
        </div>
      </div>

      {confirmCloseOpen && (
        <ConfirmDialog
          title="작성을 취소하시겠어요?"
          message=""
          confirmLabel="닫기"
          cancelLabel="계속 등록"
          onConfirm={onClose}
          onCancel={() => setConfirmCloseOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}
