import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { epithetGuideRows, type EpithetRank } from "../utils/statEpithet";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 설명(요청: 버튼 부활 + 목록) — 모든 칭호와 그걸 받는 절대 조건을 등급별로 늘어놓는다.
 * 상대평가 시절에는 목록이 "누가 1위냐"라 설명이 어려웠는데, 절대평가가 되면서 조건이 곧
 * 설명이 됐다: "이 수를 넘으면 받는다"는 문장 하나로 끝난다.
 * 줄은 표(statEpithet의 TITLES)에서 그때그때 만든다 — 손으로 적어 두면 문턱을 고칠 때마다
 * 이 화면만 옛말을 하게 된다. */

/** 등급의 차례 — 위가 더 받기 어려운 자리다. 일반은 에픽에 합쳤다(요청). */
const RANKS: EpithetRank[] = ["전설", "에픽"];

export default function EpithetGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const rows = epithetGuideRows();

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-epithet-guide" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 설명</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body scr-scroll">
          {/* 절대평가의 규칙 한 줄(요청: 설명도 그에 맞춰서) — 목록보다 먼저 읽혀야 하는
              것은 "조건만 넘으면 누구든, 여러 개도"라는 새 규칙 그 자체다. */}
          <p className="scr-epithet-guide-lead">
            조건을 넘으면 누구든 받아요 — 같은 칭호를 여럿이 가질 수 있고, 한 사람이 여러
            칭호를 가질 수 있어요. 표에는 그중 가장 높은 하나가 보여요.
          </p>
          {RANKS.map((rank) => {
            const group = rows.filter((r) => r.rank === rank);
            if (group.length === 0) return null;
            return (
              <section className="scr-epithet-guide-group" key={rank}>
                <h3 className="scr-epithet-guide-rank">{rank}</h3>
                <ul className="scr-epithet-guide-list">
                  {group.map((r, i) => (
                    <li
                      className={
                        /* 묶음이 바뀌는 자리에 줄을 긋는다(요청: 그룹화) — 묶음 번호는
                           표(GUIDE_ORDER)가 정하고 여기는 경계만 읽는다. */
                        i > 0 && group[i - 1].group !== r.group
                          ? "scr-epithet-guide-row scr-epithet-guide-row-newgroup"
                          : "scr-epithet-guide-row"
                      }
                      key={r.label}
                    >
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
