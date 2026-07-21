import { todayStr } from "./date";
import { parseReplayFile, ReplayParseError } from "./replayParser";
import { buildReplayFileName } from "./replayFileName";
import { matchReplayPlayerToMember } from "./replayMemberMatch";
import { api } from "../api/client";
import { isComputerSlot, newComputerSlotId } from "../constants/computerSlot";
import { newUnregisteredSlotId } from "../constants/unregisteredSlot";
import type { ReplayUpload, MatchResult, MatchSlot, MatchType, Race, Member } from "../types";

export interface UnmatchedPlayer {
  rawName: string;
  race: Race | "";
  apm: number | null;
  eapm: number | null;
  cmdCount: number | null;
  effectiveCmdCount: number | null;
  buildCount: number | null;
}

export interface ReplayDraft {
  fileName: string;
  mapName: string;
  date: string;
  gameStartedAt: string | null;
  durationSeconds: number | null;
  team1: MatchSlot[];
  team2: MatchSlot[];
  unmatchedTeam1: UnmatchedPlayer[];
  unmatchedTeam2: UnmatchedPlayer[];
  // 리플레이엔 승자가 직접 저장되지 않는다 — screp이 "마지막까지 남은 가장 큰 팀"으로
  // 추정할 뿐이고, 그마저 실패하면(winnerSide가 null) 여기는 빈 문자열로 남는다. 그때
  // 임의로 team1을 골라두면 사용자가 확인 없이 그대로 등록해 조용히 틀린 기록이 남는다
  // (실제로 지적받은 문제) — 아무것도 선택되지 않은 상태로 두고 직접 고르게 한다.
  result: MatchResult | "";
  matchType: MatchType;
  note: string;
  replay: ReplayUpload | null;
  winnerSide: "team1" | "team2" | null;
  // 조작량이 현저히 적다는 이유로 관전자로 "추정해" 뺀 사람들 — 초반에 나간 실제 참가자를
  // 잘못 지웠을 수 있어, 비어있지 않으면 배치 자동 등록에 맡기지 않고 사람이 확인해야 한다.
  guessedObservers: string[];
  // screp이 이 리플레이의 팀을 두 편으로 못 나눠서(일부 UMS 맵의 알려진 한계) team1에
  // 전원이 몰리고 team2가 비어있는 상태 — 자동 등록에 맡기지 않고 사람이 직접 편을 갈라야 한다.
  teamSplitUncertain: boolean;
  parseError: string | null;
  // 자동(중복/컴퓨터) 또는 수동으로 이 리플레이를 전체 등록 대상에서 뺀 상태 — 배열에서
  // 지우지 않고 계속 화면에 보여주면서 토글만 한다(전체 등록 시에만 건너뛴다).
  excluded: boolean;
  // "제외" 버튼 옆에 왜 제외됐는지 짧게 보여줄 안내 — 자동 제외일 때만 값이 있다.
  // "duplicate"는 되돌릴 수 없고(같은 경기가 두 번 저장된다), "computer"는 체크박스로 되돌린다.
  excludeReason: "duplicate" | "computer" | null;
  // 중복건은 그냥 제외하지 않고 리플레이 내부 정보(지표/맵/시간/승패)를 기존 경기에 조용히
  // 머지한다(요청) — 성공하면 true라, 검토 화면이 "제외"가 아니라 "기존 경기에 업데이트됨"으로
  // 보여준다. 머지 호출이 실패하면 false로 남아 예전처럼 중복(건너뜀)으로 표시된다.
  merged?: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function buildDraft(file: File, members: Member[]): Promise<ReplayDraft> {
  // 원본 파일명(originalName)은 그대로 보존하고, 화면 표시/다운로드에 쓰는 알아보기 쉬운
  // 이름(displayName)은 파싱 성공 시 생성한다(요청) — 실패하면 원본 파일명을 그대로 쓴다.
  const replay: ReplayUpload = {
    originalName: file.name,
    displayName: file.name,
    url: await readFileAsDataUrl(file),
  };

  try {
    const parsed = await parseReplayFile(file);
    replay.displayName = buildReplayFileName(parsed);
    const usedIds = new Set<string>();
    const assign = (players: typeof parsed.team1): { rows: MatchSlot[]; unmatched: UnmatchedPlayer[] } => {
      const rows: MatchSlot[] = [];
      const unmatched: UnmatchedPlayer[] = [];
      players.forEach((p) => {
        // 리플레이 슬롯 자체가 "Computer"(AI)면 배틀태그가 있을 리 없으니 회원 매칭을
        // 시도하지 않고(미매칭으로도 안 두고) 바로 컴퓨터 슬롯으로 채운다.
        if (p.isComputer) {
          rows.push({
            memberId: newComputerSlotId(), race: p.race, rawName: p.rawName,
            apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
          });
          return;
        }
        const member = matchReplayPlayerToMember(p.rawName, members);
        if (member && !usedIds.has(member.id)) {
          usedIds.add(member.id);
          rows.push({
            // 회원으로 매칭돼도 리플레이 원본 게임 아이디(rawName)는 그대로 들고 간다 —
            // member.battletag는 나중에 바뀔 수 있어 이 값이 이 경기 시점의 유일한 증거다.
            memberId: member.id, race: p.race, rawName: p.rawName,
            apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
          });
        } else {
          unmatched.push({
            rawName: p.rawName, race: p.race,
            apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
          });
        }
      });
      // 사람이 먼저, 컴퓨터가 나중에 오도록 정렬한다 (리플레이 안에서의 등장 순서는 무작위라
      // 사람과 컴퓨터가 뒤섞여 있을 수 있다). 같은 그룹 안에서는 등장 순서를 그대로 유지한다.
      rows.sort((a, b) => Number(isComputerSlot(a.memberId)) - Number(isComputerSlot(b.memberId)));
      return { rows, unmatched };
    };
    const t1 = assign(parsed.team1);
    const t2 = assign(parsed.team2);

    return {
      fileName: file.name,
      mapName: parsed.mapName,
      date: parsed.date,
      gameStartedAt: parsed.gameStartedAt,
      durationSeconds: parsed.durationSeconds,
      team1: t1.rows,
      team2: t2.rows,
      unmatchedTeam1: t1.unmatched,
      unmatchedTeam2: t2.unmatched,
      // 승자를 못 가려냈으면 아무것도 고르지 않은 채로 둔다(사용자가 반드시 직접 선택).
      result: parsed.winnerSide ?? "",
      matchType: parsed.matchType,
      note: "",
      replay,
      winnerSide: parsed.winnerSide,
      guessedObservers: parsed.guessedObservers,
      teamSplitUncertain: parsed.teamSplitUncertain,
      parseError: null,
      excluded: false,
      excludeReason: null,
    };
  } catch (e) {
    return {
      fileName: file.name,
      mapName: "",
      // 리플레이 파싱에 실패해 날짜를 못 뽑아냈을 때의 기본값 — 실제 오늘.
      date: todayStr(),
      gameStartedAt: null,
      durationSeconds: null,
      team1: [],
      team2: [],
      unmatchedTeam1: [],
      unmatchedTeam2: [],
      result: "",
      matchType: "0101",
      note: "",
      replay,
      winnerSide: null,
      guessedObservers: [],
      teamSplitUncertain: false,
      parseError: e instanceof ReplayParseError ? e.message : "리플레이를 분석하지 못했어요. 직접 입력해 주세요.",
      excluded: false,
      excludeReason: null,
    };
  }
}

// 배틀태그로 못 찾아 매칭 안 된 채로 남은 선수를 "비회원"(모름)로 그냥 채워 넣는다 —
// 예전엔 등록 시점에 반드시 회원을 연결하게 막았는데, 매번 리플레이 등록이 막혀 번거롭다는
// 피드백으로 바꿨다. 중복 경기가 아닌 한 등록 자체는 항상 되고, 나중에 유저 매핑 관리
// 화면에서 실제 회원으로 다시 연결할 수 있다.
export function resolveUnmatchedAsUnregistered(d: ReplayDraft): ReplayDraft {
  if (d.unmatchedTeam1.length === 0 && d.unmatchedTeam2.length === 0) return d;
  const toSlot = (p: UnmatchedPlayer): MatchSlot => ({
    memberId: newUnregisteredSlotId(), rawName: p.rawName,
    race: p.race, apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
  });
  return {
    ...d,
    team1: [...d.team1, ...d.unmatchedTeam1.map(toSlot)],
    team2: [...d.team2, ...d.unmatchedTeam2.map(toSlot)],
    unmatchedTeam1: [],
    unmatchedTeam2: [],
  };
}

// 컴퓨터(AI)가 한 자리라도 낀 경기인지 — 클럽 전적으로 치기 애매해서 통째로 빼고 싶을 때가
// 있다(리플레이 검토 화면의 "컴퓨터 낀 경기 제외" 체크박스).
export function hasComputerSlot(d: ReplayDraft): boolean {
  return [...d.team1, ...d.team2].some((s) => isComputerSlot(s.memberId));
}

export function validateReplayDraft(d: ReplayDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "날짜를 올바르게 입력해 주세요.";
  // 리플레이가 승자를 못 가려낸 경기 — 아무거나 넣으면 조용히 틀린 기록이 남는다.
  if (!d.result) return "승패를 선택해 주세요.";
  if (d.team1.length === 0 || d.team2.length === 0) return "양 팀에 최소 1명 이상의 멤버를 선택해 주세요.";
  // 컴퓨터는 종족이 중요치 않아 선택을 요구하지 않는다.
  if ([...d.team1, ...d.team2].some((r) => !isComputerSlot(r.memberId) && !r.race)) {
    return "모든 멤버의 종족을 선택해 주세요.";
  }
  return null;
}

// 배틀태그로 못 찾은 이름 중 예전에 컴퓨터/비회원으로 지정해둔 적이 있는 이름은(서버가
// 기억해뒀다가) 자동으로 그 슬롯으로 바로 채운다 — 미매칭으로 남겨 매번 다시 물어보지
// 않는다. 회원 매칭(matchReplayPlayerToMember)과 달리 이건 서버 왕복이 필요해 buildDraft와
// 분리하고, 여러 리플레이의 이름을 한 번에 모아 한 번만 조회한다.
async function applyKnownClassifications(drafts: ReplayDraft[]): Promise<ReplayDraft[]> {
  const rawNames = new Set<string>();
  drafts.forEach((d) => {
    d.unmatchedTeam1.forEach((p) => rawNames.add(p.rawName));
    d.unmatchedTeam2.forEach((p) => rawNames.add(p.rawName));
  });
  if (rawNames.size === 0) return drafts;

  // 이 조회는 순전히 편의 기능(전에 지정해둔 걸 또 물어보지 않기)이라, 실패해도 리플레이
  // 등록 자체를 막을 이유가 없다 — 그냥 지금까지처럼 전부 미매칭으로 남겨두고 계속 진행한다.
  const entries = await api.lookupReplayNameClassifications([...rawNames]).catch(() => []);
  if (entries.length === 0) return drafts;
  const kindByName = new Map(entries.map((e) => [e.rawName, e.kind]));

  const reclassify = (side: UnmatchedPlayer[]): { rows: MatchSlot[]; unmatched: UnmatchedPlayer[] } => {
    const rows: MatchSlot[] = [];
    const unmatched: UnmatchedPlayer[] = [];
    side.forEach((p) => {
      const kind = kindByName.get(p.rawName);
      if (!kind) { unmatched.push(p); return; }
      rows.push({
        memberId: kind === "computer" ? newComputerSlotId() : newUnregisteredSlotId(), rawName: p.rawName,
        race: p.race, apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount, effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
      });
    });
    return { rows, unmatched };
  };

  return drafts.map((d) => {
    const t1 = reclassify(d.unmatchedTeam1);
    const t2 = reclassify(d.unmatchedTeam2);
    if (t1.rows.length === 0 && t2.rows.length === 0) return d;
    // 사람이 먼저, 컴퓨터가 나중에 오도록 다시 정렬한다 — buildDraft의 assign()과 같은 기준.
    const bySlotKind = (a: MatchSlot, b: MatchSlot) => Number(isComputerSlot(a.memberId)) - Number(isComputerSlot(b.memberId));
    return {
      ...d,
      team1: [...d.team1, ...t1.rows].sort(bySlotKind),
      team2: [...d.team2, ...t2.rows].sort(bySlotKind),
      unmatchedTeam1: t1.unmatched,
      unmatchedTeam2: t2.unmatched,
    };
  });
}

// 리플레이 파일들을 분석해 검토용 드래프트로 만든다(업로드 -> 파싱 -> 알려진 이름 자동
// 분류 -> 중복 확인까지 한 번에). 모달을 열기 전에 호출해서, 분석 중에는 모달 없이 화면에
// 스피너만 보여주고 다 끝난 뒤에야 결과를 들고 모달을 띄운다.
export async function buildReplayDrafts(files: File[], members: Member[]): Promise<ReplayDraft[]> {
  const built = await Promise.all(files.map((f) => buildDraft(f, members)));
  const classified = await applyKnownClassifications(built);

  // 이미 등록된 경기(같은 게임 시작 시각)는 문자열 표기 차이(초/타임존 등)에도 안전하게
  // 서버가 UTC로 정규화해서 판단해준다.
  const candidates = classified.map((d) => d.gameStartedAt).filter((v): v is string => v !== null);
  const existing = new Set(candidates.length > 0 ? await api.checkReplayDuplicates(candidates) : []);
  // 중복건은 제외만 하지 않고 리플레이 내부 정보를 기존 경기에 조용히 머지한다(요청 — 오늘
  // 생산 지표처럼 새 컬럼이 추가되면 재등록으로 백필). 성공하면 merged=true로 "업데이트됨"
  // 표시, 실패하면 예전처럼 중복(건너뜀).
  return Promise.all(classified.map(async (d) => {
    if (!(d.gameStartedAt && existing.has(d.gameStartedAt))) return d;
    try {
      const res = await api.mergeReplay(draftToMergePayload(d, d.gameStartedAt));
      return { ...d, excluded: true, excludeReason: "duplicate" as const, merged: res.merged };
    } catch {
      return { ...d, excluded: true, excludeReason: "duplicate" as const, merged: false };
    }
  }));
}

// 중복 경기 머지 payload — 파싱된 전원(팀1/팀2 매칭 + 미매칭)을 player_name(리플레이 원본
// 게임 아이디)으로 보낸다. 지표만 갱신하므로 회원 매칭 여부와 무관하게 전원이 필요하다.
// 승패(result)는 screp이 확실히 가린 경우(winnerSide)만, 못 가리면 null로 보내 기존 승패를
// 유지시킨다(요청: "확실할 때만 덮어쓰기").
function draftToMergePayload(d: ReplayDraft, gameStartedAt: string) {
  // race가 ""(파싱 실패)면 서버 Race 리터럴에 없어 검증에서 막힌다 — null로 보내 승패처럼
  // "값이 있을 때만" 갱신되게 한다(기존 종족 보존).
  const fromSlots = [...d.team1, ...d.team2].map((s) => ({
    playerName: s.rawName ?? "",
    race: s.race || null, apm: s.apm, eapm: s.eapm, cmdCount: s.cmdCount,
    effectiveCmdCount: s.effectiveCmdCount, buildCount: s.buildCount,
  }));
  const fromUnmatched = [...d.unmatchedTeam1, ...d.unmatchedTeam2].map((p) => ({
    playerName: p.rawName,
    race: p.race || null, apm: p.apm, eapm: p.eapm, cmdCount: p.cmdCount,
    effectiveCmdCount: p.effectiveCmdCount, buildCount: p.buildCount,
  }));
  return {
    gameStartedAt,
    result: d.winnerSide,
    mapName: d.mapName || null,
    durationSeconds: d.durationSeconds,
    players: [...fromSlots, ...fromUnmatched].filter((p) => p.playerName),
  };
}
