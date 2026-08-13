import { useEffect, useState } from "react";
import ModalHash from "../utils/modalHash";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import PhotoViewer from "../components/common/PhotoViewer";
import { Spinner } from "../components/common/Feedback";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { claimsOfMember, useEpithets, type EpithetClaimRow } from "../utils/useEpithets";
import { cx } from "../utils/format";
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
  const epithet = useEpithets().get(member.id);

  /* 보유한 칭호 전부(요청) — 저장된 대표 하나가 아니라 지금 기록으로 조건을 만족하는 것을
     쭉 늘어놓는다. 절대평가라 이 목록이 곧 "이 사람이 가진 칭호"이고, 표에 나가는 한 줄은
     그중 대표일 뿐이다(statEpithet의 claims 주석).
     계산은 창을 열 때 한 번 돈다 — 서버에는 아무것도 안 올린다(시뮬레이션과 같은 자리). */
  const [claims, setClaims] = useState<EpithetClaimRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    claimsOfMember(member.id)
      .then((rows) => { if (!cancelled) setClaims(rows); })
      // 칭호가 안 떠도 프로필은 그대로다 — 한 칸이 비는 것뿐이라 오류를 띄우지 않는다.
      .catch(() => { if (!cancelled) setClaims([]); });
    return () => { cancelled = true; };
  }, [member.id]);

  /* '표시' 배지가 붙는 줄(요청: 표시되는 것에는 배지를 오른쪽에) — 표와 프로필이 같은 말을
     해야 하므로, 기준은 계산 결과의 1등이 아니라 실제로 표에 나가는 저장된 칭호다.
     칭호 계산은 경기가 등록될 때만 돌아서(useEpithets), 규칙을 고치고 아직 다시 계산하지
     않았으면 저장된 칭호가 지금 조건 목록에 없을 수 있다. 그때는 그 한 줄을 맨 위에 따로
     세운다 — 배지를 아무 데도 안 붙이면 "표에 보이는 저건 뭔데?"가 남고, 아무 데나 붙이면
     거짓말이 된다. */
  const shownLabel = epithet?.label ?? null;
  const rows: EpithetClaimRow[] = claims === null ? [] : (
    shownLabel && !claims.some((c) => c.label === shownLabel)
      ? [{ memberId: member.id, label: shownLabel, why: epithet?.why ?? "", score: 0, sticky: false }, ...claims]
      : claims
  );

  return createPortal(
    <div className="scr-modal-overlay">
      <ModalHash hash={`member-${member.id}`} onClose={onClose} />
      <div className="scr-modal scr-modal-sm">
        <div className="scr-modal-head">
          <span>회원 프로필</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        {/* 칭호 목록이 길어질 수 있어 본문이 스크롤을 갖는다 — 열 개 넘게 든 사람도 있다. */}
        <div className="scr-modal-body scr-scroll">
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
              {/* 머리에는 표에 나가는 그 한 줄만 둔다 — 아래 목록이 전부를 말하므로 여기까지
                  여러 줄이면 "이 사람을 부르는 말"이 흐려진다. */}
              {epithet && (
                <div className="scr-member-profile-epithet" title={epithet.why}>{epithet.label}</div>
              )}
              <div className="scr-member-detail-tag scr-mono">{member.battletag}</div>
            </div>
          </div>

          <dl className="scr-detail-list">
            {member.insta && <div className="scr-detail-row"><dt>인스타</dt><dd>{member.insta}</dd></div>}
          </dl>

          <section className="scr-profile-epithets">
            {/* "보유 칭호" → "이 사람은?"(요청) — 목록이 곧 그 사람 소개다. */}
            <h4 className="scr-profile-epithets-head">이 사람은?</h4>
            {claims === null ? (
              <div className="scr-empty"><Spinner size={16} /></div>
            ) : rows.length === 0 ? (
              <p className="scr-profile-epithets-none">아직 조건을 넘긴 칭호가 없어요.</p>
            ) : (
              <ul className="scr-profile-epithet-list">
                {rows.map((c) => (
                  <li
                    className={cx("scr-profile-epithet-row", c.label === shownLabel && "scr-profile-epithet-row-shown")}
                    key={c.label}
                  >
                    <div className="scr-profile-epithet-text">
                      <span className="scr-profile-epithet-label">{c.label}</span>
                      <span className="scr-profile-epithet-why">{c.why}</span>
                    </div>
                    {c.label === shownLabel && <span className="scr-profile-epithet-badge">표시</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

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
