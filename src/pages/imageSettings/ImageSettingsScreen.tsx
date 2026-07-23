import { useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Upload, Trash2, RotateCcw } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import PhotoViewer from "../../components/common/PhotoViewer";
import { RACE_OPTIONS, RACE_INFO } from "../../constants/races";
import { useAppStore } from "../../store/appStore";
import { resizeIconSlotImage } from "../../utils/image";
import type { ImageSetting, ImageSettingMap, IconSlot } from "../../types";

const ICON_TYPE_OPTS = [
  { value: "text", label: "텍스트 / 이모지" },
  { value: "image", label: "이미지 파일" },
];

interface IconPreviewProps {
  icon: ImageSetting;
  color: string;
}

// 텍스트/이모지는 예전처럼 작은 정사각 배지로. 이미지는 더 이상 그 배지 안에 잘라 넣지
// 않고, 원본 비율 그대로(가로/세로 최대값만 제한) 보여주고 클릭하면 크게 볼 수 있다.
function IconPreview({ icon, color }: IconPreviewProps) {
  const [zoomOpen, setZoomOpen] = useState(false);

  if (icon.type === "image" && icon.value) {
    return (
      <>
        <button type="button" className="scr-icon-preview-img-btn" onClick={() => setZoomOpen(true)} aria-label="이미지 크게 보기">
          <img src={icon.value} alt="" className="scr-icon-preview-img-full" />
        </button>
        {zoomOpen && <PhotoViewer src={icon.value} alt="" onClose={() => setZoomOpen(false)} />}
      </>
    );
  }

  const style: CSSProperties = { ["--rc" as string]: color, width: 52, height: 44, fontSize: 20 };
  return <span className="scr-race-icon-preview" style={style}>{icon.value || "?"}</span>;
}

interface IconValueFieldProps {
  icon: ImageSetting;
  onChangeValue: (value: string) => void;
  onError: (message: string) => void;
  // 종족 아이콘은 어디서든 정사각형에 가까운 작은 뱃지(15~18px)로만 쓰여서 기본값(128px)
  // 으로 충분하지만, 홈 로고는 로그인 화면 히어로 영역처럼 훨씬 크게(64px+, 레티나
  // 화면에선 실제 픽셀로 그 2~3배) 걸리는 데다 가로로 넓은 워드마크인 경우가 많다 —
  // "긴 변" 기준으로만 낮게 자르면 폭 대비 높이가 실제 표시 크기보다 작아져(예: 1200x200
  // 로고를 480px로 자르면 480x80) 흐리게 보인다. 로고는 화질이 훨씬 중요하므로 상한을
  // 넉넉히(1600px) 열어준다 — PNG 무손실 인코딩이라 해상도가 높아져도 손상은 없고, 로고
  // 특성상(단순한 그래픽) 파일 크기도 사진만큼 크게 늘지 않는다.
  maxSide?: number;
}

