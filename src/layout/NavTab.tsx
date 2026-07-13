import { cx } from "../utils/format";

interface NavTabProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export default function NavTab({ label, active, onClick }: NavTabProps) {
  return (
    <button className={cx("scr-nav-tab", active && "scr-nav-tab-active")} onClick={onClick}>
      {label}
    </button>
  );
}
