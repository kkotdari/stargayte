import { useRef, useState, useEffect, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { X, Paperclip, Download, Trash2 } from "lucide-react";
import DateField from "../components/calendar/DateField";
import MemberMultiSelect from "../components/select/MemberMultiSelect";
import { Spinner } from "../components/common/Feedback";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { cx } from "../utils/format";
import { todayStr } from "../utils/date";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import { isAdminRole } from "../constants/roles";
import { isComputerSlot, computerSlotLabel } from "../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../constants/unregisteredSlot";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { useDefaultRaceResolver } from "../hooks/useDefaultRaceResolver";
import type {
  Match, MatchAttachment, MatchResult, MatchSlot, MatchType, Member, NewMatch,
} from "../types";

// 확정된 경기(isLocked)의 팀 구성은 더 손댈 수 없는 데이터라, 편집 가능한
// MemberMultiSelect 대신 다른 잠긴 필드(날짜/게임유형/결과)와 같은 원칙의 단순한
// 읽기전용 그리드로 보여준다 — 아바타/칩 장식 없이 이름+종족만 데이터폰트로.
function ReadonlyTeamRoster({ rows, members }: { rows: MatchSlot[]; members: Member[] }) {
  const memberOf = (id: string) => members.find((m) => m.id === id);
  return (
    <div className="scr-readonly-team-roster">
      {rows.map((row) => {
        const isComputer = isComputerSlot(row.memberId);
        const isUnregistered = isUnregisteredSlot(row.memberId);
        const m = isComputer || isUnregistered ? undefined : memberOf(row.memberId);
        const name = isComputer
          ? (row.race || computerSlotLabel(rows, row.memberId))
          : isUnregistered
            ? unregisteredSlotLabel(rows, row.memberId)
            : (m?.nickname ?? row.memberId);
        return (
          <div key={row.memberId} className="scr-readonly-team-row">
            <span className="scr-mono scr-readonly-team-name">{name}</span>
            {!isComputer && row.race && <span className="scr-mono scr-readonly-team-race">{row.race}</span>}
          </div>
        );
      })}
    </div>
  );
}

const REPLAY_EXT = ".rep";
// iOS Safari는 확장자를 인식된 문서 타입(UTI)으로 매핑 못 하면 안전하게 카메라/사진첩까지
// 포함한 전체 메뉴를 띄워버린다. .rep는 iOS가 모르는 확장자라 이 케이스에 걸리므로,
// 범용 바이너리 MIME 타입을 같이 지정해 "문서 파일"로 인식시켜 Browse만 뜨게 유도한다.
const REPLAY_ACCEPT = ".rep,application/octet-stream";

interface MatchModalProps {
  // 있으면 수정, 없으면 신규 등록
  match?: Match | null;
  // "같은 팀으로 등록"으로 열었을 때 팀 구성/게임유형/비고를 미리 채워준다.
  // match가 있으면(수정) 무시된다 — 신규 등록에서만 쓰는 값이다.
  prefillFrom?: Match | null;
  onClose: () => void;
  // 저장 성공 후 호출 (목록 새로고침용)
  onSaved: () => void | Promise<void>;
}

// 기존 경기 수정에서 날짜/게임유형/결과를 읽기전용으로 보여줄 때 쓰는 결과 라벨.
const RESULT_LABEL: Record<MatchResult, string> = {
  team1: "1팀 승", team2: "2팀 승", draw: "무승부", not_held: "미실시",
};

// 경기결과 등록/수정 모달 — 날짜, 팀 구성, 결과, 메모, 파일첨부를 한 화면에서 처리
export default function MatchModal({ match, prefillFrom, onClose, onSaved }: MatchModalProps) {
  useLockBodyScroll();
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);
  const addMatch = useAppStore((s) => s.addMatch);
  const updateMatch = useAppStore((s) => s.updateMatch);
  const deleteMatch = useAppStore((s) => s.deleteMatch);
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);

  // 신규 등록은 누구나, 기존 경기결과 수정은 작성자 본인이나 운영자만 가능
  // (서버도 동일하게 막는다 — 여기서는 버튼 자체를 안 보여준다).
  const canModify = !match || (user && isAdminRole(user.roles)) || user?.id === match.createdBy?.id;
  // 삭제는 수정보다 엄격하게 — 작성자 본인이어도 안 되고 운영자 이상만 가능하다(오삭제 방지).
  // v2에서는 결과상세 팝업 없이 카드를 누르면 바로 이 수정 화면이 열리므로, 삭제도 여기서
  // 바로 할 수 있어야 한다(예전엔 결과상세에만 있었다).
  const canDelete = !!match && !!user && isAdminRole(user.roles);
  // 이미 결과가 확정된 경기를 고치는 중일 때만 날짜/게임유형/결과를 읽기전용으로 잠근다.
  const isLocked = !!match;

  // prefillFrom은 신규 등록(match 없음)일 때만 유효하다 — 날짜는 항상 오늘로 시작한다.
  const initialDate = match?.date ?? todayStr();
  const [date, setDate] = useState(initialDate);
  const [team1, setTeam1] = useState<MatchSlot[]>(match?.team1 ?? prefillFrom?.team1 ?? []);
  const [team2, setTeam2] = useState<MatchSlot[]>(match?.team2 ?? prefillFrom?.team2 ?? []);
  const [result, setResult] = useState<MatchResult>(match?.result ?? "team1");
  const notHeld = result === "not_held";
  const [matchType, setMatchType] = useState<MatchType>(match?.matchType ?? prefillFrom?.matchType ?? "0101");
  const [mapName, setMapName] = useState(match?.mapName ?? prefillFrom?.mapName ?? "");
  const [note, setNote] = useState(match?.note ?? prefillFrom?.note ?? "");
  const [attachment, setAttachment] = useState<MatchAttachment | null>(match?.attachment ?? null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 팀 인원수에 따라 게임유형을 자동으로 맞춘다 (양쪽 다 1명이면 일대일, 그 외엔 팀전).
  useEffect(() => {
    setMatchType(team1.length === 1 && team2.length === 1 ? "0101" : "0102");
  }, [team1.length, team2.length]);

  // 처음 연 상태와 비교해 입력한 내용이 있는지 판단 (있으면 닫을 때 확인)
  const initialSnapshot = useRef(JSON.stringify({
    date: initialDate,
    team1: match?.team1 ?? [],
    team2: match?.team2 ?? [],
    result: match?.result ?? "team1",
    matchType: match?.matchType ?? "0101",
    mapName: match?.mapName ?? "",
    note: match?.note ?? "",
    attachment: match?.attachment ?? null,
  })).current;
  const isDirty = JSON.stringify({ date, team1, team2, result, matchType, mapName, note, attachment }) !== initialSnapshot;

  const requestClose = () => {
    if (isDirty) setConfirmCloseOpen(true);
    else onClose();
  };

  const resolveDefaultRace = useDefaultRaceResolver(members);

  // 양 팀 중복 선택 방지 + 새로 추가할 수 있는 후보는 활성 회원만 (정지/승인대기 회원은 과거
  // 경기결과에 이미 포함돼 있으면 표시는 되지만 새로 팀에 추가할 수는 없다)
  const t1Ids = team1.map((r) => r.memberId);
  const t2Ids = team2.map((r) => r.memberId);
  const activeMembers = members.filter((m) => m.status === "active");
  const membersForT1 = activeMembers.filter((m) => !t2Ids.includes(m.id));
  const membersForT2 = activeMembers.filter((m) => !t1Ids.includes(m.id));

  // 미실시(경기가 열리지 않음)를 고르면 리플레이 첨부는 의미가 없어져 같이 지운다
  // (열리지 않은 경기의 리플레이는 있을 수 없으므로).
  const selectNotHeld = () => {
    setResult("not_held");
    setAttachment(null);
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(REPLAY_EXT)) {
      setErr("스타크래프트 리플레이 파일(.rep)만 첨부할 수 있어요.");
      e.target.value = "";
      return;
    }
    setErr("");
    const reader = new FileReader();
    reader.onload = () => setAttachment({ name: f.name, url: reader.result as string });
    reader.readAsDataURL(f);
  };

  // 서버에 이미 저장된 첨부(= data URL 아님)만 다운로드 가능. 새로 고른(아직 저장 전) 파일은 대상 아님.
  const canDownloadAttachment = !!match && !!attachment && !attachment.url.startsWith("data:");

  const handleDownload = async () => {
    if (!match || !attachment) return;
    try {
      const blob = await api.downloadMatchAttachment(match.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErr("첨부파일을 다운로드하지 못했어요.");
    }
  };

  const doDelete = async () => {
    if (!match) return;
    setBusy(true);
    try {
      await deleteMatch(match.id);
      await onSaved();
      onClose();
    } catch (e) {
      setConfirmDeleteOpen(false);
      setErr(e instanceof Error ? e.message : "삭제에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr("날짜를 올바르게 입력해 주세요."); return; }
    if (team1.length === 0 || team2.length === 0) { setErr("양 팀에 최소 1명 이상의 멤버를 선택해 주세요."); return; }
    // 컴퓨터는 종족이 중요치 않아 선택을 요구하지 않는다.
    if ([...team1, ...team2].some((r) => !isComputerSlot(r.memberId) && !r.race)) {
      setErr("모든 멤버의 종족을 선택해 주세요."); return;
    }
    setErr("");
    setBusy(true);
    const payload: NewMatch = {
      date, team1, team2, result, matchType, note, attachment,
      mapName: mapName || null,
      // 리플레이로 등록된 경기는 실제 시작 시각이 있어 "제N경기" 순서를 정확히 매길 수 있는데,
      // 수동 등록 경기는 그 값이 계속 없으면 리플레이 경기와 순서를 비교할 기준이 없다 —
      // 그래서 신규 수동 등록 시점엔 "지금"을 실제 플레이 시각으로 간주해 채운다(수정할
      // 때는 이미 있는 값을 그대로 보존하고 손대지 않는다).
      gameStartedAt: match ? (match.gameStartedAt ?? null) : new Date().toISOString(),
      durationSeconds: match?.durationSeconds ?? null,
    };
    try {
      if (match) await updateMatch(match.id, payload);
      else await addMatch(payload);
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
      <div className={cx("scr-modal", "scr-modal-match", isLocked && "scr-modal-match-compact")}>
        <div className="scr-modal-head">
          <span>{match ? "경기결과 수정" : "경기결과 등록"}</span>
          <button className="scr-icon-btn" onClick={requestClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          {match?.createdBy && (
            <div className="scr-hint scr-hint-left">
              작성자:{" "}
              <button type="button" className="scr-link-btn" onClick={() => openMemberProfile(match.createdBy!.id)}>
                {match.createdBy.nickname}
              </button>
            </div>
          )}

          {isLocked ? (
            <div className="scr-readonly-field-grid">
              <div className="scr-field scr-field-row">
                <span className="scr-label">날짜</span>
                <span className="scr-field-readonly-value">{date}</span>
              </div>
              <div className="scr-field scr-field-row">
                <span className="scr-label">게임유형</span>
                <span className="scr-field-readonly-value">{MATCH_TYPE_INFO[matchType]}</span>
              </div>
              <div className="scr-field scr-field-row">
                <span className="scr-label">결과</span>
                <span className="scr-field-readonly-value">{RESULT_LABEL[result]}</span>
              </div>
              {mapName && (
                <div className="scr-field scr-field-row">
                  <span className="scr-label">맵</span>
                  <span className="scr-field-readonly-value">{mapName}</span>
                </div>
              )}
            </div>
          ) : (
            <label className="scr-field">
              <span className="scr-label">날짜</span>
              <DateField
                value={date}
                onChange={setDate}
                onDayPick={setDate}
                placeholder="날짜 선택 (YYYY-MM-DD)"
                rangeFrom=""
                rangeTo=""
              />
            </label>
          )}

          <div className={cx("scr-team-grid scr-team-grid-no-vs", isLocked && "scr-team-grid-noresult")}>
            {!isLocked && (
              <div className="scr-team-grid-buttons">
                <button
                  type="button"
                  className={cx("scr-result-btn scr-team-grid-btn-notheld", notHeld && "scr-result-btn-active")}
                  onClick={selectNotHeld}
                  aria-label="미실시 (승패 없음)"
                >
                  미실시
                </button>
                <button
                  type="button"
                  className={cx("scr-result-btn scr-team-grid-btn1", result === "team1" && "scr-result-btn-active")}
                  onClick={() => setResult("team1")}
                  aria-label="1팀 승리"
                >
                  1팀승
                </button>
                <button
                  type="button"
                  className={cx("scr-result-btn scr-result-btn-draw scr-team-grid-btn-draw", result === "draw" && "scr-result-btn-active")}
                  onClick={() => setResult("draw")}
                  aria-label="무승부"
                >
                  무
                </button>
                <button
                  type="button"
                  className={cx("scr-result-btn scr-team-grid-btn2", result === "team2" && "scr-result-btn-active")}
                  onClick={() => setResult("team2")}
                  aria-label="2팀 승리"
                >
                  2팀승
                </button>
              </div>
            )}
            <div className="scr-team-grid-team1">
              <span className="scr-team-grid-title">1팀</span>
              {isLocked ? (
                <ReadonlyTeamRoster rows={team1} members={members} />
              ) : (
                <MemberMultiSelect
                  members={members} addableMembers={membersForT1} rows={team1} setRows={setTeam1}
                  resolveDefaultRace={resolveDefaultRace}
                />
              )}
            </div>
            <div className="scr-team-grid-team2">
              <span className="scr-team-grid-title">2팀</span>
              {isLocked ? (
                <ReadonlyTeamRoster rows={team2} members={members} />
              ) : (
                <MemberMultiSelect
                  members={members} addableMembers={membersForT2} rows={team2} setRows={setTeam2}
                  resolveDefaultRace={resolveDefaultRace}
                />
              )}
            </div>
          </div>

          {!isLocked && (
            <label className="scr-field">
              <span className="scr-label">맵</span>
              <input
                className="scr-input"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                placeholder="맵 이름 (선택)"
              />
            </label>
          )}

          <label className="scr-field">
            <span className="scr-label">메모</span>
            <textarea
              className="scr-input scr-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </label>

          <div className="scr-attach-row">
            {/* 이미 저장된 경기는 리플레이를 분석해서 들어온 팀 구성과 묶여 있어 다른 파일로
                바꿔치기할 수 없다 — 첨부를 없애는 것(제거 버튼)만 가능하고, 새로 고르는
                버튼 자체를 없앤다. */}
            {!isLocked && (
              <button
                type="button"
                className="scr-attach-pick-btn"
                onClick={() => fileRef.current?.click()}
                aria-label="리플레이 파일 선택"
                disabled={notHeld}
                title={notHeld ? "미실시 경기는 리플레이를 첨부할 수 없어요." : "리플레이 파일 선택 (.rep)"}
              >
                <Paperclip size={15} />
              </button>
            )}
            {attachment && (
              <span className="scr-attach-chip">
                {canDownloadAttachment ? (
                  <button type="button" className="scr-attach-name-btn" onClick={handleDownload}>
                    <Download size={12} /> {attachment.name}
                  </button>
                ) : (
                  <span className="scr-mono">{attachment.name}</span>
                )}
                {/* 이미 저장된(서버의) 리플레이는 삭제 기능을 일단 뺀다 — 나중에 다시
                    필요할 수 있어 지워지지 않게 잠가둔다. 이번에 새로 고르기만 하고
                    아직 저장 전인 파일은 그대로 다시 고르기 전까지 취소할 수 있다. */}
                {!canDownloadAttachment && (
                  <button type="button" onClick={() => setAttachment(null)} aria-label="첨부 제거"><X size={12} /></button>
                )}
              </span>
            )}
            <input ref={fileRef} type="file" accept={REPLAY_ACCEPT} hidden onChange={handleFile} />
          </div>

          {!canModify && (
            <div className="scr-hint scr-hint-left">작성자 또는 운영자만 수정할 수 있어요.</div>
          )}

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-ghost" onClick={requestClose}>
              {canModify ? "취소" : "닫기"}
            </button>
            {canDelete && (
              <button
                type="button"
                className="scr-btn scr-btn-ghost scr-btn-danger"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={busy}
              >
                <Trash2 size={13} /> 삭제
              </button>
            )}
            {canModify && (
              <button type="button" className="scr-btn scr-btn-primary" onClick={submit} disabled={busy}>
                {busy ? <><Spinner /> 저장 중...</> : (match ? "수정" : "등록")}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmDeleteOpen && (
        <ConfirmDialog
          title="경기결과를 삭제할까요?"
          message="삭제하면 되돌릴 수 없어요."
          confirmLabel={busy ? "삭제 중..." : "삭제"}
          cancelLabel="취소"
          onConfirm={doDelete}
          onCancel={() => setConfirmDeleteOpen(false)}
        />
      )}

      {confirmCloseOpen && (
        <ConfirmDialog
          title="작성을 취소하시겠어요?"
          message=""
          confirmLabel="닫기"
          cancelLabel="계속 작성"
          onConfirm={onClose}
          onCancel={() => setConfirmCloseOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}