// 슬롯의 실제 값 입력 — 텍스트/이모지일 땐 그냥 입력칸, 이미지일 땐 URL을 직접 타이핑하는
// 대신 프로필 사진처럼 파일을 업로드해서(리사이즈 후 data URL로) 저장한다.
function IconValueField({ icon, onChangeValue, onError, maxSide }: IconValueFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (icon.type !== "image") {
    return (
      <input
        className="scr-input scr-input-sm"
        value={icon.value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder="예: T, ⚔️"
      />
    );
  }

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // 같은 파일을 삭제 후 다시 선택해도 change 이벤트가 발생하도록 매번 값을 비워둔다.
    e.target.value = "";
    if (!f) return;
    try {
      onChangeValue(await resizeIconSlotImage(f, maxSide));
    } catch {
      onError("이미지를 불러오지 못했어요.");
    }
  };

  return (
    <div className="scr-icon-upload">
      <button
        type="button"
        className="scr-icon-btn"
        onClick={() => fileRef.current?.click()}
        aria-label={icon.value ? "이미지 변경" : "이미지 선택"}
        title={icon.value ? "이미지 변경" : "이미지 선택"}
      >
        <Upload size={13} />
      </button>
      {icon.value && (
        <button type="button" className="scr-icon-btn scr-icon-btn-danger" onClick={() => onChangeValue("")} aria-label="이미지 삭제" title="이미지 삭제">
          <Trash2 size={13} />
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
    </div>
  );
}

interface SlotRowProps {
  label: string;
  color: string;
  icon: ImageSetting;
  dirty: boolean;
  onChange: (patch: Partial<ImageSetting>) => void;
  onReset: () => void;
  onError: (message: string) => void;
  maxSide?: number;
}

// 종족 아이콘이든 홈 로고든 편집 UI(미리보기/텍스트·이미지 전환/업로드/되돌리기)는 완전히
// 공용이라 행 하나로 통일해서 쓴다 — 파트마다 다른 건 라벨/미리보기 색뿐. 미리보기는 원본
// 비율 그대로 나올 수 있어(특히 가로로 긴 로고) 컨트롤 줄과 나란히 두지 않고 그 아래에 둔다.
function SlotRow({ label, color, icon, dirty, onChange, onReset, onError, maxSide }: SlotRowProps) {
  return (
    <div className="scr-icon-row">
      <span className="scr-icon-row-label">{label}</span>
      <div className="scr-icon-row-inputs">
        <Select
          size="sm"
          value={icon.type}
          options={ICON_TYPE_OPTS}
          onChange={(v) => onChange({ type: v as ImageSetting["type"], value: "" })}
        />
        <IconValueField icon={icon} onChangeValue={(value) => onChange({ value })} onError={onError} maxSide={maxSide} />
        <button
          type="button"
          className="scr-icon-btn"
          onClick={onReset}
          disabled={!dirty}
          aria-label={`${label} 되돌리기`}
          title="저장된 값으로 되돌리기"
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <IconPreview icon={icon} color={color} />
    </div>
  );
}

// 운영자 전용 — 화면에서 쓰는 이미지 파일 관리(종족 아이콘, 홈 로고 등). 코드관리 화면처럼
// 파트(그룹)별로 패널을 나눠 보여준다. 예전엔 종족 아이콘만 다루는 모달이었지만, 종족이
// 아닌 다른 이미지 슬롯(홈 로고)도 여기서 함께 관리하도록 넓혔다.
export default function ImageSettingsScreen() {
  const icons = useAppStore((s) => s.imageSettings);
  const updateImageSettings = useAppStore((s) => s.updateImageSettings);

  const [draft, setDraft] = useState<ImageSettingMap>(icons);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const update = (slot: IconSlot, patch: Partial<ImageSetting>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [slot]: { ...d[slot], ...patch } }));
  };

  // 텍스트↔이미지 전환 시 값을 비워서 생긴 "이전 값이 사라짐" 불편을 되돌릴 수 있게 —
  // 아직 저장 전(=서버에 남아있는 원래 값)이라면 그 값으로 즉시 복원한다.
  const isDirty = (slot: IconSlot) =>
    draft[slot].type !== icons[slot].type || draft[slot].value !== icons[slot].value;
  const resetSlot = (slot: IconSlot) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [slot]: icons[slot] }));
  };

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      await updateImageSettings(draft);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">이미지 설정</h1>
      </div>

      <div className="scr-code-groups">
        {/* (홈 로고 슬롯 관리는 제거 — 로고는 이제 정적 자산 + 회전 별(BrandLogo)이라
            운영자가 갈아끼울 일이 없다(요청). 백엔드 슬롯/스토어 코드는 그대로 두고
            편집 UI만 뺀다.) */}
        <div className="scr-admin-group-v2">
          <div className="scr-list-head">
            <span>종족 아이콘</span>
          </div>
          <div className="scr-race-icon-list">
            {RACE_OPTIONS.map((race) => (
              <SlotRow
                key={race}
                label={race}
                color={RACE_INFO[race].color}
                icon={draft[race]}
                dirty={isDirty(race)}
                onChange={(patch) => update(race, patch)}
                onReset={() => resetSlot(race)}
                onError={setErr}
              />
            ))}
          </div>
        </div>
      </div>

      {err && <div className="scr-err">{err}</div>}
      {saved && !err && <div className="scr-success">저장했어요.</div>}

      <div className="scr-form-actions">
        <button className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
          {busy ? <><Spinner /> 저장 중...</> : "저장"}
        </button>
      </div>
    </div>
  );
}
