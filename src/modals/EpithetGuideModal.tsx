import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { epithetGuideRows, type EpithetRank } from "../utils/statEpithet";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 리스트 — 모든 칭호와 그걸 받는 조건을 한 판에 늘어놓는다(요청: 툴팁 아이콘 대신
   글자 버튼, 팝업이 아니라 모달로). 등급(전설·에픽·일반)으로 나눠 적는다(요청).
 *
 * 줄은 표(statEpithet의 TITLES)에서 그때그때 만든다 — 손으로 적어 두면 이름이나 문턱을
 * 고칠 때마다 이 화면만 옛말을 하게 되고, 그 어긋남이 여기서는 바로 거짓말이 된다.
 * 점수(무게)는 안 적는다(요청: 순서로만) — 자주 손보는 살림이라, 보는 쪽이 알아야 하는
 * 것은 "무엇이 먼저 가나"뿐이다. 그 순서가 곧 목록의 차례다. */
/** 목록에 늘어놓을 격의 차례 — 위가 더 높은 자리다. */
const RANKS: EpithetRank[] = ["전설", "에픽", "일반"];

export default function EpithetGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const rows = epithetGuideRows();

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-epithet-guide" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 리스트</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body scr-scroll">
          {/* (삭제) 머리말 — 규칙 요약 한 문단을 두었다가 걷었다(요청). 목록 자체가 이미
              등급·차례로 말하고 있어, 그 위의 설명은 같은 말을 한 번 더 하는 셈이었다. */}
          {/* 등급으로 나눠 적는다(요청: 전설·에픽·일반) — 쉰 줄이 한 덩어리로 서면 어느
              것이 더 높은 자리인지가 안 보인다. 갈래 안에서는 점수 순 그대로다. */}
          {RANKS.map((rank) => {
            const group = rows.filter((r) => r.rank === rank);
            if (group.length === 0) return null;
            return (
              <section className="scr-epithet-guide-group" key={rank}>
                <h3 className="scr-epithet-guide-rank">{rank}</h3>
                <ul className="scr-epithet-guide-list">
                  {group.map((r) => (
                    <li className="scr-epithet-guide-row" key={r.label}>
                      <span className="scr-epithet-guide-name">{r.label}</span>
                      <span className="scr-epithet-guide-how">
                        {r.how}
                        {/* 이긴 판만 세는 칭호는 그 한마디를 덧붙인다 — 같은 "세 번"이라도
                            뜻이 다르고, 안 적으면 왜 내 기록보다 적게 세었는지 알 길이 없다. */}
                        {r.wonOnly && <span className="scr-epithet-guide-won"> · 이긴 판만</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
