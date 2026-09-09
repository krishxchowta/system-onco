import { GoogleGenAI } from "@google/genai";
import { measuredReport, type ReportData } from "@/lib/report";
import type { Metrics, Point } from "@/lib/study-types";
export const runtime = "nodejs";
const names = [
  "Tumor Core",
  "Whole Tumor",
  "Enhancing Tumor",
  "Non-enhancing Core",
  "Edema",
];
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
function point(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 3 && p.every(finite);
}
function parseMetrics(value: unknown): Metrics | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const raw = (input.metrics ?? input) as Record<string, unknown>;
  if (
    !raw ||
    typeof raw !== "object" ||
    !raw.volumes ||
    typeof raw.volumes !== "object"
  )
    return null;
  const v = raw.volumes as Record<string, unknown>;
  if (names.some((k) => !finite(v[k]) || v[k] < 0)) return null;
  if (
    raw.confidence_score !== null &&
    (!finite(raw.confidence_score) ||
      raw.confidence_score < 0 ||
      raw.confidence_score > 100)
  )
    return null;
  const c = (raw.centers ?? {}) as Record<string, unknown>;
  return {
    volumes: Object.fromEntries(names.map((k) => [k, v[k]])) as Record<
      string,
      number
    >,
    centers: Object.fromEntries(
      names.map((k) => [k, point(c[k]) ? c[k] : null]),
    ),
    center_of_mass: point(raw.center_of_mass) ? raw.center_of_mass : null,
    confidence_score: raw.confidence_score as number | null,
    confidence_kind: "mean sigmoid probability; not diagnostic confidence",
    coordinate_space: "original_voxel",
  };
}
const textPair = (v: unknown, a: string, b: string) =>
  !!v &&
  typeof v === "object" &&
  typeof (v as Record<string, unknown>)[a] === "string" &&
  typeof (v as Record<string, unknown>)[b] === "string";
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 16000)
    return Response.json(
      { error: "Metrics payload too large." },
      { status: 413 },
    );
  let metrics: Metrics | null;
  try {
    metrics = parseMetrics(JSON.parse(text));
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!metrics)
    return Response.json(
      {
        error:
          "Provide valid named region volumes, voxel centers, and a probability between 0 and 100 (or null).",
      },
      { status: 400 },
    );
  const fallback = measuredReport(metrics);
  if (!process.env.GEMINI_API_KEY)
    return Response.json({ report: fallback, source: "Measured summary" });
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: JSON.stringify(metrics),
      config: {
        httpOptions: { timeout: 30000 },
        temperature: 0.1,
        responseMimeType: "application/json",
        systemInstruction:
          "Summarize these 3D CNN segmentation measurements in clinical and patient language. They are research results, not a diagnosis. Never invent findings, location names, grade, symptoms, treatments or diagnostic confidence. Explain uncertainty. Volumes are mm3; convert to mL by dividing by 1000. ET is nested in TC, which is nested in WT. Preserve region terms verbatim: Whole Tumor, Tumor Core, Enhancing Tumor. Recommend clinician review. Return clinical_view (findings, impression) and patient_view (summary, next_steps).",
        responseJsonSchema: {
          type: "object",
          required: ["clinical_view", "patient_view"],
          properties: {
            clinical_view: {
              type: "object",
              required: ["findings", "impression"],
              properties: {
                findings: { type: "string" },
                impression: { type: "string" },
              },
            },
            patient_view: {
              type: "object",
              required: ["summary", "next_steps"],
              properties: {
                summary: { type: "string" },
                next_steps: { type: "string" },
              },
            },
          },
        },
      },
    });
    const result = JSON.parse(response.text ?? "{}") as Partial<ReportData>;
    if (
      !textPair(result.clinical_view, "findings", "impression") ||
      !textPair(result.patient_view, "summary", "next_steps")
    )
      throw new Error("Invalid report format");
    // The server owns numeric confidence and coordinates, never the language model.
    return Response.json({
      report: {
        ...fallback,
        clinical_view: result.clinical_view,
        patient_view: result.patient_view,
      },
      source: "Gemini narrative · measured MRI data",
    });
  } catch {
    return Response.json({
      report: fallback,
      source: "Measured summary",
      notice: "Gemini narrative unavailable.",
    });
  }
}
