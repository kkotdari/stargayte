import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { epithetGuideRows } from "../utils/statEpithet";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 안내 — 모든 칭호와 그걸 받는 조건을 한 판에 늘어놓는다(요청: 툴팁 아이콘 대신
   "칭호 조건" 버튼, 팝업이 아니라 모달로).
 *
 * 줄은 표(statEpithet의 TITLES)에서 그때그때 만든다 — 손으로 적어 두면 이름이나 문턱을
 * 고칠 때마다 이 화면만 옛말을 하게 되고, 그 어긋남이 여기서는 바로 거짓말이 된다.
 * 점수(무게)는 안 적는다(요청: 순서로만) — 자주 손보는 살림이라, 보는 쪽이 알아야 하는
 * 것은 "무엇이 먼저 가나"뿐이다. 그 순서가 곧 목록의 차례다. */
export default function EpithetGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const rows = epithetGuideRows();

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-epithet-guide" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 조건</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body scr-scroll">
          <p className="scr-epithet-guide-lead">
            내전 전체 기록에서 한 사람에 하나씩 붙어요. 위에 있을수록 먼저 가고,
            한 칭호는 한 사람뿐이라 임자가 다른 칭호로 가면 그 칭호는 안 나가요.
          </p>
          <ul className="scr-epithet-guide-list">
            {rows.map((r) => (
              <li className="scr-epithet-guide-row" key={r.label}>
                <span className="scr-epithet-guide-name">{r.label}</span>
                <span className="scr-epithet-guide-how">
                  {r.how}
                  {/* 이긴 판만 세는 칭호는 그 한마디를 덧붙인다 — 같은 "세 번"이라도 뜻이
                      다르고, 안 적으면 왜 내 기록보다 적게 세었는지 알 길이 없다. */}
                  {r.wonOnly && <span className="scr-epithet-guide-won"> · 이긴 판만</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
