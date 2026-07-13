import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Monitor, UserPlus, UserCheck, UserX, ArrowLeftRight } from "lucide-react";
import Avatar from "../common/Avatar";
import { BASE_RACES } from "../../constants/races";
import Select from "../common/Select";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import { isComputerSlot, newComputerSlotId, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import type { Member, MatchSlot, Race } from "../../types";

// 경기 참가자의 종족은 "랜덤"을 고를 수 없다 — 실제 종족(테란/프로토스/저그)만 저장한다.
// 모바일에서는 좁은 칩 안에 넣어야 해서 종족명 첫 글자(테/프/저)만 보여준다.
const RACE_SELECT_OPTS = BASE_RACES.map((r) => ({ value: r, label: r, shortLabel: r[0] }));

// 리플레이에서 배틀태그로 못 찾은 선수. key는 rawName과 같지만, 팀 안에서 유일함을
// 명시적으로 표현하기 위해 별도 필드로 둔다.
export interface UnresolvedRow {
  key: string;
  rawName: string;
  race: Race | "";
}

interface MemberMultiSelectProps {
  // 칩(이미 선택된 멤버) 표시용 — 과거 기록에 포함된 회원은 상태가 바뀌어도 이름이 정상 표시되도록 전체 목록
  members: Member[];
  // 검색해서 새로 추가할 수 있는 후보 목록 (예: 활성 회원만). 생략하면 members 를 그대로 사용
  addableMembers?: Member[];
  rows: MatchSlot[];
  setRows: (rows: MatchSlot[]) => void;
  resolveDefaultRace: (memberId: string) => Race | "";
  // 리플레이 일괄 등록 전용 — 배틀태그로 못 찾은 선수를 별도 섹션이 아니라 이 로스터 안에
  // 빨간 테두리 칩으로 바로 보여주고, 칩에서 회원 검색 드롭다운(참가자 추가와 동일한 컴포넌트)을
  // 열어 누구인지 지정하게 한다. 지정하면 이 칩은 사라지고 정상 칩(rows)으로 넘어간다.
  unresolved?: UnresolvedRow[];
  unresolvedCandidates?: Member[];
  onResolve?: (key: string, member: Member) => void;
  onUnresolvedRaceChange?: (key: string, race: Race | "") => void;
  // 리플레이의 컴퓨터(AI) 참가자는 배틀태그가 없어 애초에 회원과 연결할 수 없다 —
  // 회원 연결 대신 컴퓨터 슬롯으로 바로 지정할 수 있게 한다.
  onMarkComputer?: (key: string) => void;
  // 아직 가입하지 않은 실제 사람으로 지정 — 회원 목록에서 못 찾았지만 컴퓨터도 아닐 때.
  onMarkUnregistered?: (key: string) => void;
  // 관전자로 의심되는 미매칭 선수를 로스터에서 통째로 빼버린다(회원/비회원/컴퓨터
  // 어디로도 확정하지 않고 그냥 없었던 사람 취급) — 진짜 관전자였을 때만 쓰는 길이라
  // suspectedNames에 있는 사람에게만 이 버튼을 보여준다.
  onRemoveUnresolved?: (key: string) => void;
  // 이 리플레이가 제외 처리됐을 때 — 추가/제거/종족변경/회원연결 등 모든 조작을 막는다.
  disabled?: boolean;
  // v2 리플레이 매핑 모달 전용 간소화 모드 — 이미 리플레이에서 파싱된 로스터를 매핑만
  // 하는 화면이라, 종족은 고정 표시(수정 불가, 한 글자만)로 바꾸고 참가자/컴퓨터 수동
  // 추가 버튼을 없앤다(매핑 대상이 아닌 새 참가자를 끼워 넣을 이유가 없음). 컴퓨터 칩도
  // "컴퓨터 1/2" 순번 대신 파싱된 종족명을 그대로 라벨로 쓴다. 기본(false)은 기존 그대로
  // (수동 경기 등록 등 다른 화면에서 계속 쓰임).
  mappingMode?: boolean;
  // 이미 저장된 경기 수정 전용 — 리플레이로 분석되어 들어온 팀 구성(인원수/종족/기록)은
  // 바꿀 수 없고, "이 슬롯이 누구인지"만 나중에 바로잡을 수 있어야 한다(오매칭 정정,
  // 비회원 가입 후 회원 연결 등). mappingMode처럼 종족은 고정 표시하고 추가/제거는
  // 없애되, mappingMode와 달리 이미 채워진 칩도(비어있지 않아도) 이름을 눌러 다른
  // 회원/컴퓨터/비회원으로 바꿀 수 있다.
  reassignable?: boolean;
  onReassignMember?: (memberId: string, newMember: Member) => void;
  onReassignComputer?: (memberId: string) => void;
  onReassignUnregistered?: (memberId: string) => void;
  // 리플레이 일괄 등록 전용 — 조작량이 적어 실제 플레이가 아닐 수 있다고 의심되는
  // 원본 이름(rawName) 집합. 확정이 아니라 추정이라 로스터에서 빼지 않고 그대로 두되,
  // 해당 칩에 노란 글로우를 줘서 사람이 눈으로 확인하고 필요하면 직접 빼게 한다.
  suspectedNames?: Set<string>;
  // 리플레이 일괄 등록 전용 — screp이 팀을 못 나눠(teamSplitUncertain) 전원이 이 팀에
  // 몰려있을 때만 켠다. 각 칩에 "다른 팀으로 이동" 버튼을 보여주고, 누르면 이 슬롯을
  // 통째로 반대 팀으로 옮긴다(mappingMode라도 이 버튼만은 예외로 활성화된다).
  onMoveToOtherTeam?: (row: MatchSlot) => void;
  // 위와 같은 이유로 미매칭(아직 회원 연결 안 된) 선수도 팀을 옮길 수 있어야 한다 —
  // 안 그러면 매칭 전에는 못 옮기고 매칭 후에야 옮길 수 있어 번거롭다.
  onMoveUnresolvedToOtherTeam?: (rawName: string) => void;
}

interface MemberSearchDropProps {
  dropRef: React.RefObject<HTMLDivElement | null>;
  candidates: Member[];
  highlight: number;
  onHighlight: (i: number) => void;
  onPick: (m: Member) => void;
  // 미매칭 칩처럼 전용 검색창 슬롯이 없는 곳에서는 검색 입력창을 목록과 한 팝오버에 함께 넣는다.
  header?: React.ReactNode;
}

// 회원 검색 드롭다운 목록 자체 — "참가자 추가" 슬롯과 미매칭 칩의 "회원 연결" 버튼 양쪽에서
// 그대로 재사용한다(위치 계산은 각자 하고, 목록 렌더링만 공유). 비회원은 여기서 수동으로
// 새로 만들지 않는다 — 리플레이에서 못 찾은 이름을 비회원으로 분류하는 것만 허용하고
// (UnresolvedChip의 별도 버튼), 임의로 빈 비회원 슬롯을 추가하는 길은 없앴다.
function MemberSearchDrop({ dropRef, candidates, highlight, onHighlight, onPick, header }: MemberSearchDropProps) {
  return createPortal(
    <div className="scr-select-drop scr-scroll" ref={dropRef}>
      {header}
      {candidates.map((m, i) => (
        <div
          key={m.id}
          className={cx("scr-select-opt", i === highlight && "scr-select-opt-active")}
          onMouseEnter={() => onHighlight(i)}
          onClick={() => onPick(m)}
        >
          <Avatar member={m} size={20} />
          <span>{m.nickname}</span>
        </div>
      ))}
      {candidates.length === 0 && <div className="scr-hint" style={{ padding: "8px 10px" }}>일치하는 회원이 없어요</div>}
    </div>,
    document.body,
  );
}

interface UnresolvedChipProps {
  entry: UnresolvedRow;
  candidates: Member[];
  onResolve: (member: Member) => void;
  onRaceChange: (race: Race | "") => void;
  onMarkComputer?: () => void;
  onMarkUnregistered?: () => void;
  onRemove?: () => void;
  onMoveToOtherTeam?: () => void;
  disabled?: boolean;
  mappingMode?: boolean;
  suspected?: boolean;
}

// 배틀태그로 못 찾은 선수 칩 — 빨간 테두리로 눈에 띄게 하고, 종족은 리플레이 파싱값을
// 그대로 보여주되(mappingMode가 아니면 수정 가능) 이름 자리를 누르면 "참가자 추가"와
// 동일한 회원 검색 드롭다운이 열려서 강제로 실제 회원을 지정하게 한다.
function UnresolvedChip({
  entry, candidates, onResolve, onRaceChange, onMarkComputer, onMarkUnregistered, onRemove, onMoveToOtherTeam,
  disabled = false, mappingMode = false, suspected = false,
}: UnresolvedChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 위치 계산/추적을 Floating UI에 맡긴다 — 스크롤/리사이즈에 따른 흔들림·지연·오작동을
  // 직접 다루려다 계속 문제가 재발해서, 이 문제를 이미 다듬어 놓은 라이브러리로 옮겼다.
  useEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growFromAnchor: true, maxWidth: 220 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.toLowerCase();
  const filtered = candidates.filter((m) => m.nickname.toLowerCase().includes(q) || m.battletag.toLowerCase().includes(q));

  const pick = (m: Member) => { onResolve(m); setOpen(false); setQuery(""); };
  const pickUnregistered = () => { onMarkUnregistered?.(); setOpen(false); setQuery(""); };

  // 예전엔 검색 입력창에 autoFocus를 줘서 버튼을 누르자마자 바로 타이핑할 수 있었는데,
  // 모바일에서는 그 즉시 가상 키보드가 튀어나와 방금 연 드롭다운 목록을 절반 넘게 가려버렸다
  // — 목록부터 보여주고, 검색은 사용자가 실제로 입력칸을 눌렀을 때만 열리게 한다(참가자
  // 추가 슬롯의 검색창과 같은 원칙).
  const toggleOpen = () => { setOpen((v) => !v); setQuery(""); setHighlight(0); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(filtered[Math.min(highlight, filtered.length - 1)]); }
  };

  const resolveButtons = (
    <div className="scr-chip-resolve-icon-group">
      <button
        type="button"
        className={cx("scr-chip-resolve-icon-btn", !disabled && "scr-chip-resolve-pulse")}
        onClick={toggleOpen}
        disabled={disabled}
        title="회원으로 연결"
        aria-label="회원으로 연결"
      >
        <UserCheck size={14} />
      </button>
      {onMarkUnregistered && (
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", !disabled && "scr-chip-resolve-pulse")}
          onClick={pickUnregistered}
          disabled={disabled}
          title="비회원으로 처리"
          aria-label="비회원으로 처리"
        >
          <UserX size={14} />
        </button>
      )}
      {onMarkComputer && (
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", !disabled && "scr-chip-resolve-pulse")}
          onClick={onMarkComputer}
          disabled={disabled}
          title="컴퓨터로 지정"
          aria-label="컴퓨터로 지정"
        >
          <Monitor size={14} />
        </button>
      )}
      {/* 관전자로 의심되는 사람만 — 회원/비회원/컴퓨터 어디로도 확정하지 않고 로스터에서
          통째로 빼는 길. 확실한 참가자는(의심 표시가 없으면) 반드시 셋 중 하나로 확정해야
          하므로 이 버튼을 안 보여준다. */}
      {suspected && onRemove && (
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", !disabled && "scr-chip-resolve-pulse")}
          onClick={onRemove}
          disabled={disabled}
          title="관전자로 보고 제거"
          aria-label="관전자로 보고 제거"
        >
          <X size={14} />
        </button>
      )}
      {/* screp이 팀을 못 나눠(teamSplitUncertain) 이 사람이 회원 연결 전인데도 반대
          팀으로 옮겨야 할 때만 나온다. */}
      {onMoveToOtherTeam && (
        <button
          type="button"
          className="scr-chip-resolve-icon-btn"
          onClick={onMoveToOtherTeam}
          disabled={disabled}
          title="다른 팀으로 이동"
          aria-label="다른 팀으로 이동"
        >
          <ArrowLeftRight size={14} />
        </button>
      )}
    </div>
  );

  // 리플레이 인게임 이름(rawName)이 이 사람이 누군지 알 수 있는 유일한 단서라 잘리면 안
  // 된다 — 매핑 모드에서는 옆 버튼들을 텍스트 대신 아이콘으로 줄여 자리를 내주고, 이름은
  // 잘리지 않고 필요하면 줄바꿈되게 한다.
  return (
    <div
      className={cx("scr-chip", "scr-chip-unresolved", mappingMode && "scr-chip-unresolved-mapping", suspected && "scr-chip-suspected")}
      ref={anchorRef}
      title={suspected ? "조작량이 적어 실제로 뛰지 않았을 수 있어요 — 관전자면 컴퓨터/비회원 대신 그냥 제거해 주세요." : undefined}
    >
      <Avatar member={undefined} size={26} />
      <span
        className={cx("scr-chip-name", mappingMode && "scr-mono scr-chip-name-mapping")}
        title="배틀태그로 회원을 찾지 못했어요 — 회원을 연결해 주세요."
      >
        {entry.rawName}
      </span>
      {mappingMode ? (
        entry.race && <span className="scr-chip-race-static">{entry.race[0]}</span>
      ) : (
        <Select
          className="scr-chip-race"
          size="sm"
          value={entry.race}
          placeholder="종족"
          options={RACE_SELECT_OPTS}
          onChange={(v) => onRaceChange(v as Race | "")}
          minDropWidth={100}
          disabled={disabled}
        />
      )}
      {resolveButtons}

      {open && (
        <MemberSearchDrop
          dropRef={dropRef}
          candidates={filtered}
          highlight={highlight}
          onHighlight={setHighlight}
          onPick={pick}
          header={
            <input
              className="scr-slot-search-input scr-chip-resolve-input"
              placeholder="회원 검색"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKeyDown}
            />
          }
        />
      )}
    </div>
  );
}

