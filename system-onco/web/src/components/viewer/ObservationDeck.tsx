"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Scan } from "lucide-react";
import { SectionLabel } from "@/components/SectionLabel";
import {
  backendUrl,
  type Study,
  type Analysis,
  type OverlayKind,
} from "@/lib/study-types";
import NiivueCanvas, {
  type NiivueCanvasHandle,
  type ViewerMode,
  type VoxelLocation,
} from "./NiivueCanvas";

export type ObservationProps = {
  study: Study;
  result?: Analysis;
  active: boolean;
};
const modes: [ViewerMode, string][] = [
  ["render", "3D render"],
  ["multiplanar", "Multi"],
  ["axial", "Axial"],
  ["coronal", "Coronal"],
  ["sagittal", "Sagittal"],
];
export default function ObservationDeck({
  study,
  result,
  active,
}: ObservationProps) {
  const canvas = useRef<NiivueCanvasHandle>(null);
  const [mode, setMode] = useState<ViewerMode>("render");
  const [sequence, setSequence] = useState("t1c");
  const [overlay, setOverlay] = useState<OverlayKind>("none");
  const [opacity, setOpacity] = useState(0.65);
  const [crosshair, setCrosshair] = useState(true);
  const [location, setLocation] = useState<VoxelLocation>({
    vox: [0, 0, 0],
    mm: [0, 0, 0],
    intensity: null,
  });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [axis, setAxis] = useState(2);
  const [level, setLevel] = useState(0.5);
  const [cut, setCut] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [retry, setRetry] = useState(0);
  const handleStatus = useCallback((value: string, message?: string) => {
    setStatus(value);
    setError(message ?? "");
  }, []);
  const handleLocation = useCallback(
    (value: VoxelLocation) => setLocation(value),
    [],
  );
  const volumeUrl = backendUrl(
    `/backend/studies/${encodeURIComponent(study.id)}/volume/${sequence}`,
  );
  const overlayUrl =
    overlay === "reference"
      ? backendUrl(
          `/backend/studies/${encodeURIComponent(study.id)}/volume/reference`,
        )
      : overlay === "none"
        ? undefined
        : result?.assets[overlay]
          ? backendUrl(result.assets[overlay])
          : undefined;
  useEffect(() => {
    if (result) setOverlay("segmentation");
  }, [result]);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (status !== "ready") return;
    if (mode === "render")
      canvas.current?.clip(cut, 1.7 - level * 3.4, azimuth, elevation);
    else canvas.current?.scan(axis, level);
  }, [level, axis, mode, cut, azimuth, elevation, status]);
  useEffect(() => {
    if (!playing || status !== "ready") return;
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      const elapsed = Math.min(now - last, 100);
      if (last) setLevel((v) => (v + elapsed / 18000) % 1);
      last = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, status]);
  const chooseMode = (next: ViewerMode) => {
    setPlaying(false);
    setMode(next);
    if (next === "axial") setAxis(2);
    if (next === "coronal") setAxis(1);
    if (next === "sagittal") setAxis(0);
  };
  return (
    <section aria-labelledby="observation-heading">
      <div className="panel-heading">
        <SectionLabel number="01" id="observation-heading">
          MRI explorer
        </SectionLabel>
        <Scan size={22} />
      </div>
      <div className="sequence-picker" aria-label="MRI sequence">
        {["t1", "t1c", "t2", "flair"].map((s) => (
          <button
            key={s}
            aria-pressed={s === sequence}
            onClick={() => {
              setPlaying(false);
              setSequence(s);
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="viewer-deck swiss-grid-pattern">
        <div className="viewer-stage">
          <NiivueCanvas
            key={retry}
            ref={canvas}
            volumeUrl={volumeUrl}
            overlayUrl={overlayUrl}
            overlayKind={overlay}
            opacity={opacity}
            crosshairVisible={crosshair}
            mode={mode}
            onLocationChange={handleLocation}
            onStatusChange={handleStatus}
          />
          {status === "loading" && (
            <div className="viewer-state" role="status">
              <span className="viewer-ticker">Loading MRI volume…</span>
            </div>
          )}
          {status === "error" && (
            <div className="viewer-state viewer-error" role="alert">
              <p>{error}</p>
              <button className="button" onClick={() => setRetry((v) => v + 1)}>
                Retry viewer
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="viewer-controls">
        <div className="viewer-mode-row">
          {modes.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              className={`viewer-mode-button ${mode === value ? "is-active" : ""}`}
              onClick={() => chooseMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="scan-deck">
          <div className="scan-title">
            <strong>
              {mode === "render" ? "3D cutaway scanner" : "Slice scanner"}
            </strong>
            <button
              className="icon-button"
              aria-label="Reset view"
              onClick={() => {
                setPlaying(false);
                setCut(false);
                setLevel(0.5);
                setAzimuth(0);
                setElevation(0);
                canvas.current?.reset();
              }}
            >
              <RotateCcw size={18} />
            </button>
          </div>
          {mode === "render" ? (
            <label className="check-control">
              <input
                type="checkbox"
                checked={cut}
                onChange={(e) => {
                  setCut(e.target.checked);
                  setPlaying(false);
                }}
              />
              Cut through the volume
            </label>
          ) : (
            <label>
              Scan direction{" "}
              <select
                aria-label="Scan direction"
                value={axis}
                onChange={(e) => setAxis(Number(e.target.value))}
              >
                <option value={0}>X · left / right</option>
                <option value={1}>Y · front / back</option>
                <option value={2}>Z · bottom / top</option>
              </select>
            </label>
          )}
          <div className="scan-range">
            <button
              className="icon-button"
              disabled={status !== "ready" || (mode === "render" && !cut)}
              aria-label={playing ? "Pause scan" : "Play scan"}
              onClick={() => {
                if (!playing && mode !== "render")
                  setLevel(location.vox[axis] / (study.shape[axis] - 1));
                setPlaying((v) => !v);
              }}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <input
              aria-label={mode === "render" ? "Cutaway depth" : "Slice level"}
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={
                mode === "render"
                  ? level
                  : location.vox[axis] / (study.shape[axis] - 1)
              }
              disabled={mode === "render" && !cut}
              onChange={(e) => {
                setPlaying(false);
                const next = Number(e.target.value);
                setLevel(next);
                if (mode !== "render") canvas.current?.scan(axis, next);
              }}
            />
            <output>
              {mode === "render"
                ? `${Math.round(level * 100)}%`
                : `${Math.round(location.vox[axis]) + 1} / ${study.shape[axis]}`}
            </output>
          </div>
          {mode === "render" && cut && (
            <div className="oblique-controls">
              <label>
                Plane angle
                <input
                  type="range"
                  min="-180"
                  max="180"
                  value={azimuth}
                  onChange={(e) => setAzimuth(Number(e.target.value))}
                />
                <output>{azimuth}°</output>
              </label>
              <label>
                Plane tilt
                <input
                  type="range"
                  min="-90"
                  max="90"
                  value={elevation}
                  onChange={(e) => setElevation(Number(e.target.value))}
                />
                <output>{elevation}°</output>
              </label>
            </div>
          )}
          <p className="small-copy">
            {mode === "render"
              ? "Drag to orbit · scroll to zoom · tilt the cutting plane to explore oblique layers."
              : "Scroll over a slice or play a continuous sweep through the volume."}
          </p>
        </div>
        <div className="overlay-deck">
          <label>
            Overlay
            <select
              aria-label="Overlay"
              value={overlay}
              onChange={(e) => setOverlay(e.target.value as OverlayKind)}
            >
              <option value="none">None</option>
              <option value="segmentation" disabled={!result}>
                CNN segmentation
              </option>
              <option value="probability" disabled={!result}>
                Tumor probability
              </option>
              <option value="gradcam" disabled={!result}>
                Regional Grad-CAM
              </option>
              <option value="reference" disabled={!study.has_reference}>
                Dataset reference mask
              </option>
            </select>
          </label>
          <label className="opacity-control">
            Opacity
            <input
              aria-label="Overlay opacity"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={opacity}
              disabled={overlay === "none"}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <output>{Math.round(opacity * 100)}%</output>
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={crosshair}
              onChange={(e) => setCrosshair(e.target.checked)}
            />
            Crosshair
          </label>
        </div>
        {overlay === "gradcam" && (
          <p className="overlay-note">
            Regional attribution around tumor core; not a whole-volume
            explanation.
          </p>
        )}
        {overlay === "reference" && (
          <p className="overlay-note">
            Dataset annotation · not a CNN prediction.
          </p>
        )}
        <div className="voxel-hud">
          <span>X {location.vox[0].toFixed(0)}</span>
          <span>Y {location.vox[1].toFixed(0)}</span>
          <span>Z {location.vox[2].toFixed(0)}</span>
          <span>INT {location.intensity?.toFixed(1) ?? "—"}</span>
        </div>
      </div>
    </section>
  );
}
