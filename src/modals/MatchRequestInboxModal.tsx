import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { playMailChime } from "../utils/sfx";
import type { MatchRequestInboxItem } from "../types";

interface MatchRequestInboxModalProps {
  items: MatchRequestInboxItem[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 "결투 신청 언급" 알림 팝업 — 내가 언급된 안 읽은 요청들을 한 번에 보여준다.
// 확인을 누르면(onClose) 서버에 읽음 처리돼 다시 뜨지 않는다(요청: "읽으면 다시 안 뜸").
export default function MatchRequestInboxModal({ items, onClose }: MatchRequestInboxModalProps) {
  useLockBodyScroll();
  // 뜨는 순간 우편 알림음(도전장 인박스와 같은 소리). 자동재생이 막힌 상황이면 조용히 무시된다.
  useEffect(() => { playMailChime(); }, []);

  if (items.length === 0) { onClose(); return null; }

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-mreq-inbox-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>🥺 결투 신청 알림</span>
        </div>
        <div className="scr-modal-body scr-mreq-inbox-body">
          <p className="scr-mreq-inbox-lead">누군가 당신을 결투 신청에 언급했어요!</p>
          <ul className="scr-mreq-inbox-list">
            {items.map((it) => (
              <li key={it.requestId} className="scr-mreq-inbox-item">
                <div className="scr-mreq-inbox-author">{it.author.nickname}님의 요청</div>
                <p className="scr-mreq-inbox-text">{it.text}</p>
                {it.mentioned.length > 0 && (
                  <div className="scr-mreq-inbox-mentioned">언급: {it.mentioned.map((m) => m.nickname).join(", ")}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="scr-form-actions">
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={onClose}>확인</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