// 이미 리플레이 분석/배틀태그로 매핑이 끝난 칩 — 회원/비회원/컴퓨터 세 아이콘을 항상 함께
// 보여주되(ReassignableChip과 같은 자리) 지금 분류만 활성 색으로 표시하는 순수 상태
// 표시용이다. 여기서는 아무것도 클릭할 수 없다 — 수정은 아직 못 찾은(UnresolvedChip) 칩만
// 가능하고, 이미 매핑된 칩은 데이터를 손댈 방법이 없어야 한다.
function MappedTypeIcons({ isComputer, isUnregistered }: { isComputer: boolean; isUnregistered: boolean }) {
  return (
    <div className="scr-chip-resolve-icon-group">
      <button
        type="button"
        className={cx("scr-chip-resolve-icon-btn", !isComputer && !isUnregistered && "scr-chip-resolve-icon-btn-active")}
        disabled
        title="회원"
        aria-label="회원"
      >
        <UserCheck size={14} />
      </button>
      <button
        type="button"
        className={cx("scr-chip-resolve-icon-btn", isUnregistered && "scr-chip-resolve-icon-btn-active")}
        disabled
        title="비회원"
        aria-label="비회원"
      >
        <UserX size={14} />
      </button>
      <button
        type="button"
        className={cx("scr-chip-resolve-icon-btn", isComputer && "scr-chip-resolve-icon-btn-active")}
        disabled
        title="컴퓨터"
        aria-label="컴퓨터"
      >
        <Monitor size={14} />
      </button>
    </div>
  );
}

