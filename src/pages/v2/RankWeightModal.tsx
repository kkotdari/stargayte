import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

interface RankWeightModalProps {
  // 지금 순위에 든 참가자 수(한 판이라도 뛴 회원) — 순수 순위 기준 가중치 표의 행 수이자,
  // 강함/약함의 최댓값을 정한다.
  count: number;
  // "개인전" | "팀전" — 표 제목에 붙여 어느 쪽 기준인지 알려준다.
  modeLabel: string;
  onClose: () => void;
}

// 순위표 링크로 여는 "점수 가중치" 설명 모달 — 실제 전적의 들쭉날쭉함을 걷어낸 '순수 순위'
// (완전 서열, 1위가 아래 전부에게 우세)를 가정했을 때, 각 순위의 상대를 이기면/지면 몇 점인지
// 표로 보여준다(요청). 산식은 랭킹과 동일: 이김 +2·강함, 짐 -1·약함.
//   순수 순위 k(1위가 가장 셈), 참가자 N명 기준
//   강함(k) = 1 + (N-k) 우세수,  약함(k) = 1 + (k-1) 열세수 = k
//   이겼을 때 = +2·강함(k),  졌을 때 = -1·약함(k)
// → 센 상대(위 순위)를 이길수록 크게 얻고, 약한 상대(아래 순위)에게 질수록 크게 잃는다.
export default function RankWeightModal({ count, modeLabel, onClose }: RankWeightModalProps) {
  useLockBodyScroll();
  const rows = Array.from({ length: count }, (_, i) => {
    const rank = i + 1;
    const strength = 1 + (count - rank); // 강함 = 1 + 우세수(아래 순위 수)
    const weakness = rank; // 약함 = 1 + 열세수(위 순위 수) = k
    return { rank, win: 2 * strength, loss: -weakness };
  });

  return createPortal(
    // 바깥(딤) 클릭으로 닫는다 — 단순 안내 모달이라 가볍게 닫혀도 된다.
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-modal-weight" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>{modeLabel} 점수 가중치</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <p className="scr-weight-desc">
            가중치를 뺀 순수 순위 기준입니다. 센 상대(위 순위)를 이길수록 크게 얻고,
            약한 상대(아래 순위)에게 질수록 크게 잃습니다.
          </p>
          {count === 0 ? (
            <div className="scr-empty">아직 집계된 참가자가 없어요.</div>
          ) : (
            <table className="scr-weight-table">
              <thead>
                <tr>
                  <th className="scr-weight-col-rank">순위</th>
                  <th>이겼을 때</th>
                  <th>졌을 때</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rank}>
                    <td className="scr-weight-col-rank">{r.rank}위</td>
                    <td className="scr-weight-win scr-mono">+{r.win}</td>
                    <td className="scr-weight-loss scr-mono">{r.loss}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
