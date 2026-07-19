import type { CSSProperties } from "react";
import { useImageSettings } from "../../context/ImageSettingContext";
import { RACE_INFO } from "../../constants/races";
import { cx } from "../../utils/format";
import type { Race } from "../../types";

// 종족 한 글자 배지 — 알파벳 대문자로(요청: "닉네임이 한글이라 그래야 대비가 됨" — 한글
// 닉네임 옆/위에서 한글 글자 배지보다 라틴 대문자가 더 또렷이 구분된다).
const RACE_LETTER: Record<Race, string> = { "테란": "T", "프로토스": "P", "저그": "Z", "랜덤": "R" };

interface RaceBadgeProps {
  race: Race | "";
  size?: number;
  // true면 운영자가 설정한 아이콘(이미지/이모지)을 무시하고 항상 종족 이름 전체
  // (테란/프로토스/저그/랜덤)를 색 글자로 보여준다 — 경기결과/전적통계 카드처럼
  // 아이콘 없이 빠르게 읽혀야 하는 자리에서 쓴다.
  asText?: boolean;
  // 경기결과 화면 전용 — 종족마다 다른 색 대신 기본 글자색 하나로 통일한다(화려하게
  // 꾸민 느낌을 걷어내 달라는 피드백 — 종족은 텍스트/아이콘 자체로 이미 구분되니 색까지
  // 다를 필요가 없다). 랭킹 등 다른 화면의 RaceBadge는 그대로 종족색을 쓴다.
  plain?: boolean;
  // 경기결과 v2 전용 — 운영자가 설정한 아이콘 대신 항상 영문 첫 글자(T/P/Z/R)만, 배경
  // 없이 종족 고유색 글자로 보여준다.
  circleLetter?: boolean;
  className?: string;
}

// 종족 표시 — 운영자가 설정한 아이콘(텍스트/이모지 또는 이미지)을 그대로 렌더링
export default function RaceBadge({ race, size = 26, asText, plain, circleLetter, className }: RaceBadgeProps) {
  const icons = useImageSettings();
  if (!race) return null;
  const color = plain ? "var(--text)" : RACE_INFO[race].color;
  if (circleLetter) {
    // 프사 위에 걸치는 작은 배지 — 배경/원 없이 종족 고유색(테란 파랑/프로토스 노랑/저그
    // 보라) 글자만 두고, 어떤 아바타 위에서도 읽히도록 어두운 테두리(text-shadow)만 준다.
    return (
      <span
        className={cx("scr-race-badge", "scr-race-badge-letter", className)}
        style={{ fontSize: Math.max(9, size * 0.5), color: RACE_INFO[race].color }}
        title={race}
      >
        {RACE_LETTER[race]}
      </span>
    );
  }
  if (asText) {
    // 아이콘 박스(고정 정사각 크기)와 달리 텍스트는 종족마다 글자 수가 다르다(테란/저그
    // 2자, 프로토스 4자) — 폭은 이 컴포넌트가 아니라 호출부의 그리드 칸(고정폭)이
    // 책임지고, 여기선 그 칸 안에서 중앙 정렬되는 순수 텍스트만 그린다.
    return (
      <span className="scr-race-badge scr-race-badge-text" style={{ color }} title={race}>
        {race}
      </span>
    );
  }
  const icon = icons[race];
  const style: CSSProperties = {
    ["--rc" as string]: color,
    width: size,
    height: Math.round(size * 0.86),
    fontSize: Math.max(10, size * 0.5),
  };
  const isImage = icon.type === "image" && !!icon.value;
  return (
    <span className={cx("scr-race-badge", isImage && "scr-race-badge-imgtype")} style={style} title={race}>
      {isImage
        ? <span className="scr-race-badge-img" style={{ backgroundImage: `url(${icon.value})` }} />
        : (icon.value || race[0])}
    </span>
  );
}
