"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Niivue, type NiiVueLocation } from "@niivue/niivue";
import { useNeuroState } from "@/lib/neuro-state";
import type { Point } from "@/lib/study-types";

export type ViewerMode =
  "axial" | "coronal" | "sagittal" | "render" | "multiplanar";
export type VoxelLocation = { vox: Point; mm: Point; intensity: number | null };
export type NiivueCanvasHandle = {
  setViewMode: (mode: ViewerMode) => void;
  scan: (axis: number, fraction: number) => void;
  clip: (
    enabled: boolean,
    depth: number,
    azimuth: number,
    elevation: number,
  ) => void;
  reset: () => void;
};
type Props = {
  volumeUrl: string;
  overlayUrl?: string;
  overlayKind: string;
  opacity: number;
  crosshairVisible: boolean;
  mode: ViewerMode;
  onLocationChange: (value: VoxelLocation) => void;
  onStatusChange: (
    status: "loading" | "ready" | "error",
    message?: string,
  ) => void;
};

const NiivueCanvas = forwardRef<NiivueCanvasHandle, Props>(
  function NiivueCanvas(
    {
      volumeUrl,
      overlayUrl,
      overlayKind,
      opacity,
      crosshairVisible,
      mode,
      onLocationChange,
      onStatusChange,
    },
    ref,
  ) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const instance = useRef<Niivue | null>(null);
    const [generation, setGeneration] = useState(0);
    const { crosshairTarget } = useNeuroState();
    const controls = useRef({ opacity, crosshairVisible, mode });
    controls.current = { opacity, crosshairVisible, mode };
    const modes = (nv: Niivue, value: ViewerMode) =>
      ({
        axial: nv.sliceTypeAxial,
        coronal: nv.sliceTypeCoronal,
        sagittal: nv.sliceTypeSagittal,
        render: nv.sliceTypeRender,
        multiplanar: nv.sliceTypeMultiplanar,
      })[value];
    useImperativeHandle(
      ref,
      () => ({
        setViewMode(value) {
          const nv = instance.current;
          if (nv) nv.setSliceType(modes(nv, value));
        },
        scan(axis, fraction) {
          const nv = instance.current;
          const volume = nv?.volumes[0];
          if (!nv || !volume?.dims) return;
          const point = nv.frac2vox(nv.scene.crosshairPos);
          point[axis] = fraction * (volume.dims[axis + 1] - 1);
          nv.scene.crosshairPos = nv.vox2frac(point);
          nv.createOnLocationChange();
          nv.drawScene();
        },
        clip(enabled, depth, azimuth, elevation) {
          instance.current?.setClipPlanes(
            enabled ? [[depth, azimuth, elevation]] : [],
          );
        },
        reset() {
          const nv = instance.current;
          if (nv) {
            nv.scene.crosshairPos = [0.5, 0.5, 0.5];
            nv.setRenderAzimuthElevation(120, 15);
            nv.setClipPlanes([]);
            nv.createOnLocationChange();
            nv.drawScene();
          }
        },
      }),
      [],
    );

    useEffect(() => {
      let disposed = false;
      const element = canvas.current;
      if (!element) return;
      const nv = new Niivue({
        backColor: [0.949, 0.949, 0.949, 1],
        crosshairColor: [1, 0.188, 0, 1],
        crosshairWidth: 2,
        show3Dcrosshair: true,
        isColorbar: false,
        isOrientCube: false,
        clipPlaneColor: [1, 0.188, 0, 0.08],
        fontMinPx: 12,
        fontSizeScaling: 1,
      });
      instance.current = nv;
      onStatusChange("loading");
      nv.onLocationChange = (loc) => {
        if (disposed) return;
        const l = loc as NiiVueLocation;
        const value = l.values?.[0]?.value;
        onLocationChange({
          vox: Array.from(l.vox).slice(0, 3) as Point,
          mm: Array.from(l.mm).slice(0, 3) as Point,
          intensity:
            typeof value === "number" && Number.isFinite(value) ? value : null,
        });
      };
      void (async () => {
        try {
          await nv.attachToCanvas(element, true);
          if (disposed) return;
          await nv.loadVolumes([
            { url: volumeUrl, name: "MRI.nii.gz", colormap: "gray" },
          ]);
          if (disposed) return;
          nv.setSliceType(modes(nv, controls.current.mode));
          nv.setCrosshairWidth(controls.current.crosshairVisible ? 2 : 0);
          nv.setRenderAzimuthElevation(120, 15);
          nv.createOnLocationChange();
          setGeneration((v) => v + 1);
          onStatusChange("ready");
        } catch (error) {
          if (!disposed)
            onStatusChange(
              "error",
              error instanceof Error ? error.message : "Unable to open MRI.",
            );
        } finally {
          if (disposed) nv.cleanup();
        }
      })();
      return () => {
        disposed = true;
        instance.current = null;
        nv.onLocationChange = () => {};
        nv.cleanup();
      };
    }, [volumeUrl, onLocationChange, onStatusChange]);

    useEffect(() => {
      const nv = instance.current;
      if (!nv?.volumes[0]) return;
      let disposed = false;
      for (const volume of [...nv.volumes].slice(1)) nv.removeVolume(volume);
      if (overlayUrl)
        void (async () => {
          try {
            const overlay = await nv.addVolumeFromUrl({
              url: overlayUrl,
              name: "overlay.nii.gz",
              colormap:
                overlayKind === "gradcam" || overlayKind === "probability"
                  ? "hot"
                  : "red",
              opacity: controls.current.opacity,
              cal_min: 0,
              cal_max:
                overlayKind === "gradcam" || overlayKind === "probability"
                  ? 1
                  : 3,
            });
            if (disposed) {
              if (nv.volumes.includes(overlay)) nv.removeVolume(overlay);
              return;
            }
            nv.setOpacity(
              nv.volumes.indexOf(overlay),
              controls.current.opacity,
            );
          } catch {
            if (!disposed)
              onStatusChange(
                "error",
                "Overlay could not be loaded. Choose no overlay or retry.",
              );
          }
        })();
      return () => {
        disposed = true;
      };
    }, [generation, overlayUrl, overlayKind, onStatusChange]);
    useEffect(() => {
      const nv = instance.current;
      if (nv?.volumes[1]) nv.setOpacity(1, opacity);
    }, [opacity]);
    useEffect(() => {
      instance.current?.setCrosshairWidth(crosshairVisible ? 2 : 0);
    }, [crosshairVisible]);
    useEffect(() => {
      const nv = instance.current;
      if (nv?.volumes[0]) nv.setSliceType(modes(nv, mode));
    }, [mode]);
    useEffect(() => {
      const nv = instance.current;
      if (!nv?.volumes[0] || !crosshairTarget) return;
      nv.scene.crosshairPos = nv.vox2frac(crosshairTarget);
      nv.createOnLocationChange();
      nv.drawScene();
    }, [crosshairTarget, generation]);
    return (
      <canvas
        ref={canvas}
        className="viewer-canvas"
        aria-label="Interactive MRI: drag to rotate in 3D, scroll to scan slices"
      />
    );
  },
);
export default NiivueCanvas;
