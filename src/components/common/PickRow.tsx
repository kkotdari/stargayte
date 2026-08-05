import { cx } from "../../utils/format";

/** 낱말 몇 개를 늘어놓고 그중 하나를 고르는 줄 — 드롭다운도 알약탭도 아닌 세 번째 모양.
 *
 *  통계의 유형·종족·정렬 필터가 쓰던 것을 그대로 꺼내 왔다(요청: "활동 유형 필터를 통계의
 *  유형, 종족 필터처럼 나열선택형으로"). 항목이 서넛뿐이고 낱말이 짧을 때는 이게 제일
 *  좁다 — 드롭다운은 지금 값 하나만 보여주면서도 알약탭만큼 자리를 먹고, 무엇을 고를 수
 *  있는지는 열어 봐야 안다.
 *
 *  고른 것만 알약 라이팅(다크=흰 알약, 라이트=하늘 알약)으로 또렷하게 하고 나머지는
 *  흐리게 둔다 — 같은 화면의 알약탭과 같은 라이팅이라 "지금 켜진 것"의 생김새가 하나로
 *  읽힌다. */
export default function PickRow<T extends string>({ options, value, onChange, label, className }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** 스크린리더용 이 줄의 이름 — 화면에 보이는 이름표는 부르는 쪽이 따로 붙인다. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cx("scr-pickrow", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={cx("scr-pick", o.value === value && "scr-pick-on")}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
