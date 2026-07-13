import { useState } from "react";
import { createPortal } from "react-dom";
import { X, RefreshCw } from "lucide-react";
import Avatar from "../components/common/Avatar";
import Select from "../components/common/Select";
import ReplayAliasesField, { cleanReplayAliases } from "../components/common/ReplayAliasesField";
import PhotoViewer from "../components/common/PhotoViewer";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";
import { ROLE_INFO, ASSIGNABLE_ROLES, isAdminRole } from "../constants/roles";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Member, MemberRole } from "../types";

interface MemberDetailModalProps {
  member: Member;
  onClose: () => void;
}

const STATUS_LABEL_FALLBACK: Record<Member["status"], string> = {
  pending: "승인 대기",
  active: "활성",
  suspended: "정지",
  withdrawn: "탈퇴",
};

// 회원 화면(운영자 전용)에서 여는 상세 — 승인/사용 중지/재개/사진 재처리/역할 변경
// (운영자 지정/회수) 모두 운영자 전용이다.
export default function MemberDetailModal({ member, onClose }: MemberDetailModalProps) {
  useLockBodyScroll();
  const currentUser = useAppStore((s) => s.user);
  const updateMemberStatus = useAppStore((s) => s.updateMemberStatus);
  const updateMemberRoles = useAppStore((s) => s.updateMemberRoles);
  const reprocessMemberAvatar = useAppStore((s) => s.reprocessMemberAvatar);
  const replaceMemberReplayAliases = useAppStore((s) => s.replaceMemberReplayAliases);
  const [resizing, setResizing] = useState(false);
  const [err, setErr] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  // 체크박스를 누르는 즉시 저장하지 않고, 저장 버튼을 눌렀을 때 한 번에 반영한다.
  const [pendingRoles, setPendingRoles] = useState<MemberRole[]>(member.roles);
  const rolesChanged = pendingRoles.length !== member.roles.length
    || pendingRoles.some((r) => !member.roles.includes(r));
  // 게임아이디도 별도 저장 버튼 없이 아래 저장 버튼 하나로 같이 저장한다.
  const [pendingAliases, setPendingAliases] = useState<string[]>(
    member.replayAliases.length > 0 ? member.replayAliases : [""],
  );
  const aliasesChanged = JSON.stringify(cleanReplayAliases(pendingAliases)) !== JSON.stringify(member.replayAliases);

  const isSelf = currentUser?.id === member.id;
  // 운영자 지정/회수는 운영자 아무나 할 수 있다.
  const canManageRole = !!currentUser && isAdminRole(currentUser.roles);
  // 승인/정지/재개, 사진 재처리도 운영자 전용 (이 모달 자체가 이미 운영자 전용 화면에서만 열린다).
  const isAdmin = !!currentUser && isAdminRole(currentUser.roles);

  // 상태 변경도 역할 변경과 같은 패턴: 드롭다운으로 값만 바꿔두고, 실제 저장은 "저장" 버튼을
  // 눌렀을 때 한 번에 한다. 백엔드는 active/suspended로만 전환을 허용하므로(pending/withdrawn은
  // 승인/재개를 통해서만 active로 갈 수 있고, 그 자체를 목표값으로 다시 고를 순 없다), 현재
  // 상태에 따라 고를 수 있는 대상 하나만 옵션에 추가한다.
  const statusTarget: "active" | "suspended" | null =
    member.status === "pending" ? "active"
    : member.status === "active" ? (isSelf ? null : "suspended")
    : member.status === "suspended" ? "active"
    : member.status === "withdrawn" ? "active"
    : null;
  const canChangeStatus = isAdmin && statusTarget !== null;
  const [pendingStatus, setPendingStatus] = useState<Member["status"]>(member.status);
  const statusChanged = pendingStatus !== member.status;
  const statusOptions = statusTarget
    ? [
        { value: member.status, label: STATUS_LABEL_FALLBACK[member.status] },
        { value: statusTarget, label: STATUS_LABEL_FALLBACK[statusTarget] },
      ]
    : [{ value: member.status, label: STATUS_LABEL_FALLBACK[member.status] }];

  // 체크박스/드롭다운/게임아이디는 전부 화면 상태만 바꾸고, 저장 버튼 하나를 눌렀을 때
  // 바뀐 것만 한 번에 반영한다 — 항목마다 따로 저장 버튼을 두면 뭘 눌러야 할지 헷갈리니
  // 하나로 합친다.
  const toggleRole = (role: MemberRole, checked: boolean) => {
    setErr("");
    setPendingRoles((prev) => (checked ? [...prev, role] : prev.filter((r) => r !== role)));
  };

  const anyChanged = rolesChanged || statusChanged || aliasesChanged;
  const saveAll = async () => {
    if (!anyChanged) return;
    if (rolesChanged && pendingRoles.length === 0) { setErr("최소 하나 이상의 역할이 필요합니다."); return; }
    setErr("");
    setSavingPermissions(true);
    try {
      if (rolesChanged) await updateMemberRoles(member.id, pendingRoles);
      if (statusChanged) await updateMemberStatus(member.id, pendingStatus as "active" | "suspended");
      if (aliasesChanged) await replaceMemberReplayAliases(member.id, cleanReplayAliases(pendingAliases));
      if (statusChanged) onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리에 실패했어요.");
    } finally {
      setSavingPermissions(false);
    }
  };

  const doResize = async () => {
    if (!member.avatar) return;
    setErr("");
    setResizing(true);
    try {
      await reprocessMemberAvatar(member.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진 재처리에 실패했어요.");
    } finally {
      setResizing(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm">
        <div className="scr-modal-head">
          <span>회원 상세</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <div className="scr-avatar-pick">
            <button
              type="button"
              className="scr-avatar-open-btn"
              onClick={() => setPhotoOpen(true)}
              disabled={!member.avatar}
              aria-label="사진 크게 보기"
            >
              <Avatar member={member} size={56} />
            </button>
            <div>
              <div className="scr-member-detail-name">{member.nickname}</div>
              <div className="scr-member-detail-tag scr-mono">{member.battletag}</div>
              {isAdmin && member.avatar && (
                <button type="button" className="scr-link-btn scr-member-detail-resize" onClick={doResize} disabled={resizing}>
                  <RefreshCw size={11} className={resizing ? "scr-spin" : undefined} /> 사진 재처리(화질 개선)
                </button>
              )}
            </div>
          </div>

          <dl className="scr-detail-list">
            {member.insta && <div className="scr-detail-row"><dt>인스타</dt><dd>{member.insta}</dd></div>}
            <div className="scr-detail-row"><dt>가입일</dt><dd className="scr-mono">{member.createdAt.slice(0, 10)}</dd></div>
            <div className="scr-detail-row">
              <dt>권한</dt>
              <dd>
                {canManageRole ? (
                  <div className="scr-checkbox-group">
                    {ASSIGNABLE_ROLES.map((role) => (
                      <label key={role} className="scr-checkbox-field">
                        <input
                          type="checkbox"
                          checked={pendingRoles.includes(role)}
                          disabled={savingPermissions}
                          onChange={(e) => toggleRole(role, e.target.checked)}
                        />
                        {ROLE_INFO[role]}
                      </label>
                    ))}
                  </div>
                ) : member.roles.map((r) => ROLE_INFO[r]).join(", ")}
              </dd>
            </div>
            <div className="scr-detail-row">
              <dt>상태</dt>
              <dd>
                {canChangeStatus ? (
                  <Select
                    className="scr-status-edit-select"
                    size="sm"
                    value={pendingStatus}
                    options={statusOptions}
                    onChange={(v) => setPendingStatus(v as Member["status"])}
                  />
                ) : STATUS_LABEL_FALLBACK[member.status]}
              </dd>
            </div>
          </dl>

          <ReplayAliasesField rows={pendingAliases} onChange={setPendingAliases} />

          {isSelf && member.status === "active" && (
            <span className="scr-hint scr-hint-left">본인 계정은 여기서 정지할 수 없어요.</span>
          )}

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>닫기</button>
            <button
              type="button"
              className="scr-btn scr-btn-primary"
              onClick={saveAll}
              disabled={savingPermissions || !anyChanged}
            >
              {savingPermissions ? <Spinner /> : "저장"}
            </button>
          </div>
        </div>
      </div>

      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>,
    document.body,
  );
}
