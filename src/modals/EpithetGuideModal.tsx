import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "../utils/format";
import { epithetGuideRows, type EpithetRank } from "../utils/statEpithet";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 설명(요청: 버튼 부활 + 목록) — 모든 칭호와 그걸 받는 절대 조건을 등급별로 늘어놓는다.
 * 목록이 아니라 표다(요청: 칭호/조건/최소판 세 열) — 조건 문장에 섞여 있던 표본(판수 바닥)
 * 조건이 제 열로 갈라져, 훑는 눈이 "무엇을 얼마나"와 "몇 판부터"를 따로 읽는다.
 * 줄은 표(statEpithet의 TITLES)에서 그때그때 만든다 — 손으로 적어 두면 문턱을 고칠 때마다
 * 이 화면만 옛말을 하게 된다. 머리말(절대평가 규칙 한 줄)은 걷었다(요청). */

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
          {RANKS.map((rank) => {
            const group = rows.filter((r) => r.rank === rank);
            if (group.length === 0) return null;
            return (
              <section className="scr-epithet-guide-group" key={rank}>
                <h3 className="scr-epithet-guide-rank">{rank}</h3>
                <table className="scr-epithet-guide-table">
                  <thead>
                    <tr>
                      <th>칭호</th>
                      <th>조건</th>
                      <th>최소판</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r, i) => (
                      <tr
                        className={cx(
                          /* 묶음이 바뀌는 자리에 줄을 긋는다(요청: 그룹화) — 묶음 번호는
                             표(GUIDE_ORDER)가 정하고 여기는 경계만 읽는다. */
                          i > 0 && group[i - 1].group !== r.group && "scr-epithet-guide-row-newgroup",
                        )}
                        key={r.label}
                      >
                        <td className="scr-epithet-guide-name">{r.label}</td>
                        <td className="scr-epithet-guide-how">
                          {r.how}
                          {/* 이긴 판만 세는 칭호는 그 한마디를 덧붙인다 — 같은 "세 번"이라도
                              뜻이 다르고, 안 적으면 왜 내 기록보다 적게 세었는지 알 길이 없다. */}
                          {r.wonOnly && <span className="scr-epithet-guide-won"> · 이긴 판만</span>}
                        </td>
                        <td className="scr-epithet-guide-min">{r.minPlays || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
