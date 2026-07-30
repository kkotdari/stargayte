import { Pause, Play, RotateCcw } from "lucide-react";
import { cx } from "../../utils/format";

// 요약을 훑어 가는 타임라인 — 스냅 하나가 요약 문장 하나다(요청).
//
// 눈금의 가로 위치는 그 문장이 말하는 시점(프레임)이라, 초반에 몰린 이야기와 한참 뒤의
// 이야기가 눈에 보이는 간격으로 갈린다. 반면 자동재생은 시점이 아니라 문장 단위로 넘어간다 —
// 실제 시간 비례로 넘기면 2분과 14분 사이에서 12분을 멈춰 있어야 하고, 그건 읽는 데 아무
// 도움이 안 된다.
//
// 시점을 모르는 문장(경기 전체를 두고 하는 말·맺음말)은 맨 끝에 놓는다. 그게 이야기 순서와
// 맞는 자리다 — 그런 문장은 늘 마지막에 온다.

// 1 프레임 = 0.042초(replayParser와 같은 상수).
const SECONDS_PER_FRAME = 0.042;

const mmss = (frame: number): string => {
  const sec = Math.round(frame * SECONDS_PER_FRAME);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

export interface StorySnap {
  /** 그 문장이 말하는 시점(프레임). 모르면 null — 맨 끝에 놓는다. */
  at: number | null;
}

/** 눈금의 가로 위치(0~1). 경기 길이를 모르면 고르게 늘어놓는다. */
export function snapPositions(snaps: StorySnap[], end: number | null): number[] {
  if (!end || end <= 0 || snaps.length === 0) {
    return snaps.map((_, i) => (snaps.length <= 1 ? 1 : i / (snaps.length - 1)));
  }
  return snaps.map((s) => (s.at === null ? 1 : Math.min(1, Math.max(0, s.at / end))));
}

export default function ReplayStoryTimeline({
  snaps, end, index, playing, finished, onSeek, onToggle,
}: {
  snaps: StorySnap[];
  end: number | null;
  index: number;
  playing: boolean;
  /** 마지막 스냅까지 다 지나갔나 — 그때 버튼은 '다시 보기'가 된다. */
  finished: boolean;
  onSeek: (i: number) => void;
  onToggle: () => void;
}) {
  const pos = snapPositions(snaps, end);
  const at = pos[index] ?? 0;
  const label = playing ? "멈추기" : finished ? "다시 보기" : "재생";

  return (
    <div className="scr-story-line">
      <button
        type="button" className="scr-story-play"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={label} title={label}
      >
        {playing ? <Pause size={13} /> : finished ? <RotateCcw size={13} /> : <Play size={13} />}
      </button>
      {/* 트랙 — 눈금 하나하나가 버튼이라 손으로 짚어 옮길 수 있다(요청: 수동 이동도 가능).
          화살표 키로도 옮긴다. */}
      <div
        className="scr-story-track" role="group" aria-label="경기 흐름"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          e.stopPropagation();
          onSeek(Math.min(snaps.length - 1, Math.max(0, index + (e.key === "ArrowRight" ? 1 : -1))));
        }}
      >
        <span className="scr-story-rail" aria-hidden />
        <span className="scr-story-fill" style={{ width: `${at * 100}%` }} aria-hidden />
        {snaps.map((s, i) => (
          <button
            key={i}
            type="button"
            className={cx("scr-story-snap", i === index && "scr-story-snap-on", i < index && "scr-story-snap-past")}
            style={{ left: `${pos[i] * 100}%` }}
            onClick={(e) => { e.stopPropagation(); onSeek(i); }}
            aria-label={`${i + 1}번째 장면${s.at === null ? "" : ` (${mmss(s.at)})`}`}
            aria-current={i === index}
          />
        ))}
      </div>
      {/* 지금 지점의 시각 — 눈금만으로는 몇 분 이야기인지 알 수 없다. */}
      <span className="scr-story-time">
        {snaps[index]?.at == null ? "끝" : mmss(snaps[index].at as number)}
      </span>
    </div>
  );
}