interface ReassignableChipProps {
  row: MatchSlot;
  name: string;
  member: Member | undefined;
  isComputer: boolean;
  isUnregistered: boolean;
  candidates: Member[];
  onReassignMember: (member: Member) => void;
  onReassignComputer: () => void;
  onReassignUnregistered: () => void;
  disabled?: boolean;
}

// 이미 저장된 경기 수정용 칩 — UnresolvedChip과 비슷하지만, "아직 못 찾은" 게 아니라
// "이미 채워졌지만 잘못됐을 수 있는" 슬롯이다. 회원/비회원/컴퓨터 아이콘 세 개를 항상
// 나란히 보여주고, 지금 이 슬롯이 어느 종류인지를 그중 하나를 활성 상태로 표시해서
// 알려준다(라디오처럼) — 비회원/컴퓨터는 눌러 바로 그 종류로 바뀌고, 회원은 눌러
// 검색 드롭다운을 열어 특정 회원을 고른다(이미 회원이어도 다른 회원으로 다시 고를 수
// 있게 항상 눌린다).
function ReassignableChip({
  row, name, member, isComputer, isUnregistered, candidates,
  onReassignMember, onReassignComputer, onReassignUnregistered, disabled = false,
}: ReassignableChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growFromAnchor: true, maxWidth: 220 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.toLowerCase();
  const filtered = candidates.filter((m) => m.nickname.toLowerCase().includes(q) || m.battletag.toLowerCase().includes(q));

  const pick = (m: Member) => { onReassignMember(m); setOpen(false); setQuery(""); };
  // UnresolvedChip과 같은 이유로 검색 입력창에 autoFocus를 안 준다 — 모바일에서 즉시
  // 키보드가 뜨는 걸 막는다.
  const toggleOpen = () => { if (disabled) return; setOpen((v) => !v); setQuery(""); setHighlight(0); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(filtered[Math.min(highlight, filtered.length - 1)]); }
  };

  return (
    <div className={cx("scr-chip", isComputer && "scr-chip-computer", isUnregistered && "scr-chip-unregistered")} ref={anchorRef}>
      {isComputer
        ? <Avatar icon={<Monitor size={16} className="scr-chip-computer-icon" />} size={26} />
        : isUnregistered
          ? <Avatar icon={<UserPlus size={16} className="scr-chip-computer-icon" />} size={26} />
          : <Avatar member={member} size={26} />}
      <span className="scr-chip-name">{name}</span>
      {!isComputer && row.race && <span className="scr-chip-race-static">{row.race[0]}</span>}
      <div className="scr-chip-resolve-icon-group">
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", !isComputer && !isUnregistered && "scr-chip-resolve-icon-btn-active")}
          onClick={toggleOpen} disabled={disabled}
          title="회원으로 연결" aria-label="회원으로 연결"
        >
          <UserCheck size={14} />
        </button>
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", isUnregistered && "scr-chip-resolve-icon-btn-active")}
          onClick={() => { if (!isUnregistered) onReassignUnregistered(); setOpen(false); }}
          disabled={disabled || isUnregistered}
          title="비회원으로 변경" aria-label="비회원으로 변경"
        >
          <UserX size={14} />
        </button>
        <button
          type="button"
          className={cx("scr-chip-resolve-icon-btn", isComputer && "scr-chip-resolve-icon-btn-active")}
          onClick={() => { if (!isComputer) onReassignComputer(); setOpen(false); }}
          disabled={disabled || isComputer}
          title="컴퓨터로 변경" aria-label="컴퓨터로 변경"
        >
          <Monitor size={14} />
        </button>
      </div>

      {open && (
        <MemberSearchDrop
          dropRef={dropRef}
          candidates={filtered}
          highlight={highlight}
          onHighlight={setHighlight}
          onPick={pick}
          header={
            <input
              className="scr-slot-search-input scr-chip-resolve-input"
              placeholder="회원 검색"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKeyDown}
            />
          }
        />
      )}
    </div>
  );
}

