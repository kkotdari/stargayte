import { Loader2 } from "lucide-react";

interface SpinnerProps {
  size?: number;
}

/** 버튼 안에서 도는 작은 고리 — "저장 중…"처럼 글자 옆에 서는 자리 전용이다.
 *  화면이나 목록이 통째로 기다리는 자리는 아래 LoadingMark(워드마크)를 쓴다(요청). */
export function Spinner({ size = 14 }: SpinnerProps) {
  return <Loader2 size={size} className="scr-spin" />;
}

/** 기다리는 동안 뜨는 워드마크 — 왼쪽부터 한 글자씩 켜졌다가 함께 사라지고 다시 시작한다.
 *
 *  글자마다 같은 애니메이션을 걸고 시작 시각만 어긋나게(animation-delay) 주면 왼쪽부터
 *  차례로 켜진다 — 자바스크립트 타이머가 없으니 기다림이 길어져도 부담이 없고, 무한
 *  반복이라 얼마나 걸릴지 몰라도 화면이 멈춘 것처럼 보이지 않는다.
 *
 *  full은 첫 진입(데이터 불러오는 중)처럼 화면을 통째로 비우고 기다리는 자리다. 목록
 *  안에서 기다리는 자리는 그 칸만큼만 쓰고 글자도 한 단계 작다. */
const BOOT_MARK = "STARGAYTE";
export function LoadingMark({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? "scr-boot" : "scr-loadmark"} role="status" aria-label="불러오는 중">
      <span className="scr-boot-mark" aria-hidden>
        {[...BOOT_MARK].map((ch, i) => (
          <span key={i} className="scr-boot-mark-ch" style={{ animationDelay: `${i * 0.11}s` }}>{ch}</span>
        ))}
      </span>
    </div>
  );
}
