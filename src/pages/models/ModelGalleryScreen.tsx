import { useEffect, useMemo, useState } from "react";
import { SHAPE_BUILDERS, SHAPE_GALLERY, ShapeIcon } from "../../components/replay/ReplayMotionPlayer";
import { withYaw, VIEW } from "../../utils/shapeOblique";

/* 자료실 > 모델링(요청) — 재생 화면의 3D 도형들을 큰 화면으로 살펴본다. 모두에게 열려
 * 있다(운영 아님). 전부 3D 빌더라 요잉(수평 시점)을 15도씩 돌려 볼 수 있고, 전투 갈래
 * 기호(2D)는 회전 없이 기호 그대로다. */
export default function ModelGalleryScreen() {
  const [kind, setKind] = useState(SHAPE_GALLERY[0]?.kind ?? "");
  const [yaw, setYaw] = useState<number>(VIEW.yawDeg);
  /* 자동 무한 회전(요청) — 무대가 저절로 부드럽게 돈다. 수동 버튼을 누르면 멈춰 그
     각도를 살펴볼 수 있고, '자동 회전'으로 다시 돌린다. */
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      // 탭 전환 등으로 프레임이 크게 벌어지면 그만큼 건너뛰지 않게 100ms로 자른다.
      const dt = Math.min(100, now - last);
      last = now;
      setYaw((y) => (y + dt * 0.03) % 360); // 30°/s — 한 바퀴 12초.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto]);
  const builder: (() => ReturnType<(typeof SHAPE_BUILDERS)[string]>) | undefined =
    Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, kind) ? SHAPE_BUILDERS[kind] : undefined;
  const faces = useMemo(
    () => (builder ? withYaw(yaw, () => builder()) : undefined),
    [builder, yaw],
  );
  return (
    <div className="scr-screen scr-model-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">모델링</h1>
      </div>
      <div className="scr-minimap-panel">
        <div className="scr-model-viewer">
          <div className="scr-model-stage">
            <ShapeIcon kind={kind} faces={faces} />
          </div>
          {builder ? (
            <div className="scr-model-controls">
              <button type="button" className="scr-btn scr-btn-sm" onClick={() => { setAuto(false); setYaw((y) => Math.round(y / 15) * 15 - 15); }}>⟲ 요잉 15°</button>
              <button
                type="button" className="scr-btn scr-btn-sm"
                onClick={() => setAuto((a) => !a)}
              >
                {auto ? "❚❚ 멈춤" : "▶ 자동 회전"}
              </button>
              <button type="button" className="scr-btn scr-btn-sm" onClick={() => { setAuto(false); setYaw((y) => Math.round(y / 15) * 15 + 15); }}>요잉 15° ⟳</button>
              <span className="scr-model-yaw">{Math.round(((yaw % 360) + 360) % 360)}°</span>
            </div>
          ) : (
            <div className="scr-model-note">전투 갈래 기호는 2D 기호라 회전이 없어요.</div>
          )}
        </div>
        <div className="scr-model-gallery">
          {SHAPE_GALLERY.map(({ kind: k, label }) => (
            <button
              key={k} type="button"
              className={k === kind ? "scr-model-item scr-model-item-on" : "scr-model-item"}
              onClick={() => { setKind(k); setYaw(VIEW.yawDeg); setAuto(true); }}
            >
              <span className="scr-model-thumb"><ShapeIcon kind={k} /></span>
              <span className="scr-model-label">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
