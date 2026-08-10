import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import PhotoViewer from "../components/common/PhotoViewer";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { useEpithets } from "../utils/useEpithets";
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
  // 통계 표에 붙는 것과 같은 한 벌이다(useEpithets) — 화면마다 다른 별명이 붙으면 안 된다.
  const epithet = useEpithets().get(member.id);

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
              {/* 칭호는 닉네임 '위'다(요청) — 아래에 두면 배틀태그와 나란히 서서 둘 다
                  '이름에 딸린 부속 정보'로 읽힌다. 위에 얹으면 이름을 부르기 전에 먼저
                  읽히는 수식어가 되어, 실제로 사람을 소개하는 차례와 같아진다. */}
              {epithet && (
                <div className="scr-member-detail-epithet">
                  {epithet.label}
                  {/* 근거는 여기서만 글자로 드러낸다(지적: 툴팁이 안 나온다) — 툴팁은 마우스를
                      1초쯤 얹고 있어야 뜨고 손가락으로는 아예 뜨지 않는다. 표에서는 줄마다
                      한 줄씩 늘릴 수 없어 툴팁으로 두지만, 팝업은 자리가 있으니 그냥 적는다. */}
                  <span className="scr-member-detail-epithet-why">{epithet.why}</span>
                </div>
              )}
              <div className="scr-member-detail-name">{member.nickname}</div>
              <div className="scr-member-detail-tag scr-mono">{member.battletag}</div>
            </div>
          </div>

          <dl className="scr-detail-list">
            {member.insta && <div className="scr-detail-row"><dt>인스타</dt><dd>{member.insta}</dd></div>}
          </dl>

        </div>
        <div className="scr-form-actions">
          <button type="button" className="scr-btn scr-btn-ghost" onClick={onClose}>닫기</button>
        </div>
      </div>

      {photoOpen && member.avatar && (
        <PhotoViewer src={member.avatar} alt={member.nickname} onClose={() => setPhotoOpen(false)} />
      )}
    </div>,
    document.body,
  );
}
