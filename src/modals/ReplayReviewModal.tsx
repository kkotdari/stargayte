import { useState } from "react";
import ModalHash from "../utils/modalHash";
import { createPortal } from "react-dom";
import { Upload, X } from "lucide-react";
import MemberMultiSelect from "../components/select/MemberMultiSelect";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { cx } from "../utils/format";
import { hasComputerSlot, hasUnregisteredSlot, shortMatchHint, validateReplayDraft, resolveUnmatchedAsUnregistered, type ReplayDraft, type UnmatchedPlayer } from "../utils/replayDraft";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { api } from "../api/client";
import { newComputerSlotId } from "../constants/computerSlot";
import { newUnregisteredSlotId } from "../constants/unregisteredSlot";
import { useDefaultRaceResolver } from "../hooks/useDefaultRaceResolver";
import type { GameResultSlot, GameOutcome, NewGameResult, Race, Member } from "../types";

/** 리플레이 한 건의 판정(요청) — 초록(정상) / 노랑(검토필요) / 빨강(실패), 그리고 그 이유.
 *
 *  갈래를 셋으로만 두는 건 이 창이 답해야 하는 물음이 하나이기 때문이다: "지금 그냥 등록해도
 *  되나?" 초록은 되고, 노랑은 사람이 한 번 손대야 하고, 빨강은 아예 못 쓴다.
 *
 *  issues는 사람이 손대야 풀리는 것들이라 하나라도 남아 있으면 등록을 막는다(요청). notes는
 *  알려만 주는 것들이라 막지 않는다 — "관전자로 의심된다"는 사람이 확인만 하면 되는 일이고,
 *  거기에 남길 상태가 없어 영영 안 풀린 것으로 남기 때문이다. */
type ReviewLevel = "ok" | "warn" | "error" | "skip";

interface ReviewVerdict {
  level: ReviewLevel;
  badge: string;
  issues: string[];
  notes: string[];
}

function reviewOf(d: ReplayDraft): ReviewVerdict {
  if (d.excludeReason === "duplicate") {
    return { level: "skip", badge: d.merged ? "업데이트됨" : "이미 등록됨", issues: [], notes: [] };
  }
  if (d.parseError) {
    return { level: "error", badge: "실패", issues: [`리플레이를 읽지 못했어요 — ${d.parseError}`], notes: [] };
  }
  const issues: string[] = [];
  const notes: string[] = [];
  if (d.teamSplitUncertain) {
    issues.push("팀을 자동으로 나누지 못했어요(맵 자체의 한계) — 아래에서 직접 편을 갈라 주세요.");
  }
  const unmatched = [...d.unmatchedTeam1, ...d.unmatchedTeam2].map((p) => p.rawName);
  if (unmatched.length > 0) {
    issues.push(`아직 연결되지 않은 참가자가 있어요: ${unmatched.join(", ")} — 회원·컴퓨터·비회원 중 하나로 연결해 주세요.`);
  }
  if (!d.result) {
    issues.push("승자를 자동으로 판별하지 못했어요 — 아래에서 직접 골라 주세요.");
  }
  if (d.guessedObservers.length > 0) {
    notes.push(`관전자로 의심되는 사람이 있어요(노란 표시): ${d.guessedObservers.join(", ")} — 실제로 안 뛰었다면 그 칩에서 빼 주세요.`);
  }
  const short = shortMatchHint(d);
  if (short) notes.push(short);
  if (issues.length > 0) return { level: "warn", badge: "검토필요", issues, notes };
  return { level: "ok", badge: "정상", issues: [], notes };
}

