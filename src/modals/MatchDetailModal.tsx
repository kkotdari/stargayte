import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, Download, Monitor, UserPlus } from "lucide-react";
import Avatar from "../components/common/Avatar";
import RaceBadge from "../components/common/RaceBadge";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import { isAdminRole } from "../constants/roles";
import { useAppStore } from "../store/appStore";
import { api } from "../api/client";
import { cx } from "../utils/format";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { isComputerSlot, computerSlotLabel } from "../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../constants/unregisteredSlot";
import type { Match, MatchSlot, MatchResult, Member } from "../types";

type Outcome = "win" | "loss" | "draw" | "notHeld" | "pending";

function outcomeFor(side: "team1" | "team2", result: MatchResult | null): Outcome {
  if (result === null) return "pending";
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}

const OUTCOME_LABEL: Record<Outcome, string> = { win: "승", loss: "패", draw: "무", notHeld: "미실시", pending: "" };
const OUTCOME_CLASS: Record<Outcome, string> = { win: "scr-win", loss: "scr-loss", draw: "scr-draw", notHeld: "scr-draw", pending: "" };

interface TeamStatTableProps {
  side: "team1" | "team2";
  players: MatchSlot[];
  memberOf: (id: string) => Member | undefined;
  outcome: Outcome;
  hasStats: boolean;
  onOpenProfile: (id: string) => void;
}

