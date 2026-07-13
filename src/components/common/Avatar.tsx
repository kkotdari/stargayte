import { useState, type ReactNode } from "react";
import { cx, avatarColor } from "../../utils/format";

// 아바타에 필요한 최소 필드만 요구 (임시 미리보기 객체도 허용)
export interface AvatarMember {
  id: string;
  nickname: string;
  avatar: string | null;
}

interface AvatarProps {
  member?: AvatarMember | null;
  size?: number;
  className?: string;
  // 컴퓨터/비회원처럼 실제 회원이 아닌 슬롯을 프사 자리에 표시할 때 — 사진 없을 때와 같은
  // 점선 테두리 박스 안에 이 아이콘을 centered로 보여준다(member보다 우선한다).
  icon?: ReactNode;
}

// 16px 칩부터 84px 프로필 큰 사진까지 크기 차이가 커서, 고정 래디우스 하나로는 작을 때
// 사각형 느낌이 사라지거나 클 때 너무 둥글어진다 — size에 비례하게 계산한다. 경기결과
// 로스터처럼 아주 작은(24px 이하) 프사는 각진 느낌을 그대로 두고(예전 비율), 그보다 큰
// 프사(랭킹/전적통계/회원목록/프로필 등)만 더 둥글게 늘린다(실제로 지적받은 "너무 작은
// 경기결과를 제외하고 늘려달라").
function avatarRadius(size: number): number {
  if (size <= 24) return Math.max(1, Math.round(size * 0.12));
  return Math.min(14, Math.round(size * 0.22));
}

// 프로필 사진 (없으면 닉네임 첫 글자 + 고정 색상). 기본은 사각형으로 통일.
export default function Avatar({ member, size = 28, className, icon }: AvatarProps) {
  const radius = avatarRadius(size);
  // 사진 URL은 있는데 실제로 못 불러오면(만료/삭제된 파일 등) 브라우저가 깨진 이미지
  // 아이콘 대신 alt 텍스트(닉네임 전체)를 작은 박스 안에 그대로 욱여넣어 글자가 줄바꿈
  // 되며 깨져 보인다(실제로 지적받은 문제) — 로드 실패하면 사진이 아예 없던 것처럼
  // 닉네임 첫 글자 폴백으로 넘어간다.
  const [broken, setBroken] = useState(false);
  if (icon) {
    return (
      <span className={cx("scr-avatar", "scr-avatar-empty", className)} style={{ width: size, height: size, borderRadius: radius }}>
        {icon}
      </span>
    );
  }
  if (!member) {
    return (
      <span
        className={cx("scr-avatar", "scr-avatar-empty", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  if (member.avatar && !broken) {
    return (
      <img
        src={member.avatar}
        alt={member.nickname}
        className={cx("scr-avatar", className)}
        style={{ width: size, height: size, borderRadius: radius }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className={cx("scr-avatar", "scr-avatar-fallback", className)}
      style={{ width: size, height: size, fontSize: size * 0.44, background: avatarColor(member.id), borderRadius: radius }}
    >
      {member.nickname?.[0] ?? "?"}
    </span>
  );
}