/** 펼쳤을 때 맨 위에 적는 한 줄 — 언제 시작해 얼마나 걸린 무슨 경기였나(요청: 게임정보). */
function gameLineOf(d: ReplayDraft): string {
  const parts: string[] = [];
  if (d.gameStartedAt) {
    const t = new Date(d.gameStartedAt);
    if (!Number.isNaN(t.getTime())) {
      parts.push(`${t.getMonth() + 1}월 ${t.getDate()}일 `
        + `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`);
    }
  } else if (d.date) parts.push(d.date);
  if (d.durationSeconds != null) {
    parts.push(`${Math.floor(d.durationSeconds / 60)}분 ${String(d.durationSeconds % 60).padStart(2, "0")}초`);
  }
  parts.push(d.matchType === "0101" ? "개인전" : "팀전");
  const RESULT_KO: Record<string, string> = { team1: "1팀 승", team2: "2팀 승", draw: "무승부", not_held: "미실시" };
  parts.push(d.result ? RESULT_KO[d.result] ?? d.result : "승패 미정");
  return parts.join(" · ");
}

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
}

// v2 "등록 내용 확인" 모달 — 예전엔 매칭이 끝났거나 파싱이 성공한 리플레이는 이 모달을
// 열기 전에(그때의 기록실 화면 — 지금은 없다) 조용히 자동 등록되고, 여기는 사람이
// 매핑해야 하는 것만 보여줬다.
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
  drafts: initialDrafts, truncated = false, onClose, onSaved, onRegistered,
}: ReplayReviewModalProps) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);
  const addGameResult = useAppStore((s) => s.addGameResult);
  const addMemberReplayAlias = useAppStore((s) => s.addMemberReplayAlias);

  const [drafts, setDrafts] = useState<ReplayDraft[]>(initialDrafts);
  // 제외되지 않은 드래프트 중 실제로 등록에 성공한 것들의 인덱스.
  const [submittedIndices, setSubmittedIndices] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [excludeComputer, setExcludeComputer] = useState(false);
  const [excludeNonMember, setExcludeNonMember] = useState(false);
  /* 목록은 접힌 채로 시작한다(요청: 누르면 아래로 펼쳐지며 게임정보) — 판정과 파일명만
     쭉 훑고, 손댈 것이 있는 건만 열어 보는 흐름이다. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const resolveDefaultRace = useDefaultRaceResolver(members);

  const updateDraft = (index: number, patch: Partial<ReplayDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const setTeam = (index: number, side: "team1" | "team2", rows: GameResultSlot[]) => {
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
      const toSlot = (match: UnmatchedPlayer): GameResultSlot => ({
        memberId: member.id, race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount, buildCount: match.buildCount, buildMix: match.buildMix,
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
      const toSlot = (match: UnmatchedPlayer): GameResultSlot => ({
        memberId: kind === "computer" ? newComputerSlotId() : newUnregisteredSlotId(),
        race: match.race, rawName: match.rawName,
        apm: match.apm, eapm: match.eapm, cmdCount: match.cmdCount, effectiveCmdCount: match.effectiveCmdCount, buildCount: match.buildCount, buildMix: match.buildMix,
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
  const moveToOtherTeam = (index: number, fromSide: "team1" | "team2", row: GameResultSlot) => {
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

  /* "비회원 낀 경기 제외"(요청) — 컴퓨터 제외와 같은 규칙이다. 체크를 풀면 이 체크박스가
     뺐던 것만 되돌린다(excludeReason으로 누가 뺐는지 구분) — 사용자가 직접 제외한 것과
     중복·컴퓨터 제외는 안 건드린다.
     아직 연결 안 된 참가자가 있는 건도 함께 뺀다 — 등록을 누르는 순간 그들이 비회원으로
     채워지기 때문이다(hasUnregisteredSlot 주석). 그래서 이 체크를 켜면 '검토필요'로
     막혀 있던 건들도 함께 빠져 등록이 곧바로 열리는 일이 많다. */
  const toggleExcludeNonMember = (next: boolean) => {
    setExcludeNonMember(next);
    setDrafts((prev) => prev.map((d, i) => {
      if (submittedIndices.has(i) || d.excludeReason === "duplicate"
        || d.excludeReason === "computer" || !hasUnregisteredSlot(d)) return d;
      if (next) return { ...d, excluded: true, excludeReason: "nonmember" as const };
      if (d.excludeReason !== "nonmember") return d;
      return { ...d, excluded: false, excludeReason: null };
    }));
  };

  // 중복(이미 등록된 경기)만 빼고 나머지는 매핑이 끝났든 아니든 전부 보여준다 — 등록 전에
  // 한 번은 항상 내용을 훑어보게 하기 위해서다. 제외를 누르면 그 자리에서 바로 사라지는
  // 대신(되돌릴 방법이 없어 보임) 계속 목록에 남아 딤 처리만 되고, 제외를 다시 풀 수도
  // 있다 — 자동 제외(중복)는 애초에 되돌릴 수 없으므로(버튼 자체가 숨겨짐) 여기 남겨둘
  // 이유가 없어 뺀다. 등록이 끝난 건 사라진다.
  /* 검토 대상이 있건 없건 전부 보여준다(요청) — 중복이라 등록에서 빠지는 것도 목록에는
     남는다. "왜 이 파일은 아무 데도 안 보이지"가 이 창에서 가장 자주 나오던 물음이었다. */
  const visibleIndices = drafts.map((_, i) => i).filter((i) => !submittedIndices.has(i));

  /* 사람이 손대야 풀리는 것이 남은 건들 — 하나라도 있으면 등록을 막는다(요청). 제외한
     건은 애초에 등록에 안 들어가므로 세지 않는다. */
  const blocked = visibleIndices
    .map((i) => ({ i, v: reviewOf(drafts[i]) }))
    .filter(({ i, v }) => !drafts[i].excluded && v.issues.length > 0);

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
      for (const i of pendingIndices) {
        const d = resolved[i];
        const payload: NewGameResult = {
          // validateReplayDraft가 바로 위에서 빈 승패(리플레이가 승자를 못 가려낸 경기)를 걸렀다.
          date: d.date, team1: d.team1, team2: d.team2, result: d.result as GameOutcome, matchType: d.matchType,
          replay: d.replay,
          mapName: d.mapName || null, gameStartedAt: d.gameStartedAt, durationSeconds: d.durationSeconds,
          mapData: d.mapGrid,
        };
        const saved = await addGameResult(payload);
        // 개체 트랙 v2 — 경기 저장이 끝난 뒤 별도 테이블에 따로 올린다(요청: 태그 단위
        // 분석을 별도 테이블로 저장해 비교). 실패해도 경기 등록은 이미 끝났으므로 막지 않는다.
        if (d.unitTracks && saved?.id) {
          api.putGameUnitTracks(saved.id, d.unitTracks).catch(() => {});
        }
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
      <ModalHash hash="replay-review" onClose={onClose} />
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
            <div className="scr-replay-review-filters">
              <label className="scr-checkbox-field">
                <input
                  type="checkbox"
                  checked={excludeComputer}
                  onChange={(e) => toggleExcludeComputer(e.target.checked)}
                />
                컴퓨터 낀 경기 제외
              </label>
              <label className="scr-checkbox-field">
                <input
                  type="checkbox"
                  checked={excludeNonMember}
                  onChange={(e) => toggleExcludeNonMember(e.target.checked)}
                />
                비회원 낀 경기 제외
              </label>
            </div>
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

                const v = reviewOf(d);
                const open = openIndex === i;
                return (
                  <div key={d.fileName + i} className={cx("scr-replay-mapping-row", d.excluded && "scr-replay-draft-body-excluded")}>
                    {/* 줄 하나 = 리플레이 하나. 파일명 색과 오른쪽 배지가 판정을 말하고,
                        누르면 그 아래로 게임정보와 손댈 거리가 펼쳐진다(요청). */}
                    {/* 한 줄이다(요청) — 파일명이 길면 말줄임이고, 판정 배지와 제외 버튼은
                        오른쪽에 못박혀 줄바꿈되지 않는다. 목록을 세로로 훑을 때 줄 높이가
                        들쭉날쭉하면 그것만으로 읽기가 더뎌진다.
                        제외는 줄 전체를 여닫는 클릭과 겹치면 안 되므로 버블링을 끊는다. */}
                    <div
                      className={cx("scr-replay-mapping-row-head", "scr-replay-review-head",
                        `scr-replay-review-${v.level}`, open && "scr-replay-review-head-open")}
                    >
                      <button
                        type="button" className="scr-replay-review-open"
                        onClick={() => setOpenIndex(open ? null : i)}
                        aria-expanded={open}
                      >
                        <span className="scr-replay-review-title">
                          <span className="scr-mono scr-replay-mapping-row-name">{d.fileName}</span>
                          {/* 맵은 리플레이명 곁에 작고 흐리게(요청: 윗줄에 리플레이명과 맵). */}
                          {d.mapName ? <span className="scr-replay-review-map">{d.mapName}</span> : null}
                        </span>
                        <span className="scr-replay-review-badge">{v.badge}</span>
                      </button>
                      {d.excludeReason !== "duplicate" && (
                        <button
                          type="button" className="scr-btn scr-btn-ghost scr-btn-sm scr-replay-review-skip-btn"
                          onClick={(e) => { e.stopPropagation(); toggleExcluded(i); }}
                          disabled={submittedIndices.has(i)}
                        >
                          {d.excluded ? "제외 취소" : "제외"}
                        </button>
                      )}
                    </div>

                    {open && (<>
                    {/* 손댈 거리와 알림은 맨 위다(요청: 검토필요·실패는 최상단에 상태 설명) —
                        펼친 사람이 가장 먼저 알아야 하는 것이 "무엇을 하라는 건가"다. */}
                    {v.issues.length > 0 && (
                      <ul className={cx("scr-replay-review-why", v.level === "error" && "scr-replay-review-why-error")}>
                        {v.issues.map((t) => <li key={t}>{t}</li>)}
                      </ul>
                    )}
                    {v.notes.map((t) => (
                      <div key={t} className="scr-hint scr-hint-left scr-hint-point">{t}</div>
                    ))}

                    {/* 언제 시작해 얼마나 걸린 무슨 경기였나(요청: 게임정보). */}
                    <div className="scr-replay-review-game">{gameLineOf(d)}</div>

                    {/* (삭제) 요약 문단 미리보기 — 검토창에서는 뺐다(요청). 이 창이 답할
                        물음은 "그냥 등록해도 되나" 하나이고, 열 몇 줄짜리 문단은 그 물음과
                        상관없이 줄을 통째로 밀어내 판정과 로스터를 화면 밖으로 보냈다.
                        요약이 말이 되는지는 등록 뒤 활동 카드에서 그대로 보인다. */}

                    {/* 리플레이가 승자를 못 가려낸 경기만 승패 버튼이 나온다 — 판별된 경기는
                        그 값을 그대로 쓰므로 굳이 고를 게 없다. 왜 골라야 하는지는 위
                        판정 설명이 이미 말했으므로 여기서는 버튼만 둔다. */}
                    {!d.result && !d.parseError && (
                      <div className="scr-replay-mapping-result">
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
                    </>)}
                  </div>
                );
              })}
            </div>
          )}

          {err && <div className="scr-err">{err}</div>}

        </div>
        {/* (삭제) "아직 손봐야 할 리플레이가 N건" 안내 — 등록 버튼이 이미 꺼져 있고 목록의
            노란 줄이 어느 것인지 말하고 있어, 같은 사실을 세 번째로 적는 자리였다(요청). */}
        <div className="scr-form-actions">
          <button type="button" className="scr-btn scr-btn-ghost" onClick={requestClose}>취소</button>
          <button
            type="button" className="scr-btn scr-btn-primary" onClick={submitAll}
            disabled={busy || blocked.length > 0}
          >
            {/* 활동 "게임결과 등록" 메뉴와 같은 업로드 아이콘으로 통일(요청). */}
            {busy ? <><Spinner /> 등록 중... ({submittedIndices.size}/{nonExcludedCount})</> : <><Upload size={14} /> 등록 ({pendingIndices.length})</>}
          </button>
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
