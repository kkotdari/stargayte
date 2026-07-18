import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { Member } from "../../types";

export interface WeightRow {
  member: Member;
  // 가중치 계산 전 우위(우세수−열세수) — 이 값이 큰 순으로 정렬된 채 넘어온다.
  superiority: number;
  // 이 유저를 이겼을 때(+2·강함) / 졌을 때(-1·약함) 얻거나 잃는 점수.
  win: number;
  loss: number;
}

interface RankWeightModalProps {
  // 순위 순서 그대로의 실제 참가자별 점수(요청: "1위 이게 아니라 실제 유저를 보여주라").
  rows: WeightRow[];
  // "개인전" | "팀전" — 표 제목에 붙여 어느 쪽 기준인지 알려준다.
  modeLabel: string;
  onClose: () => void;
}

// 순위표 링크로 여는 "점수 가중치" 모달 — 지금 순위에 든 실제 유저를, 가중치 계산 전 우위
// (우세수−열세수)가 높은 순으로 늘어놓고(요청), 그 사람을 이기면/지면 몇 점인지 표로 보여준다.
// 산식은 랭킹과 동일: 이김 +2·강함, 짐 -1·약함(강함=1+우세수, 약함=1+열세수). 순서는 최종
// 랭킹(가중 합산)과 다를 수 있다.
export default function RankWeightModal({ rows, modeLabel, onClose }: RankWeightModalProps) {
  useLockBodyScroll();

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
            각 유저를 이겼을 때/졌을 때 얻거나 잃는 점수입니다. 센 상대(위 순위)를 이길수록
            크게 얻고, 약한 상대(아래 순위)에게 질수록 크게 잃습니다.
          </p>
          {rows.length === 0 ? (
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
                {rows.map((r, i) => (
                  <tr key={r.member.id}>
                    <td className="scr-weight-col-user">
                      <span className="scr-weight-user">
                        <span className="scr-weight-rank">{i + 1}</span>
                        <Avatar member={r.member} size={22} />
                        <span className="scr-weight-name">{r.member.nickname}</span>
                      </span>
                    </td>
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
