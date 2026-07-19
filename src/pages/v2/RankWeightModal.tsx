import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import type { Member } from "../../types";

export interface WeightRow {
  member: Member;
  // 순 우열(우세수−열세수) — 정렬 기준. 이 한 지표에서 강함/약함이 나온다.
  net: number;
  // 이 유저를 이겼을 때(+강함) / 졌을 때(−약함) 얻거나 잃는 점수.
  win: number;
  loss: number;
}

interface RankWeightModalProps {
  // 순 우열이 높은 순으로 정렬돼 넘어오는 실제 참가자별 점수.
  rows: WeightRow[];
  // "개인전" | "팀전" — 표 제목에 붙여 어느 쪽 기준인지 알려준다.
  modeLabel: string;
  // 팀전이면 점수 옆에 '/팀원수'를 붙인다 — 팀전은 각자 점수가 라인업 인원수로 나뉘기 때문(요청).
  isTeam?: boolean;
  onClose: () => void;
}

// 순위표 링크로 여는 "점수 가중치" 모달 — 지금 순위에 든 실제 유저를 '이기기 힘든 정도'
// (한 지표 = 순 우열 = 우세수−열세수)가 높은 순으로 세우고, 그 사람을 이기면/지면 몇 점인지
// 보여준다(요청). 강함 = 1 + max(0, 순우열), 약함 = 1 + max(0, −순우열)로, 이기면 +강함,
// 지면 −약함(순 승자에겐 −1 최소), 비기면 0. 실제 랭킹은 이 점수를 모든 경기에 합산한 값이다.
export default function RankWeightModal({ rows, modeLabel, isTeam, onClose }: RankWeightModalProps) {
  useLockBodyScroll();

  return createPortal(
    // 바깥(딤) 클릭으로 닫는다 — 단순 안내 모달이라 가볍게 닫혀도 된다.
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-modal-weight" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>{modeLabel} 기준점수표</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <p className="scr-weight-desc">
            승/패시 상대의 랭크에 비례하여 점수가 +/- 됩니다. 이 점수를 더한 것이 랭킹입니다.
            {isTeam && " 팀전은 여기에 팀의 전투력과 팀원수를 반영해서 계산합니다."}
          </p>
          {rows.length === 0 ? (
            <div className="scr-empty">아직 집계된 참가자가 없어요.</div>
          ) : (
            <table className="scr-weight-table">
              <thead>
                <tr>
                  <th className="scr-weight-col-user">유저</th>
                  <th>승리시</th>
                  <th>패배시</th>
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
                    <td className="scr-weight-win">+{r.win}</td>
                    <td className="scr-weight-loss">{r.loss}</td>
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