/*
  팀 멤버 다중 선택
  - 기본 4칸의 빈 슬롯을 보여주고, 채워진 인원 다음 칸의 +를 누르면 그 자리가 검색창으로 바뀐다
  - 4명을 넘어가면 슬롯이 하나씩 더 늘어난다
*/
export default function MemberMultiSelect({
  members, addableMembers, rows, setRows, resolveDefaultRace,
  unresolved, unresolvedCandidates, onResolve, onUnresolvedRaceChange, onMarkComputer, onMarkUnregistered,
  onRemoveUnresolved,
  disabled = false, mappingMode = false,
  reassignable = false, onReassignMember, onReassignComputer, onReassignUnregistered,
  suspectedNames, onMoveToOtherTeam, onMoveUnresolvedToOtherTeam,
}: MemberMultiSelectProps) {
  const [adding, setAdding] = useState(false);
  // "+"를 누르면 검색창과 후보 드롭다운을 곧바로 함께 연다 — 입력칸에는 autoFocus를 주지
  // 않으므로 모바일에서 가상 키보드가 뜨지 않는다(실제로 입력칸을 눌러야만 포커스되고
  // 키보드가 뜬다). 목록부터 먼저 보여주고 타이핑은 원하면 그다음에 하라는 뜻.
  const [searchOpened, setSearchOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 위치 계산/추적을 Floating UI에 맡긴다 — 스크롤/리사이즈에 따른 흔들림·지연·오작동을
  // 직접 다루려다 계속 문제가 재발해서, 이미 다듬어 놓은 라이브러리로 옮겼다. 드롭다운이
  // 실제로 렌더된(searchOpened) 뒤에만 붙인다 — 그 전엔 dropRef가 아직 비어 있다.
  useEffect(() => {
    if (!adding || !searchOpened || !searchRef.current || !dropRef.current) return;
    return attachPopover(searchRef.current, dropRef.current, { matchAnchor: true });
  }, [adding, searchOpened]);

  useEffect(() => {
    if (!adding) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (searchRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setAdding(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [adding]);

  const chosenIds = rows.map((r) => r.memberId);
  const q = query.toLowerCase();
  const filtered = (addableMembers ?? members).filter((m) =>
    !chosenIds.includes(m.id) &&
    (m.nickname.toLowerCase().includes(q) ||
      m.battletag.toLowerCase().includes(q)),
  );

  const startAdding = () => { setAdding(true); setSearchOpened(true); setQuery(""); setHighlight(0); };

  // 한 명 고르면 바로 검색창을 닫는다 — 여러 명을 이어서 추가하려면 "+"를 다시 눌러야
  // 한다(예전엔 데스크톱에서만 검색창을 열어둔 채 이어서 고를 수 있었는데, 한 명 고를
  // 때마다 드롭다운이 바로 다시 뜨는 게 오히려 의도치 않게 계속 열리는 것처럼 보여서 없앴다).
  const addMember = (id: string) => {
    if (chosenIds.includes(id)) return;
    setRows([...rows, {
      memberId: id, race: resolveDefaultRace(id),
      apm: null, eapm: null, cmdCount: null, effectiveCmdCount: null,
    }]);
    setAdding(false);
  };

  // 검색 중 방향키로 후보를 이동, 엔터로 포커싱된 후보를 선택, ESC로 닫기
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setAdding(false);
      return;
    }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addMember(filtered[Math.min(highlight, filtered.length - 1)].id);
    }
  };
  const removeMember = (id: string) => setRows(rows.filter((r) => r.memberId !== id));
  const setRace = (id: string, race: Race | "") =>
    setRows(rows.map((r) => (r.memberId === id ? { ...r, race } : r)));

  // 컴퓨터는 실제 회원이 아니라 memberId도 없어 검색 없이 바로 슬롯을 채운다 — 여러 명
  // 추가할 수 있고, 슬롯마다 고유한 아이디를 새로 만들어 구분/제거가 가능하게 한다.
  const addComputerSlot = () => {
    setRows([...rows, {
      memberId: newComputerSlotId(), race: "",
      apm: null, eapm: null, cmdCount: null, effectiveCmdCount: null,
    }]);
  };

  const memberOf = (id: string): Member | undefined => members.find((m) => m.id === id);

  // 재매핑(reassignable) 검색 후보 — 이미 이 팀에 있는 다른 슬롯의 회원은 제외한다(상대
  // 팀 제외는 addableMembers가 이미 해줌). 자기 자신(지금 이 슬롯이 가리키는 회원)은
  // 제외 목록에서 뺀다 — 재선택 자체는 막을 이유가 없다.
  const usedInTeam = new Set(rows.map((r) => r.memberId));

  return (
    <div className="scr-team-col">
      <div className="scr-team-slots">
        {rows.map((row) => {
          const isComputer = isComputerSlot(row.memberId);
          const isUnregistered = isUnregisteredSlot(row.memberId);
          const m = isComputer || isUnregistered ? undefined : memberOf(row.memberId);
          // 매핑 모드에서는 컴퓨터 칩의 순번("컴퓨터 1/2") 대신 파싱된 종족명을 그대로
          // 라벨로 쓴다 — 여러 컴퓨터를 구분할 필요보다 어떤 종족인지가 더 유용한 정보다.
          //
          // 리플레이로 들어온 슬롯은 원본 인게임 아이디(rawName)를 갖고 있다 — 그게 이 사람이
          // 누군지 알 수 있는 유일한 단서라, "비회원"/"컴퓨터 1" 같은 순번 라벨보다 먼저 쓴다
          // (실제로 지적받은 문제: 검토 화면에서 전부 "비회원"으로만 보여 누가 누군지 알 수 없었다).
          // 수기등록 슬롯은 rawName이 없으니 예전처럼 순번 라벨로 대체된다. 경기결과 카드
          // (MatchTeams)가 이미 같은 규칙으로 그린다.
          const name = isComputer
            ? (mappingMode || reassignable ? (row.race || "컴퓨터") : (row.rawName || computerSlotLabel(rows, row.memberId)))
            : isUnregistered
              ? (row.rawName || unregisteredSlotLabel(rows, row.memberId))
              : (m?.nickname ?? row.memberId);

          if (reassignable) {
            const reassignCandidates = (addableMembers ?? members).filter(
              (cand) => !usedInTeam.has(cand.id) || cand.id === row.memberId,
            );
            return (
              <ReassignableChip
                key={row.memberId}
                row={row}
                name={name}
                member={m}
                isComputer={isComputer}
                isUnregistered={isUnregistered}
                candidates={reassignCandidates}
                onReassignMember={(newMember) => onReassignMember?.(row.memberId, newMember)}
                onReassignComputer={() => onReassignComputer?.(row.memberId)}
                onReassignUnregistered={() => onReassignUnregistered?.(row.memberId)}
                disabled={disabled}
              />
            );
          }

          const suspected = !!row.rawName && suspectedNames?.has(row.rawName);
          return (
            <div
              key={row.memberId}
              className={cx(
                "scr-chip",
                isComputer && "scr-chip-computer",
                isUnregistered && "scr-chip-unregistered",
                (!isComputer && (!row.race || row.race === "랜덤")) && "scr-chip-warn",
                suspected && "scr-chip-suspected",
              )}
              title={suspected ? "조작량이 적어 실제로 뛰지 않았을 수 있어요 — 관전자면 제거해 주세요." : undefined}
            >
              {isComputer
                ? <Avatar icon={<Monitor size={16} className="scr-chip-computer-icon" />} size={26} />
                : isUnregistered
                  ? <Avatar icon={<UserPlus size={16} className="scr-chip-computer-icon" />} size={26} />
                  : <Avatar member={m} size={26} />}
              <span className="scr-chip-name">{name}</span>
              {/* 컴퓨터는 종족이 중요치 않아 고를 필요가 없다 — 리플레이로 등록된 컴퓨터는
                  파싱된 종족값이 이미 채워져 있고(자동), 수동으로 추가한 컴퓨터는 애초에
                  종족 없이 저장한다. 비회원은 실제 사람이라 종족을 그대로 고른다. */}
              {!isComputer && (
                mappingMode ? (
                  row.race && <span className="scr-chip-race-static">{row.race[0]}</span>
                ) : (
                  <Select
                    className="scr-chip-race"
                    size="sm"
                    value={row.race}
                    placeholder="종족"
                    options={RACE_SELECT_OPTS}
                    onChange={(v) => setRace(row.memberId, v as Race | "")}
                    minDropWidth={100}
                    disabled={disabled}
                  />
                )
              )}
              {/* 매핑 모드에서는 분석해서 들어온 데이터(이미 매칭된 팀 구성)는 바꿀 수 없다 —
                  대신 제거 버튼 자리에 지금 분류(회원/비회원/컴퓨터)를 보여주는 상태 아이콘을
                  둬서 ReassignableChip과 같은 자리·간격으로 통일한다(클릭은 안 됨). 다만
                  관전자로 의심되는 사람만은 예외로 제거를 허용한다 — 안 그러면 진짜
                  관전자였을 때 로스터에서 뺄 방법이 없다. */}
              {mappingMode && !suspected ? (
                <MappedTypeIcons isComputer={isComputer} isUnregistered={isUnregistered} />
              ) : (
                <button
                  type="button" className="scr-chip-x" onClick={() => removeMember(row.memberId)}
                  aria-label="관전자로 보고 제거" title={mappingMode ? "관전자로 보고 제거" : "제거"} disabled={disabled}>
                  <X size={12} />
                </button>
              )}
              {/* screp이 팀을 못 나눠(teamSplitUncertain) 전원이 한 팀에 몰려있을 때만
                  켜진다 — mappingMode로 잠긴 칩이어도 이 버튼만은 예외로 눌린다. */}
              {onMoveToOtherTeam && (
                <button
                  type="button" className="scr-chip-x" onClick={() => onMoveToOtherTeam(row)}
                  aria-label="다른 팀으로 이동" title="다른 팀으로 이동" disabled={disabled}
                >
                  <ArrowLeftRight size={12} />
                </button>
              )}
            </div>
          );
        })}

        {unresolved?.map((entry) => (
          <UnresolvedChip
            key={entry.key}
            entry={entry}
            candidates={unresolvedCandidates ?? []}
            onResolve={(m) => onResolve?.(entry.key, m)}
            onRaceChange={(race) => onUnresolvedRaceChange?.(entry.key, race)}
            onMarkComputer={onMarkComputer ? () => onMarkComputer(entry.key) : undefined}
            onMarkUnregistered={onMarkUnregistered ? () => onMarkUnregistered(entry.key) : undefined}
            onRemove={onRemoveUnresolved ? () => onRemoveUnresolved(entry.key) : undefined}
            onMoveToOtherTeam={onMoveUnresolvedToOtherTeam ? () => onMoveUnresolvedToOtherTeam(entry.key) : undefined}
            disabled={disabled}
            mappingMode={mappingMode}
            suspected={suspectedNames?.has(entry.rawName)}
          />
        ))}

        {/* 매핑 모드에서는 참가자/컴퓨터 수동 추가 버튼을 아예 없앤다 — 이 화면은 리플레이가
            이미 감지한 로스터를 매핑만 하는 곳이라 새 참가자를 끼워 넣을 이유가 없다. */}
        {mappingMode ? null : adding ? (
          <div className="scr-team-slot scr-team-slot-search" ref={searchRef}>
            <input
              className="scr-slot-search-input"
              placeholder="유저 검색"
              value={query}
              onFocus={() => setSearchOpened(true)}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onSearchKeyDown}
            />
            {searchOpened && (
              <MemberSearchDrop
                dropRef={dropRef}
                candidates={filtered}
                highlight={highlight}
                onHighlight={setHighlight}
                onPick={(m) => addMember(m.id)}
              />
            )}
          </div>
        ) : (
          <div className="scr-team-slot-add-row">
            <button type="button" className="scr-team-slot scr-team-slot-add" onClick={startAdding} aria-label="참가자 추가" disabled={disabled}>
              <Plus size={16} />
            </button>
            <button
              type="button"
              className="scr-team-slot scr-team-slot-add-computer"
              onClick={addComputerSlot}
              aria-label="컴퓨터 추가"
              title="컴퓨터 추가"
              disabled={disabled}
            >
              <Monitor size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
