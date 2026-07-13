import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import PhotoViewer from "../components/common/PhotoViewer";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import type { Member } from "../types";

interface MemberProfileModalProps {
  member: Member;
  onClose: () => void;
}

// 닉네임/아바타를 클릭하면 어디서든 뜨는 공개용 회원 프로필 — 관리 기능 없이 기본 정보만
// 간단히 보여준다. 사진을 클릭하면 적당한 크기로 확대해서 볼 수 있다.
export default function MemberProfileModal({ member, onClose }: MemberProfileModalProps) {
  useLockBodyScroll();
  const [photoOpen, setPhotoOpen] = useState(false);

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm">
        <div className="scr-modal-head">
          <span>회원 프로필</span>
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
            </div>
          </div>

          <dl className="scr-detail-list">
            {member.insta && <div className="scr-detail-row"><dt>인스타</dt><dd>{member.insta}</dd></div>}
          </dl>

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-ghost" onClick={onClose}>닫기</button>
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