// 팀 구성과 선수 기록(APM 등)을 하나의 표로 합쳐서 보여준다 — 리플레이로 등록된 경기는
// 실제 수치까지, 수동 등록 경기는 닉네임/종족만 있는 좁은 표로 자연스럽게 줄어든다.
function TeamStatTable({ side, players, memberOf, outcome, hasStats, onOpenProfile }: TeamStatTableProps) {
  const teamLabel = side === "team1" ? "팀 1" : "팀 2";
  return (
    <div className="scr-team-stat-block">
      <div className={cx("scr-team-stat-head", OUTCOME_CLASS[outcome])}>
        {teamLabel}{OUTCOME_LABEL[outcome] && ` (${OUTCOME_LABEL[outcome]})`}
      </div>
      <div className="scr-team-stat-table">
        <div className={cx("scr-team-stat-row", "scr-team-stat-row-head", !hasStats && "scr-team-stat-row-compact")}>
          <span>닉네임</span>
          <span>종족</span>
          {hasStats && (
            <>
              <span>APM</span>
              <span>EAPM</span>
              <span title="명령수">CMD</span>
              <span title="유효명령수">EFF</span>
            </>
          )}
        </div>
        {players.map((p) => {
          const isComputer = isComputerSlot(p.memberId);
          const isUnregistered = isUnregisteredSlot(p.memberId);
          const m = isComputer || isUnregistered ? undefined : memberOf(p.memberId);
          // 리플레이 원본 이름(rawName)이 저장돼 있으면 "컴퓨터 N"/"비회원 N" 같은 순번
          // 라벨 대신 그대로 보여준다 — 수동 등록 등으로 rawName이 없는 경우에만 순번으로 대체.
          const name = isComputer
            ? (p.rawName || computerSlotLabel(players, p.memberId))
            : isUnregistered
              ? (p.rawName || unregisteredSlotLabel(players, p.memberId))
              : (m?.nickname ?? p.memberId);
          return (
            <div key={p.memberId} className={cx("scr-team-stat-row", !hasStats && "scr-team-stat-row-compact")}>
              {isComputer || isUnregistered ? (
                <span className="scr-team-stat-player">
                  <Avatar
                    icon={isComputer
                      ? <Monitor size={16} className="scr-chip-computer-icon" />
                      : <UserPlus size={16} className="scr-chip-computer-icon" />}
                    size={22}
                  />
                  <span>{name}</span>
                </span>
              ) : (
                <button type="button" className="scr-team-stat-player" onClick={() => onOpenProfile(p.memberId)}>
                  <Avatar member={m} size={22} />
                  {/* 유저연결(게임아이디 매핑)이 실제로 맞게 됐는지 바로 대조해볼 수 있게,
                      닉네임 아래에 배틀태그도 작게 같이 보여준다 — 이 표는 이미 6칸(닉네임/종족/
                      APM/EAPM/CMD/EFF)을 나눠 쓰는 좁은 칸이라, 옆으로 나란히 붙이면 자리
                      싸움에 밀려 겹쳐 보인다. 세로로 쌓아 폭 대신 행 높이만 살짝 늘린다.
                      p.rawName(이 경기 시점에 리플레이가 실제로 담고 있던 게임 아이디,
                      영구 보존됨)을 우선 보여준다 — 회원의 현재 battletag는 나중에 바뀔 수
                      있어서 이 경기 당시 값과 다를 수 있다. 수동 등록 등 리플레이 원본이
                      없는 경우에만 현재 battletag로 대체한다. */}
                  <span className="scr-team-stat-player-info">
                    <span className="scr-team-stat-player-name">{name}</span>
                    {(p.rawName || m?.battletag) && (
                      <span className="scr-team-stat-player-tag scr-mono">{p.rawName || m?.battletag}</span>
                    )}
                  </span>
                </button>
              )}
              <span className="scr-team-stat-race"><RaceBadge race={p.race} size={18} plain /></span>
              {hasStats && (
                <>
                  <span className="scr-mono">{p.apm ?? "-"}</span>
                  <span className="scr-mono">{p.eapm ?? "-"}</span>
                  <span className="scr-mono">{p.cmdCount ?? "-"}</span>
                  <span className="scr-mono">{p.effectiveCmdCount ?? "-"}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "3:05" 처럼 리플레이 플레이 시간을 사람이 읽기 좋은 분:초로 바꾼다.
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 날짜는 바로 위 "날짜" 항목과 중복이라 시:분만 표시한다.
function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface MatchDetailModalProps {
  match: Match;
  onClose: () => void;
  onEdit: () => void;
  // 삭제 성공 후 호출 (목록 새로고침용) — MatchModal의 onSaved와 같은 역할.
  onSaved: () => void | Promise<void>;
}

// 경기상세 읽기 전용 팝업 — 이 화면에서는 수정이 불가하므로 셀렉트박스/달력/파일선택 없이
// 저장된 값만 보여준다. 실제 수정은 "수정" 버튼으로 기존 등록/수정 폼(MatchModal)으로 넘어가서 한다.
// 삭제는 수정으로 들어갔다가 다시 찾는 게 불편해서 여기서도(수정 버튼 옆) 바로 할 수 있게 한다.
export default function MatchDetailModal({ match, onClose, onEdit, onSaved }: MatchDetailModalProps) {
  useLockBodyScroll();
  const user = useAppStore((s) => s.user);
  const memberOf = useAppStore((s) => s.memberOf);
  const openMemberProfile = useAppStore((s) => s.openMemberProfile);
  const deleteMatch = useAppStore((s) => s.deleteMatch);

  // 수정 버튼은 MatchModal과 동일한 권한 기준(작성자 본인 또는 운영자)일 때만 보여준다.
  const canModify = (user && isAdminRole(user.roles)) || user?.id === match.createdBy?.id;
  // 삭제는 수정보다 엄격하게 — 작성자 본인이어도 안 되고 운영자 이상만 가능하다(오삭제 방지).
  // MatchModal의 canDelete와 동일한 기준.
  const canDelete = !!user && isAdminRole(user.roles);
  // 리플레이로 등록된 경기만 APM 등 수치가 있다 — 수동 등록 경기는 팀 표에서 수치 컬럼 자체가 빠진다.
  const hasStats = [...match.team1, ...match.team2].some((s) => s.apm != null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const doDelete = async () => {
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

  const handleDownload = async () => {
    if (!match.attachment) return;
    try {
      const blob = await api.downloadMatchAttachment(match.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match.attachment.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // 읽기 전용 팝업이라 별도 에러 표시 영역을 두지 않는다
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-match">
        <div className="scr-modal-head">
          <span>결과상세</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <div className="scr-match-detail-cell scr-match-detail-cell-full">
            <span className="scr-label">날짜</span>
            <span className="scr-mono">{match.date}</span>
          </div>

          <div className="scr-match-detail-grid">
            <div className="scr-match-detail-cell">
              <span className="scr-label">게임유형</span>
              <span>{MATCH_TYPE_INFO[match.matchType]}</span>
            </div>
          </div>

          {(match.gameStartedAt || match.durationSeconds != null) && (
            <div className="scr-match-detail-grid">
              {match.gameStartedAt && (
                <div className="scr-match-detail-cell">
                  <span className="scr-label">시작 시각</span>
                  <span className="scr-mono">{formatStartedAt(match.gameStartedAt)}</span>
                </div>
              )}
              {match.durationSeconds != null && (
                <div className="scr-match-detail-cell">
                  <span className="scr-label">경기 시간</span>
                  <span className="scr-mono">{formatDuration(match.durationSeconds)}</span>
                </div>
              )}
            </div>
          )}

          {match.mapName && (
            <div className="scr-match-detail-cell scr-match-detail-cell-full">
              <span className="scr-label">맵</span>
              <span>{match.mapName}</span>
            </div>
          )}

          <div className="scr-team-stat-wrap">
            <TeamStatTable
              side="team1"
              players={match.team1}
              memberOf={memberOf}
              outcome={outcomeFor("team1", match.result)}
              hasStats={hasStats}
              onOpenProfile={openMemberProfile}
            />
            <TeamStatTable
              side="team2"
              players={match.team2}
              memberOf={memberOf}
              outcome={outcomeFor("team2", match.result)}
              hasStats={hasStats}
              onOpenProfile={openMemberProfile}
            />
          </div>

          {match.note && (
            <div className="scr-match-detail-row scr-match-detail-row-block">
              <span className="scr-label">메모</span>
              <p className="scr-match-detail-note">{match.note}</p>
            </div>
          )}

          {match.attachment && (
            <div className="scr-match-detail-row">
              <span className="scr-label">첨부파일</span>
              <button type="button" className="scr-attach-name-btn" onClick={handleDownload}>
                <Download size={12} /> <span>{match.attachment.name}</span>
              </button>
            </div>
          )}

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            {match.createdBy && (
              <span className="scr-hint scr-match-detail-author">
                작성자:{" "}
                <button type="button" className="scr-link-btn" onClick={() => openMemberProfile(match.createdBy!.id)}>
                  {match.createdBy.nickname}
                </button>
              </span>
            )}
            <button type="button" className="scr-btn scr-btn-ghost" onClick={onClose}>닫기</button>
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
              <button type="button" className="scr-btn scr-btn-ghost" onClick={onEdit}>
                수정
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
    </div>,
    document.body,
  );
}
