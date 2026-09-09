"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SectionLabel } from "@/components/SectionLabel";
import { useNeuroState } from "@/lib/neuro-state";
import { measuredReport, type ReportData } from "@/lib/report";
import type { Analysis, Point } from "@/lib/study-types";

export function interactiveText(
  text: string,
  keywords: ReportData["interactive_keywords"],
  focus: (point: Point) => void,
) {
  const unique = [
    ...new Map(
      keywords
        .filter((k) => k.term.trim())
        .map((k) => [k.term.toLowerCase(), k]),
    ).values(),
  ].sort((a, b) => b.term.length - a.term.length);
  if (!unique.length) return text;
  const pattern = new RegExp(
    `(${unique.map((k) => k.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const lookup = new Map(unique.map((k) => [k.term.toLowerCase(), k]));
  return text.split(pattern).map((part, index) => {
    const keyword = lookup.get(part.toLowerCase());
    return keyword ? (
      <button
        key={index}
        className="keyword-anchor"
        onMouseEnter={() => focus(keyword.coordinate_target)}
        onFocus={() => focus(keyword.coordinate_target)}
        onClick={() => focus(keyword.coordinate_target)}
        title="Locate this region in the MRI"
      >
        {part}
      </button>
    ) : (
      part
    );
  });
}
export default function SynthesisPanel({
  result,
  running,
}: {
  result?: Analysis;
  running: boolean;
}) {
  const { setCrosshairTarget } = useNeuroState();
  const [view, setView] = useState<"clinical" | "patient">("clinical");
  const [report, setReport] = useState<ReportData | null>(
    result ? measuredReport(result.metrics) : null,
  );
  const [source, setSource] = useState("Measured summary");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!result) return;
    const controller = new AbortController();
    setReport(measuredReport(result.metrics));
    setSource("Measured summary");
    setNotice("");
    void fetch("/api/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metrics: result.metrics }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return body;
      })
      .then((body) => {
        setReport(body.report);
        setSource(body.source);
        setNotice(body.notice ?? "");
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setNotice("Narrative unavailable. Showing measured summary.");
      });
    return () => controller.abort();
  }, [result]);
  const score = result?.metrics.confidence_score;
  return (
    <section
      className="synthesis-panel swiss-noise"
      aria-labelledby="synthesis-heading"
    >
      <div className="panel-heading">
        <SectionLabel number="02" id="synthesis-heading">
          Study findings
        </SectionLabel>
        <span className="outline-tag">
          {result ? "Analyzed" : running ? "Analyzing" : "Ready to analyze"}
        </span>
      </div>
      <div className="score-block">
        <p className="eyebrow">Mean tumor probability</p>
        <div
          className={`score-value ${score != null && score < 75 ? "score-critical" : ""}`}
        >
          {score == null ? "—" : score.toFixed(1)}
          <span>%</span>
        </div>
        <p className="small-copy">
          {result
            ? "Average model probability inside the whole-tumor region. This is not diagnostic accuracy."
            : "Run analysis to locate and measure candidate tumor regions."}
        </p>
      </div>
      {result && (
        <div className="region-metrics">
          {["Whole Tumor", "Tumor Core", "Enhancing Tumor"].map((name) => (
            <div key={name}>
              <button
                className="keyword-anchor"
                disabled={!result.metrics.centers[name]}
                onClick={() => {
                  const point = result.metrics.centers[name];
                  if (point) setCrosshairTarget([...point]);
                }}
                onMouseEnter={() => {
                  const point = result.metrics.centers[name];
                  if (point) setCrosshairTarget([...point]);
                }}
              >
                {name}
              </button>
              <strong>
                {(result.metrics.volumes[name] / 1000).toFixed(1)}
                <small> mL</small>
              </strong>
            </div>
          ))}
        </div>
      )}
      <div className="report-block report-runtime">
        <div className="subsection-heading">
          <h3>Interpretation</h3>
          <ArrowUpRight size={18} />
        </div>
        {report ? (
          <>
            <div
              className="view-toggle"
              role="group"
              aria-label="Report audience"
            >
              {(["clinical", "patient"] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  className={view === v ? "is-active" : ""}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="report-copy">
              <p className="eyebrow">
                {view === "clinical" ? "Findings" : "What the scan shows"}
              </p>
              <p className="body-copy report-paragraph">
                {interactiveText(
                  view === "clinical"
                    ? report.clinical_view.findings
                    : report.patient_view.summary,
                  report.interactive_keywords,
                  (p) => setCrosshairTarget([...p]),
                )}
              </p>
              <p className="eyebrow report-subtitle">
                {view === "clinical" ? "Interpretation limits" : "Next steps"}
              </p>
              <p className="body-copy report-paragraph">
                {interactiveText(
                  view === "clinical"
                    ? report.clinical_view.impression
                    : report.patient_view.next_steps,
                  report.interactive_keywords,
                  (p) => setCrosshairTarget([...p]),
                )}
              </p>
            </div>
            <p className="small-copy">
              {source}
              {notice ? ` · ${notice}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="report-title">
              The scan comes first.
              <br />
              Evidence follows.
            </p>
            <p className="body-copy">
              {running
                ? "The CNN is processing this study. Results will appear here when analysis completes."
                : "Choose a study, explore its sequences, then select Analyze study."}
            </p>
          </>
        )}
      </div>
      {result && (
        <div className="result-downloads">
          <a href={result.assets.segmentation} download>
            Segmentation ↓
          </a>
          <a href={result.assets.gradcam} download>
            Grad-CAM ↓
          </a>
        </div>
      )}
      <div className="scope-note">
        <span aria-hidden="true">↳</span>
        <p>
          Research result. Review alongside the original MRI with a qualified
          clinician.
        </p>
      </div>
    </section>
  );
}
