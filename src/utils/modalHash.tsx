import { useEffect, useRef } from "react";

/* ── 모달 해시(요청) — 컨펌·얼럿을 뺀 모든 모달이 주소 해시를 얹는다 ────────────────
   열릴 때 #고유값(게임 상세는 게임 번호, 너나와는 그 id, 회원 정보는 회원 pk …)을
   pushState로 얹어 두면:
   · 뒤로가기 = 그 모달 닫기(주소가 먼저 돌아가고, popstate에서 닫는다)
   · 닫기 버튼 = 얹었던 해시 한 칸 되돌리기(history.back) — 주소와 화면이 늘 같이 간다
   · 모달 위 모달(중첩)도 해시가 층층이 쌓여 뒤로가기가 한 겹씩 벗긴다
   앞으로가기 재열기는 해시를 해석할 자료가 있는 호스트(활동 상세 등)가 hashchange로
   따로 잇는다 — 폼처럼 반쯤 쓰다 만 상태는 되살릴 수 없어서 전부는 약속하지 않는다.

   쓰는 법 — 모달 JSX 루트 안에 한 줄:
     <ModalHash hash={`member-${member.id}`} onClose={onClose} />
   (조건부 렌더 속에서도 안전하게 훅이 돌도록 컴포넌트로 감쌌다.) */

/* StrictMode(개발)는 마운트→정리→재마운트를 일부러 한 번 더 돈다 — 정리에서 곧장
 * history.back()을 쏘면 그 비동기 복원이 재마운트 '뒤'에 도착해, 방금 연 모달을
 * popstate가 닫아 버렸다(지적: 모든 모달이 열렸다 바로 닫힘). 복원을 잠깐 유예해 두고,
 * 같은 해시가 곧바로 다시 마운트되면 복원을 취소하는 것으로 재마운트를 삼킨다. */
const pendingRestore = new Map<string, number>();

export function useModalHash(hash: string, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const tag = `#${hash}`;
    const pending = pendingRestore.get(hash);
    if (pending !== undefined) {
      // 재마운트 — 방금 예약된 주소 복원을 취소하는 것이 곧 '다시 얹기'다.
      window.clearTimeout(pending);
      pendingRestore.delete(hash);
    } else if (window.location.hash !== tag) {
      // 앞으로가기로 이미 해시가 서 있으면(재열림) 또 얹지 않는다 — 두 겹이 되면
      // 뒤로가기가 두 번 필요해진다.
      window.history.pushState({ scrModal: hash }, "", tag);
    }
    let closedByPop = false;
    const onPop = () => {
      // 내 해시가 걷혔다 — 뒤로가기(또는 앞으로가기로 딴 데 감)다. 화면도 닫는다.
      if (window.location.hash !== tag) {
        closedByPop = true;
        closeRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // X·저장 등 화면 쪽 닫기 — 얹은 해시가 아직 주소에 있으면 한 칸 되돌려 주소를
      // 화면과 맞춘다. 되돌리기는 위 유예를 거친다(StrictMode 재마운트 삼키기).
      if (!closedByPop && window.location.hash === tag) {
        pendingRestore.set(hash, window.setTimeout(() => {
          pendingRestore.delete(hash);
          if (window.location.hash === tag) window.history.back();
        }, 60));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
}

/** 조건부 JSX 안에서도 쓰는 래퍼 — 모달 루트에 심는다. */
export default function ModalHash({ hash, onClose }: { hash: string; onClose: () => void }) {
  useModalHash(hash, onClose);
  return null;
}
