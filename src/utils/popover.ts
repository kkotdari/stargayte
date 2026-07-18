import { computePosition, autoUpdate, flip, shift, size, offset } from "@floating-ui/dom";

interface PopoverOpts {
  // 트리거 너비와 정확히 같게 (검색 결과 목록처럼 칸에 딱 맞춰야 할 때)
  matchAnchor?: boolean;
  // 트리거보다 좁아지지 않되, maxWidth까지는 항상 그 폭으로 채운다(옵션 내용 길이와 무관).
  growFromAnchor?: boolean;
  // 트리거보다 좁아지지 않으면서, 옵션 중 가장 긴 내용의 실제 너비에 맞춰 자연스럽게
  // 넓어지고(growFromAnchor처럼 항상 maxWidth까지 꽉 채우지 않음), maxWidth는 그 상한으로만
  // 쓰인다 — 트리거 자체는 좁게 두고(예: 라벨 하나짜리 버튼) 옵션 글자 길이에 맞는
  // 드롭다운을 원할 때 쓴다.
  growToContent?: boolean;
  // 고정 최대폭 (달력 팝오버처럼 트리거 폭과 무관하게 일정한 폭을 쓸 때, growFromAnchor/
  // growToContent의 상한으로도 쓰임)
  maxWidth?: number;
}

const MARGIN = 8;

/*
  팝오버(드롭다운/달력 등)를 body에 포털링해서 열 때 위치를 직접 계산/추적하던 것을 손으로
  짠 코드로 하다 보니 "스크롤 중 흔들림", "리사이즈로 늦게 순간이동", "트리거가 화면 밖으로
  나가도 안 닫힘/안 따라옴" 같은 문제를 하나 고치면 다른 게 터지는 걸 반복했다 — 이건
  업계에서 이미 여러 해에 걸쳐 다듬어진 문제라 Floating UI(Popper.js 후속, Radix/Headless UI
  등이 내부적으로 쓰는 라이브러리)에 맡긴다.

  - flip: 아래 공간이 부족하면 자동으로 위로 뒤집는다.
  - shift: 좌우 경계(모달 안이면 모달 본문, 아니면 뷰포트) 안으로 밀어 넣는다.
  - size: 남는 공간에 맞춰 폭/최대높이를 계산한다(matchAnchor/growFromAnchor/maxWidth 반영). 최대높이는
    실제 가용 공간을 절대 넘지 않는 상한이라 — flip이 골라준 쪽 공간보다 커지는 일이 없다.
  - autoUpdate: 스크롤/리사이즈/컨텐츠 크기 변화를 전부 감지해서 트리거를 계속 따라가도록
    다시 계산한다 — 이게 이 라이브러리로 옮긴 핵심 이유다. 내부적으로 이미 성능 최적화가
    되어 있어 이전에 직접 짠 코드처럼 흔들리거나 늦게 튀지 않는다.

  트리거가 스크롤로 화면 밖까지 나가면 그냥 트리거를 따라 함께 화면 밖으로 나갈 뿐이고
  (다시 스크롤해 돌아오면 같이 돌아온다), 별도로 "닫기" 처리는 하지 않는다 — hide 미들웨어로
  스크롤 중 트리거가 아주 살짝만 가려져도 닫히는 오작동이 있었고, 애초에 autoUpdate가
  계속 따라가 주는데 굳이 닫을 이유가 없다.

  모달 안의 트리거라면 뷰포트가 아니라 모달의 스크롤 가능한 본문(.scr-modal-body) 영역을
  경계로 삼는다(본문을 못 찾으면 모달 카드 전체로 폴백) — 헤더는 스크롤과 무관하게 항상
  고정으로 보이는 영역이라, 팝오버가 그 위를 덮어버리면 안 된다.
*/
export function attachPopover(
  anchorEl: HTMLElement,
  floatingEl: HTMLElement,
  opts: PopoverOpts,
): () => void {
  const boundaryEl = (anchorEl.closest(".scr-modal-body") ?? anchorEl.closest(".scr-modal")) as HTMLElement | null;
  const boundary = boundaryEl ?? "clippingAncestors";

  const update = () => {
    computePosition(anchorEl, floatingEl, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [
        offset(4),
        flip({ boundary, padding: MARGIN }),
        shift({ boundary, padding: MARGIN }),
        size({
          boundary,
          padding: MARGIN,
          apply({ availableHeight, availableWidth, rects }) {
            // availableHeight보다 크게 잡으면(예전엔 minHeight를 하한으로 강제했었다) 화면
            // 경계를 넘어가 버린다 — flip이 이미 공간이 더 많은 쪽을 골라주니, 여기서는
            // 그 실제 가용 공간을 절대 넘지 않게 상한으로만 쓰고, 그래도 모자라면(달력이
            // 정말 안 들어갈 만큼 좁은 화면) 안쪽 스크롤(.scr-df-pop의 overflow-y)에 맡긴다.
            floatingEl.style.maxHeight = `${Math.max(80, availableHeight)}px`;

            if (opts.matchAnchor) {
              floatingEl.style.width = `${rects.reference.width}px`;
              return;
            }
            const capped = Math.min(opts.maxWidth ?? 280, availableWidth);
            if (opts.growToContent) {
              // width를 고정 px가 아니라 max-content로 둬서 실제 내용(가장 긴 옵션)
              // 너비만큼만 자연스럽게 차지하게 하고, min/max-width로 하한(트리거 폭)과
              // 상한(capped)만 못박는다.
              floatingEl.style.width = "max-content";
              floatingEl.style.minWidth = `${rects.reference.width}px`;
              floatingEl.style.maxWidth = `${capped}px`;
              return;
            }
            floatingEl.style.width = opts.growFromAnchor
              ? `${Math.max(rects.reference.width, capped)}px`
              : `${capped}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      floatingEl.style.position = "fixed";
      floatingEl.style.left = `${x}px`;
      floatingEl.style.top = `${y}px`;
      // 위치가 확정되기 전(computePosition은 비동기)에는 요소가 문서 흐름 끝의 엉뚱한
      // 자리에 잠깐 떴다가 튀어 "느리게 열리는" 것처럼 보였다 — 확정된 뒤에야 보이게 한다.
      // (초기 숨김은 호출부/CSS에서 visibility:hidden으로 잡아 두면 된다.)
      floatingEl.style.visibility = "visible";
    });
  };

  return autoUpdate(anchorEl, floatingEl, update);
}
