import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, ChevronLeft, ChevronRight } from "lucide-react";
import DateField from "../components/calendar/DateField";
import MemberMultiSelect from "../components/select/MemberMultiSelect";
import Select from "../components/common/Select";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { cx } from "../utils/format";
import { hasComputerSlot, validateReplayDraft, type ReplayDraft, type UnmatchedPlayer } from "../utils/replayDraft";
import { useAppStore } from "../store/appStore";
import { MATCH_TYPE_INFO, MATCH_TYPE_OPTIONS } from "../constants/matchTypes";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { api } from "../api/client";
import { newComputerSlotId } from "../constants/computerSlot";
import { newUnregisteredSlotId } from "../constants/unregisteredSlot";
import { useDefaultRaceResolver } from "../hooks/useDefaultRaceResolver";
import type { MatchSlot, MatchType, MatchResult, NewMatch, Race, Member } from "../types";

interface ReplayRegisterModalProps {
  // 분석은 이 모달을 열기 전에 이미 끝나 있다(부모가 buildReplayDrafts로 미리 만들어 전달) —
  // 분석 중 스피너는 모달이 아니라 화면(예: 경기결과 목록 자리)에서 보여준다.
  drafts: ReplayDraft[];
  // 한 번에 고를 수 있는 최대 개수(10개)를 넘겨서 앞쪽만 잘라 받았을 때 true
  truncated?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  // 리플레이 하나가 실제로 등록될 때마다 그 파일명을 알려준다 — 배치 등록처럼 자기 쪽
  // 목록을 갖고 있는 호출부가 "이건 이제 등록됐다"고 표시를 갱신할 수 있게. 전체 저장이
  // 끝난 뒤의 onSaved만으로는 어떤 파일이 등록되고 어떤 게 제외됐는지 구분할 수 없다.
  onRegistered?: (fileName: string) => void;
}

const MATCH_TYPE_SELECT_OPTS_FALLBACK = MATCH_TYPE_OPTIONS.map((v) => ({ value: v, label: MATCH_TYPE_INFO[v] }));

