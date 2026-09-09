import type { Metrics, Point } from "./study-types";
export type ReportData = {
  confidence_score: number | null;
  clinical_view: { findings: string; impression: string };
  patient_view: { summary: string; next_steps: string };
  interactive_keywords: { term: string; coordinate_target: Point }[];
};
export function measuredReport(metrics: Metrics): ReportData {
  const volume = (name: string) => (metrics.volumes[name] / 1000).toFixed(1);
  const present = metrics.volumes["Whole Tumor"] > 0;
  return {
    confidence_score: metrics.confidence_score,
    clinical_view: {
      findings: `Automated segmentation estimates Whole Tumor at ${volume("Whole Tumor")} mL, Tumor Core at ${volume("Tumor Core")} mL, and Enhancing Tumor at ${volume("Enhancing Tumor")} mL. These nested regions must not be added together.`,
      impression: present
        ? "The CNN identified candidate tumor regions. Review the source sequences and segmentation boundaries. Segmentation alone cannot establish diagnosis, grade, or treatment."
        : "No voxels crossed the model threshold. This result does not exclude a tumor; review the source MRI.",
    },
    patient_view: {
      summary: present
        ? `The software marked areas of this MRI for closer review. The overall marked area (Whole Tumor) measures approximately ${volume("Whole Tumor")} mL. This is a computer estimate, not a confirmed diagnosis.`
        : "The software did not mark a region above its threshold. A clinician still needs to review the MRI.",
      next_steps:
        "Ask your radiologist or treating clinician to compare these marked areas with the original scan and your medical history. The scan result alone does not determine treatment.",
    },
    interactive_keywords: Object.entries(metrics.centers).flatMap(
      ([term, point]) => (point ? [{ term, coordinate_target: point }] : []),
    ),
  };
}
