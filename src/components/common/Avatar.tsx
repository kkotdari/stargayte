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

/* 프사는 어디서든 동그랗다 — 이 앱의 디자인 랭귀지이자 라이팅 테마의 한 요소다(요청).
   한때는 크기에 비례해 각진 래디우스를 계산했는데, 그러다 보니 쓰는 자리마다 CSS에서
   `border-radius: 50% !important`로 도로 덮는 규칙이 스물한 개까지 늘어났고, 새로 만든
   자리는(유저칩) 그 규칙을 빠뜨려 혼자 각진 채로 남았다. 규칙이 하나라면 빠뜨릴 자리도
   없다 — 컴포넌트가 원을 그리고, 덮어쓰던 규칙들은 전부 지웠다. */
const AVATAR_RADIUS = "50%";

// 프로필 사진 (없으면 닉네임 첫 글자 + 고정 색상). 모양은 늘 원이다(위 AVATAR_RADIUS).
export default function Avatar({ member, size = 28, className, icon }: AvatarProps) {
  const radius = AVATAR_RADIUS;
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
