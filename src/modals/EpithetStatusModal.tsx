import { useEffect, useState } from "react";
import ModalHash from "../utils/modalHash";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "../components/common/Avatar";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";
import { simulateEpithets } from "../utils/useEpithets";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { cx } from "../utils/format";
import type { Epithet, EpithetClaimRow } from "../utils/statEpithet";
import type { Member } from "../types";

/* 칭호 시뮬레이션(요청) — 저장된 값이 아니라 지금 기록으로 계산을 돌려 보고, 한 사람이
 * 자격을 얻은 칭호 **전부**를 늘어놓는다. 통계 표는 배정 결과(한 사람에 하나)만 보여주므로,
 * "이 사람이 어떤 칭호들에 걸렸고 무엇을 다른 임자에게 내줬나"는 여기서만 보인다 —
 * 문턱·무게를 손볼 때 그 판단 재료가 되는 창이다.
 *
 * 서버에는 아무것도 안 올린다(simulateEpithets) — 현황 파악용이지 저장이 아니다(요청). */
export default function EpithetStatusModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const members = useAppStore((s) => s.members);

  const [result, setResult] = useState<{
    assigned: Map<string, Epithet>;
    claims: EpithetClaimRow[];
  } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let cancelled = false;
    const ids = members
      .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
      .map((m) => m.id);
    simulateEpithets(ids)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "계산하지 못했어요.");
          setResult({ assigned: new Map(), claims: [] });
        }
      });
    return () => { cancelled = true; };
    // 회원 목록은 세션 안에서 사실상 고정이다 — 열 때 한 번만 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = members.filter((m) => m.status !== "withdrawn" && m.status !== "suspended");
  const claimsBy = new Map<string, EpithetClaimRow[]>();
  (result?.claims ?? []).forEach((c) => {
    const list = claimsBy.get(c.memberId) ?? [];
    list.push(c);
    claimsBy.set(c.memberId, list);
  });
  /* 자격 많은 사람이 먼저 — 이 창의 물음이 "칭호가 어디에 몰리나"라, 몰린 사람부터 보여야
     문턱을 어디서 조일지가 읽힌다. */
  const listed: { member: Member; claims: EpithetClaimRow[]; got: Epithet | undefined }[] = active
    .map((m) => ({ member: m, claims: claimsBy.get(m.id) ?? [], got: result?.assigned.get(m.id) }))
    .sort((a, b) => (b.claims.length - a.claims.length)
      || a.member.nickname.localeCompare(b.member.nickname));

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <ModalHash hash="epithet-status" onClose={onClose} />
      <div className="scr-modal scr-epithet-status" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 시뮬레이션</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body scr-scroll">
          {err && <div className="scr-err">{err}</div>}
          {result === null ? (
            <div className="scr-empty"><Spinner size={18} /></div>
          ) : (
            <ul className="scr-epithet-status-list">
              {listed.map(({ member, claims, got }) => (
                <li className="scr-epithet-status-row" key={member.id}>
                  <div className="scr-epithet-status-who">
                    <Avatar member={member} size={28} />
                    <span className="scr-epithet-status-name">{member.nickname}</span>
                  </div>
                  {claims.length === 0 ? (
                    <span className="scr-epithet-status-none">칭호 없음</span>
                  ) : (
                    <ul className="scr-epithet-status-claims">
                      {claims.map((c) => {
                        // 실제로 받는 것은 배정 결과와 이름이 같은 딱 한 줄이다.
                        const won = got?.label === c.label;
                        return (
                          <li
                            key={c.label}
                            className={cx("scr-epithet-status-claim", won && "scr-epithet-status-claim-got")}
                          >
                            <span className="scr-epithet-status-label">
                              {won && "👑 "}{c.label}
                            </span>
                            <span className="scr-epithet-status-why">{c.why}</span>
                          </li>
                        );
                      })}
                    </ul>
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
