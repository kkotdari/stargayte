import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 현황(요청: 관리자 기능 — 지금 각 사람이 받은 칭호를 전체 리스트로).
 *
 * 서버에 저장된 한 벌(GET /activities/epithets)을 그대로 읽는다 — 통계 화면이 읽는 값과
 * 같은 자리라, 여기서 보이는 것이 곧 회원들이 보는 것이다. 다시 계산하지 않는다: 계산은
 * 경기 등록과 제어판의 '칭호 다시 계산'이 하는 일이고, 이 창은 그 결과를 훑는 자리다.
 *
 * 칭호 있는 사람이 먼저, 그 안에서는 닉네임순이다 — 이 창의 물음이 "누가 무엇을 받았고
 * 누가 못 받았나"라, 받은 무리와 빈 무리가 갈라져 있어야 한눈에 잡힌다. */
export default function EpithetStatusModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);

  const [rows, setRows] = useState<{ memberId: string; label: string; why: string }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    api.getEpithets()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "칭호를 불러오지 못했어요.");
          setRows([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const active = members.filter((m) => m.status !== "withdrawn" && m.status !== "suspended");
  const byId = new Map((rows ?? []).map((r) => [r.memberId, r]));
  const listed = active
    .map((m) => ({ member: m, epithet: byId.get(m.id) }))
    .sort((a, b) => (Number(!!b.epithet) - Number(!!a.epithet))
      || a.member.nickname.localeCompare(b.member.nickname));

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-epithet-status" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 현황</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body scr-scroll">
          {err && <div className="scr-err">{err}</div>}
          {rows === null ? (
            <div className="scr-empty"><Spinner size={18} /></div>
          ) : (
            <ul className="scr-epithet-status-list">
              {listed.map(({ member, epithet }) => (
                <li className="scr-epithet-status-row" key={member.id}>
                  <Avatar member={member} size={28} />
                  <span className="scr-epithet-status-name">{member.nickname}</span>
                  {epithet ? (
                    <span className="scr-epithet-status-what">
                      <span className="scr-epithet-status-label">{epithet.label}</span>
                      {/* 근거를 함께 적는다 — 이 창의 쓰임이 "왜 이 칭호가 나왔지"를 훑는
                          것이라, 통계 툴팁까지 안 가고 여기서 끝나야 한다. */}
                      {epithet.why && <span className="scr-epithet-status-why">{epithet.why}</span>}
                    </span>
                  ) : (
                    <span className="scr-epithet-status-none">칭호 없음</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