// 리플레이(.rep) 파일을 한 번에 여러 개(최대 10개) 분석한 결과를 리플레이당 하나씩
// 검토/수정 화면을 넘겨보면서 확인하고 한꺼번에 등록한다. screp이 승자를 "마지막까지
// 남은 가장 큰 팀"으로 추정하는 것뿐이라 항상 결과를 다시 확인시키고, 배틀태그로 못 찾은
// 선수는 직접 추가하도록 안내만 해준다.
export default function ReplayRegisterModal({ drafts: initialDrafts, truncated = false, onClose, onSaved, onRegistered }: ReplayRegisterModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const addMatch = useAppStore((s) => s.addMatch);
  const addMemberReplayAlias = useAppStore((s) => s.addMemberReplayAlias);
  const matchTypeOptions = MATCH_TYPE_SELECT_OPTS_FALLBACK;

  const [drafts, setDrafts] = useState<ReplayDraft[]>(initialDrafts);
  // 중복 등록으로 이미 제외된 게 앞쪽에 몰려 있으면(파일 정렬 순서상 흔함), 굳이 그것부터
  // 보여줄 필요가 없다 — 실제로 검토가 필요한 첫 번째(제외되지 않은) 리플레이로 바로 연다.
  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = initialDrafts.findIndex((d) => !d.excluded);
    return idx === -1 ? 0 : idx;
  });
  // 제외되지 않은 드래프트 중 실제로 등록에 성공한 것들의 인덱스 — 제외 처리 때문에
  // 등록 순서가 배열 순서와 어긋날 수 있어(중간에 낀 항목을 건너뜀) 단순 개수 대신
  // 인덱스 집합으로 추적한다.
  const [submittedIndices, setSubmittedIndices] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [excludeComputer, setExcludeComputer] = useState(false);

  const resolveDefaultRace = useDefaultRaceResolver(members);

  const requestClose = () => {
    const pending = drafts.some((d, i) => !d.excluded && !submittedIndices.has(i));
    if (pending) setConfirmCloseOpen(true);
    else onClose();
  };

  const active = drafts[activeIndex];
  const suspectedSet = new Set(active.guessedObservers);

  const updateActive = (patch: Partial<ReplayDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === activeIndex ? { ...d, ...patch } : d)));
  };

  const setTeam1 = (rows: MatchSlot[]) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== activeIndex) return d;
      const matchType = rows.length === 1 && d.team2.length === 1 ? "0101" : "0102";
      return { ...d, team1: rows, matchType };
    }));
  };
  const setTeam2 = (rows: MatchSlot[]) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== activeIndex) return d;
      const matchType = d.team1.length === 1 && rows.length === 1 ? "0101" : "0102";
      return { ...d, team2: rows, matchType };
    }));
  };

  // 미매칭 선수를 회원과 연결: 같은 이름(rawName)이 나온 배치 안의 다른 리플레이(드래프트)에도
  // 한 번에 반영한다 — 그렇지 않으면 리플레이마다 같은 사람을 매번 다시 연결해야 했다.
  // 각 드래프트에서 그 팀에 이미 같은 회원이 있으면(드물게 중복) 그 드래프트는 건드리지 않고
  // 그대로 미매칭으로 남겨 수동으로 확인하게 한다. 연결하면 다음부터 자동 매칭되도록 이 이름을
  // 그 회원의 replayAlias로도 저장한다 (저장이 실패해도 팀 배정 자체는 그대로 유지한다).
  const assignUnmatched = (side: "team1" | "team2", player: UnmatchedPlayer, member: Member) => {
    setDrafts((prev) => prev.map((d) => {
      const pool = side === "team1" ? d.unmatchedTeam1 : d.unmatchedTeam2;
      const match = pool.find((p) => p.rawName === player.rawName);
      if (!match) return d;
      if (d.team1.some((r) => r.memberId === member.id) || d.team2.some((r) => r.memberId === member.id)) return d;
      // 회원으로 연결해도 리플레이 원본 게임 아이디(rawName)는 그대로 들고 간다 —
      // member.battletag는 나중에 바뀔 수 있어 이 값이 이 경기 시점의 유일한 증거다.
      const slot: MatchSlot = {
        memberId: member.id, race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount,
      };
      if (side === "team1") {
        return { ...d, team1: [...d.team1, slot], unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== player.rawName) };
      }
      return { ...d, team2: [...d.team2, slot], unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== player.rawName) };
    }));
    addMemberReplayAlias(member.id, player.rawName).catch(() => {
      // 이름 저장은 실패해도 팀 배정은 이미 반영됐으니 무시한다 (다음 리플레이에서 다시 수동 연결하면 된다).
    });
  };

  // 컴퓨터(AI) 참가자는 배틀태그가 없어 애초에 회원과 연결할 수 없다 — 회원 연결 대신
  // 컴퓨터 슬롯으로 바로 지정한다. 같은 이름이 나온 다른 드래프트에도 함께 반영하는 건
  // assignUnmatched와 동일(예: 컴퓨터 이름이 배치 전체에서 반복되는 경우). 다음에 같은
  // 이름이 또 매칭 안 되면 자동으로 컴퓨터로 채워지도록 서버에도 기억시킨다(실패해도
  // 이번 등록 자체는 이미 반영됐으니 무시 — replayAlias 저장과 같은 원칙).
  const markUnmatchedAsComputer = (side: "team1" | "team2", player: UnmatchedPlayer) => {
    setDrafts((prev) => prev.map((d) => {
      const pool = side === "team1" ? d.unmatchedTeam1 : d.unmatchedTeam2;
      const match = pool.find((p) => p.rawName === player.rawName);
      if (!match) return d;
      const slot: MatchSlot = {
        memberId: newComputerSlotId(), race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount,
      };
      if (side === "team1") {
        return { ...d, team1: [...d.team1, slot], unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== player.rawName) };
      }
      return { ...d, team2: [...d.team2, slot], unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== player.rawName) };
    }));
    api.setReplayNameClassification(player.rawName, "computer").catch(() => {});
  };

  // 아직 가입하지 않은 실제 사람 — 컴퓨터와 저장 방식은 같고(회원 없이 슬롯만 채움) 종족만
  // 그대로 유지한다는 점만 markUnmatchedAsComputer와 다르다. 나중에 그 사람이 가입하면
  // 게임아이디로 수동 연결하면 된다. 서버에 분류를 기억시키는 것도 컴퓨터와 동일.
  const markUnmatchedAsUnregistered = (side: "team1" | "team2", player: UnmatchedPlayer) => {
    setDrafts((prev) => prev.map((d) => {
      const pool = side === "team1" ? d.unmatchedTeam1 : d.unmatchedTeam2;
      const match = pool.find((p) => p.rawName === player.rawName);
      if (!match) return d;
      const slot: MatchSlot = {
        memberId: newUnregisteredSlotId(), race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount,
      };
      if (side === "team1") {
        return { ...d, team1: [...d.team1, slot], unmatchedTeam1: d.unmatchedTeam1.filter((p) => p.rawName !== player.rawName) };
      }
      return { ...d, team2: [...d.team2, slot], unmatchedTeam2: d.unmatchedTeam2.filter((p) => p.rawName !== player.rawName) };
    }));
    api.setReplayNameClassification(player.rawName, "unregistered").catch(() => {});
  };

  // 미매칭 선수의 종족은 리플레이 파싱값이 기본이지만, 잘못 인식됐으면 연결 전에 바로 고칠
  // 수 있게 열어둔다 — 활성 드래프트에만 적용(다른 드래프트는 각자 다른 경기일 수 있어 전파하지 않음).
  const setUnmatchedRace = (side: "team1" | "team2", rawName: string, race: Race | "") => {
    if (side === "team1") {
      updateActive({ unmatchedTeam1: active.unmatchedTeam1.map((p) => (p.rawName === rawName ? { ...p, race } : p)) });
    } else {
      updateActive({ unmatchedTeam2: active.unmatchedTeam2.map((p) => (p.rawName === rawName ? { ...p, race } : p)) });
    }
  };

  // 관전자로 의심되는(노란 글로우) 미매칭 선수를 로스터에서 통째로 뺀다 — 회원/비회원/
  // 컴퓨터 어디로도 확정하지 않는다. ReplayReviewModal(v2)의 removeUnmatched와 같은 원칙.
  const removeUnmatched = (side: "team1" | "team2", rawName: string) => {
    if (side === "team1") {
      updateActive({ unmatchedTeam1: active.unmatchedTeam1.filter((p) => p.rawName !== rawName) });
    } else {
      updateActive({ unmatchedTeam2: active.unmatchedTeam2.filter((p) => p.rawName !== rawName) });
    }
  };

  // teamSplitUncertain(screp이 팀을 못 나눔) 전용 — 확정된 슬롯을 반대 팀으로 옮긴다.
  // ReplayReviewModal(v2)의 moveToOtherTeam과 같은 원칙.
  const moveToOtherTeam = (fromSide: "team1" | "team2", row: MatchSlot) => {
    const team1 = fromSide === "team1" ? active.team1.filter((r) => r !== row) : [...active.team1, row];
    const team2 = fromSide === "team2" ? active.team2.filter((r) => r !== row) : [...active.team2, row];
    const matchType = team1.length === 1 && team2.length === 1 ? "0101" : "0102";
    updateActive({ team1, team2, matchType });
  };

  // 위와 같은 이유로 미매칭 선수도 팀을 옮길 수 있어야 한다.
  const moveUnresolvedToOtherTeam = (fromSide: "team1" | "team2", rawName: string) => {
    const fromList = fromSide === "team1" ? active.unmatchedTeam1 : active.unmatchedTeam2;
    const entry = fromList.find((p) => p.rawName === rawName);
    if (!entry) return;
    if (fromSide === "team1") {
      updateActive({ unmatchedTeam1: active.unmatchedTeam1.filter((p) => p.rawName !== rawName), unmatchedTeam2: [...active.unmatchedTeam2, entry] });
    } else {
      updateActive({ unmatchedTeam2: active.unmatchedTeam2.filter((p) => p.rawName !== rawName), unmatchedTeam1: [...active.unmatchedTeam1, entry] });
    }
  };

  // 내전이 아닌 리플레이나 이미 등록된 경기(중복)는 배열에서 지우지 않고 "제외" 표시만
  // 토글한다 — 이미 등록된(submittedIndices) 것은 되돌릴 수 없으니 건드리지 않는다. 중복으로
  // 판정돼 제외된 것도(excludeReason==="duplicate") 사용자가 제외를 풀고 다시 등록해버리면
  // 같은 경기가 중복으로 저장되므로, 여기서도 막는다(아래 버튼 자체도 숨긴다).
  // "컴퓨터 낀 경기 제외" — 컴퓨터(AI)가 한 자리라도 있는 리플레이를 통째로 등록에서 뺀다.
  // 이미 등록된 것과 중복으로 제외된 것은 건드리지 않는다(되돌릴 수 없는 상태라서). 체크를
  // 풀면 이 체크박스가 뺐던 것만 되돌린다 — 사용자가 직접 제외한 건 그대로 둔다(그래서
  // excludeReason에 "computer"를 남겨 누가 뺐는지 구분한다).
  const toggleExcludeComputer = (next: boolean) => {
    setExcludeComputer(next);
    setDrafts((prev) => prev.map((d, i) => {
      if (submittedIndices.has(i) || d.excludeReason === "duplicate" || !hasComputerSlot(d)) return d;
      if (next) return { ...d, excluded: true, excludeReason: "computer" as const };
      if (d.excludeReason !== "computer") return d;
      return { ...d, excluded: false, excludeReason: null };
    }));
  };

  const toggleExcluded = (index: number) => {
    if (submittedIndices.has(index)) return;
    if (drafts[index].excludeReason === "duplicate") return;
    // 사용자가 직접 손대면 그 뒤로는 체크박스가 되돌리지 못하게 자동 제외 표시를 지운다.
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, excluded: !d.excluded, excludeReason: null } : d)));
  };

  const t1Ids = active.team1.map((r) => r.memberId);
  const t2Ids = active.team2.map((r) => r.memberId);
  const activeMembers = members.filter((m) => m.status === "active");
  const membersForT1 = activeMembers.filter((m) => !t2Ids.includes(m.id));
  const membersForT2 = activeMembers.filter((m) => !t1Ids.includes(m.id));
  const candidatesForUnmatchedTeam1 = membersForT1.filter((m) => !t1Ids.includes(m.id));
  const candidatesForUnmatchedTeam2 = membersForT2.filter((m) => !t2Ids.includes(m.id));

  const nonExcludedCount = drafts.filter((d) => !d.excluded).length;
  const pendingIndices = drafts
    .map((_, i) => i)
    .filter((i) => !drafts[i].excluded && !submittedIndices.has(i));

  const submitAll = async () => {
    if (pendingIndices.length === 0) { setErr("등록할 리플레이가 없어요 — 제외를 해제해 주세요."); return; }
    for (const i of pendingIndices) {
      const problem = validateReplayDraft(drafts[i]);
      if (problem) {
        setActiveIndex(i);
        setErr(`"${drafts[i].fileName}": ${problem}`);
        return;
      }
    }
    setErr("");
    setBusy(true);
    try {
      for (const i of pendingIndices) {
        const d = drafts[i];
        const payload: NewMatch = {
          // validateReplayDraft가 바로 위에서 빈 승패를 걸러냈으므로 여기선 항상 값이 있다.
          date: d.date, team1: d.team1, team2: d.team2, result: d.result as MatchResult, matchType: d.matchType,
          note: d.note, attachment: d.attachment,
          mapName: d.mapName || null, gameStartedAt: d.gameStartedAt, durationSeconds: d.durationSeconds,
        };
        await addMatch(payload);
        setSubmittedIndices((prev) => new Set(prev).add(i));
        onRegistered?.(d.fileName);
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
      <div className="scr-modal scr-modal-match">
        <div className="scr-modal-head">
          <span>리플레이로 등록 ({activeIndex + 1}/{drafts.length})</span>
          <button className="scr-icon-btn" onClick={requestClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {truncated && (
            <div className="scr-hint scr-hint-left">
              한 번에 최대 {drafts.length}개까지만 등록할 수 있어 처음 {drafts.length}개만 불러왔어요.
            </div>
          )}

          <div className="scr-replay-pager">
            {drafts.map((d, i) => (
              <button
                key={d.fileName + i}
                type="button"
                className={cx(
                  "scr-text-pill",
                  i === activeIndex && "scr-text-pill-active",
                  d.excluded && "scr-replay-pager-item-excluded",
                )}
                onClick={() => setActiveIndex(i)}
              >
                {submittedIndices.has(i) ? <Check size={11} /> : i + 1}
              </button>
            ))}
          </div>

          <div className="scr-replay-exclude-row">
            <label className="scr-checkbox-field">
              <input
                type="checkbox"
                checked={excludeComputer}
                onChange={(e) => toggleExcludeComputer(e.target.checked)}
              />
              컴퓨터 낀 경기 제외
            </label>
          </div>

          <div className="scr-replay-exclude-row">
            {active.excludeReason === "duplicate" ? (
              // 중복은 이미 등록된 경기라는 뜻이라, 제외를 풀고 다시 등록하면 같은 경기가
              // 중복 저장된다 — 되돌릴 수 있는 버튼 자체를 안 보여준다.
              <span className="scr-hint">이미 등록된 경기예요 (중복 등록을 막기 위해 제외를 해제할 수 없어요)</span>
            ) : (
              <button
                type="button"
                className="scr-btn scr-btn-ghost scr-btn-sm"
                onClick={() => toggleExcluded(activeIndex)}
                disabled={submittedIndices.has(activeIndex)}
              >
                {active.excluded ? "제외 취소" : "현재 리플레이 제외하기"}
              </button>
            )}
          </div>

          <div className={cx("scr-replay-draft-body", active.excluded && "scr-replay-draft-body-excluded")}>
            <div className="scr-match-detail-cell scr-match-detail-cell-full">
              <span className="scr-label">리플레이명</span>
              <span className="scr-mono">
                {active.fileName}{active.mapName ? ` · ${active.mapName}` : ""}
              </span>
            </div>

            {active.parseError && <div className="scr-err">{active.parseError}</div>}

            <label className="scr-field">
              <span className="scr-label">날짜</span>
              <DateField
                value={active.date}
                onChange={(v) => updateActive({ date: v })}
                onDayPick={(v) => updateActive({ date: v })}
                placeholder="날짜 선택 (YYYY-MM-DD)"
                rangeFrom=""
                rangeTo=""
                disabled={active.excluded}
              />
            </label>

            <div className="scr-field">
              <span className="scr-label">게임유형</span>
              <Select
                value={active.matchType}
                options={matchTypeOptions}
                onChange={(v) => updateActive({ matchType: v as MatchType })}
                disabled={active.excluded}
              />
            </div>

            <div className="scr-team-grid">
              <button
                type="button"
                className={cx("scr-result-btn scr-team-grid-btn1", active.result === "team1" && "scr-result-btn-active")}
                onClick={() => updateActive({ result: "team1" })}
                aria-label="1팀 승리"
                disabled={active.excluded}
              >
                1팀승
              </button>
              <button
                type="button"
                className={cx("scr-result-btn scr-result-btn-draw scr-team-grid-btn-draw", active.result === "draw" && "scr-result-btn-active")}
                onClick={() => updateActive({ result: "draw" })}
                aria-label="무승부"
                disabled={active.excluded}
              >
                무
              </button>
              <button
                type="button"
                className={cx("scr-result-btn scr-team-grid-btn2", active.result === "team2" && "scr-result-btn-active")}
                onClick={() => updateActive({ result: "team2" })}
                aria-label="2팀 승리"
                disabled={active.excluded}
              >
                2팀승
              </button>

              <div className="scr-team-grid-team1">
                <MemberMultiSelect
                  members={members} addableMembers={membersForT1} rows={active.team1} setRows={setTeam1}
                  resolveDefaultRace={resolveDefaultRace}
                  unresolved={active.unmatchedTeam1.map((p) => ({ key: p.rawName, rawName: p.rawName, race: p.race }))}
                  unresolvedCandidates={candidatesForUnmatchedTeam1}
                  onResolve={(rawName, m) => assignUnmatched("team1", active.unmatchedTeam1.find((p) => p.rawName === rawName)!, m)}
                  onUnresolvedRaceChange={(rawName, race) => setUnmatchedRace("team1", rawName, race)}
                  onMarkComputer={(rawName) => markUnmatchedAsComputer("team1", active.unmatchedTeam1.find((p) => p.rawName === rawName)!)}
                  onMarkUnregistered={(rawName) => markUnmatchedAsUnregistered("team1", active.unmatchedTeam1.find((p) => p.rawName === rawName)!)}
                  onRemoveUnresolved={(rawName) => removeUnmatched("team1", rawName)}
                  onMoveToOtherTeam={active.teamSplitUncertain ? (row) => moveToOtherTeam("team1", row) : undefined}
                  onMoveUnresolvedToOtherTeam={active.teamSplitUncertain ? (rawName) => moveUnresolvedToOtherTeam("team1", rawName) : undefined}
                  suspectedNames={suspectedSet}
                  disabled={active.excluded}
                />
              </div>
              <span className="scr-vs-text scr-team-grid-vs">VS</span>
              <div className="scr-team-grid-team2">
                <MemberMultiSelect
                  members={members} addableMembers={membersForT2} rows={active.team2} setRows={setTeam2}
                  resolveDefaultRace={resolveDefaultRace}
                  unresolved={active.unmatchedTeam2.map((p) => ({ key: p.rawName, rawName: p.rawName, race: p.race }))}
                  unresolvedCandidates={candidatesForUnmatchedTeam2}
                  onResolve={(rawName, m) => assignUnmatched("team2", active.unmatchedTeam2.find((p) => p.rawName === rawName)!, m)}
                  onUnresolvedRaceChange={(rawName, race) => setUnmatchedRace("team2", rawName, race)}
                  onMarkComputer={(rawName) => markUnmatchedAsComputer("team2", active.unmatchedTeam2.find((p) => p.rawName === rawName)!)}
                  onRemoveUnresolved={(rawName) => removeUnmatched("team2", rawName)}
                  onMoveToOtherTeam={active.teamSplitUncertain ? (row) => moveToOtherTeam("team2", row) : undefined}
                  onMoveUnresolvedToOtherTeam={active.teamSplitUncertain ? (rawName) => moveUnresolvedToOtherTeam("team2", rawName) : undefined}
                  suspectedNames={suspectedSet}
                  onMarkUnregistered={(rawName) => markUnmatchedAsUnregistered("team2", active.unmatchedTeam2.find((p) => p.rawName === rawName)!)}
                  disabled={active.excluded}
                />
              </div>
            </div>

            {active.winnerSide === null && !active.parseError && (
              <div className="scr-hint scr-hint-left">승자를 자동으로 판별하지 못했어요 — 직접 선택해 주세요.</div>
            )}
            {/* 일부 UMS 맵(슈퍼빨무 등)은 관전 슬롯이 섞이면 screp이 실제 참가자 전원에게
                같은 팀 번호를 매겨버려 자동으로 편을 못 나눈다. */}
            {active.teamSplitUncertain && (
              <div className="scr-err">
                이 리플레이는 팀을 자동으로 나누지 못했어요(맵 자체의 한계) — 아래에서 직접 편을 갈라 주세요.
              </div>
            )}
            {/* 조작량이 적어 관전자로 의심되는 사람 — 로스터에서 빼지 않고 아래 칩에
                노란 글로우로 표시했다. 진짜 관전자면 그 칩에서 직접 빼면 된다. */}
            {active.guessedObservers.length > 0 && (
              <div className="scr-hint scr-hint-left scr-hint-point">
                관전자로 의심돼요(노란 표시): {active.guessedObservers.join(", ")} — 실제로 안 뛰었다면 그 칩에서 제거해 주세요.
              </div>
            )}

            <label className="scr-field">
              <span className="scr-label">메모</span>
              <textarea
                className="scr-input scr-textarea"
                value={active.note}
                onChange={(e) => updateActive({ note: e.target.value })}
                rows={3}
                disabled={active.excluded}
              />
            </label>
          </div>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <div className="scr-replay-nav">
              <button
                type="button"
                className="scr-btn scr-btn-ghost"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={activeIndex === 0}
              >
                <ChevronLeft size={14} /> 이전
              </button>
              <button
                type="button"
                className="scr-btn scr-btn-ghost"
                onClick={() => setActiveIndex((i) => Math.min(drafts.length - 1, i + 1))}
                disabled={activeIndex === drafts.length - 1}
              >
                다음 <ChevronRight size={14} />
              </button>
            </div>
            <button type="button" className="scr-btn scr-btn-ghost" onClick={requestClose}>취소</button>
            <button type="button" className="scr-btn scr-btn-primary" onClick={submitAll} disabled={busy}>
              {busy ? <><Spinner /> 등록 중... ({submittedIndices.size}/{nonExcludedCount})</> : "등록"}
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
