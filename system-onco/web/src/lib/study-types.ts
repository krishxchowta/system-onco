export type Point = [number, number, number];
export type Study = {
  id: string;
  source: string;
  shape: Point;
  spacing: Point;
  sequences: string[];
  has_reference: boolean;
};
export type Metrics = {
  volumes: Record<string, number>;
  centers: Record<string, Point | null>;
  center_of_mass: Point | null;
  confidence_score: number | null;
  confidence_kind: string;
  coordinate_space: "original_voxel";
};
export type Analysis = {
  metrics: Metrics;
  assets: Record<"segmentation" | "probability" | "gradcam", string>;
  model: string;
  model_revision: string;
  device: string;
  reference_dice?: Record<string, number | null>;
  heatmap_scope: string;
};
export type Job = {
  id: string;
  study_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  created_at: number;
  result?: Analysis;
  error?: string;
};
export type OverlayKind =
  "none" | "segmentation" | "reference" | "probability" | "gradcam";

const hostedBackend =
  "https://system-onco-api-494222534318.asia-south1.run.app";
const configuredBackend = (
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  (process.env.NODE_ENV === "production" ? hostedBackend : "")
).replace(/\/$/, "");

export function backendUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!configuredBackend) return path;
  const normalized = path.startsWith("/backend/")
    ? path.slice("/backend".length)
    : path;
  return `${configuredBackend}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(backendUrl(path), {
    signal: AbortSignal.timeout(60000),
    ...init,
    cache: "no-store",
  });
  const data = await response.json().catch(() => {
    throw new Error(
      "The local MRI service is unavailable. Start both services with npm run dev.",
    );
  });
  if (!response.ok)
    throw new Error(
      data.detail || data.error || "The local service is unavailable.",
    );
  return data as T;
}
