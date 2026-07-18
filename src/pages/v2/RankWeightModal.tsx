import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { Member } from "../../types";

interface RankWeightModalProps {
  // 가중치 계산 전 우위(우세수−열세수)가 높은 순으로 정렬된 실제 참가자들(요청).
  members: Member[];
  // "개인전" | "팀전" — 표 제목에 붙여 어느 쪽 기준인지 알려준다.
  modeLabel: string;
  onClose: () => void;
}

// 순위표 링크로 여는 "점수 가중치" 모달 — 지금 순위에 든 실제 유저를 우위 순으로 늘어놓고,
// 그 자리(순위)에 따른 "이기면/지면 몇 점"을 표로 보여준다(요청). 점수는 각자의 들쭉날쭉한
// 실제 전적이 아니라 '순수 우위 자리'로 매긴다 — 그래야 위→아래로 이겼을 때 점수는 쭉 줄고,
// 졌을 때 점수는 쭉 커진다. N명 기준 위에서 k번째 자리:
//   강함 = 1 + (N-k) 우세수  →  이겼을 때 = +2·강함 = +2(N-k+1)
//   약함 = 1 + (k-1) 열세수 = k  →  졌을 때 = -1·약함 = -k
// → 센 사람(위)을 이길수록 크게 얻고, 약한 사람(아래)에게 질수록 크게 잃는다.
export default function RankWeightModal({ members, modeLabel, onClose }: RankWeightModalProps) {
  useLockBodyScroll();
  const n = members.length;

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
            우위(우세−열세) 순으로 세운 참가자입니다. 위쪽(센 상대)을 이길수록 크게 얻고,
            아래쪽(약한 상대)에게 질수록 크게 잃습니다.
          </p>
          {n === 0 ? (
            <div className="scr-empty">아직 집계된 참가자가 없어요.</div>
          ) : (
            <table className="scr-weight-table">
              <thead>
                <tr>
                  <th className="scr-weight-col-user">유저</th>
                  <th>이겼을 때</th>
                  <th>졌을 때</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => {
                  const win = 2 * (n - i); // 위에서 i번째(k=i+1) 자리: +2·강함 = 2(N-k+1) = 2(N-i)
                  const loss = -(i + 1); // -1·약함 = -k = -(i+1)
                  return (
                    <tr key={m.id}>
                      <td className="scr-weight-col-user">
                        <span className="scr-weight-user">
                          <span className="scr-weight-rank">{i + 1}</span>
                          <Avatar member={m} size={22} />
                          <span className="scr-weight-name">{m.nickname}</span>
                        </span>
                      </td>
                      <td className="scr-weight-win scr-mono">+{win}</td>
                      <td className="scr-weight-loss scr-mono">{loss}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
