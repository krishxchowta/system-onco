"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Plus, Upload, ArrowRight, RefreshCw } from "lucide-react";
import { Layout } from "./Layout";
import ClientObservationDeck from "./viewer/ClientObservationDeck";
import SynthesisPanel from "./report/SynthesisPanel";
import { api, type Study, type Job } from "@/lib/study-types";
import { useNeuroState } from "@/lib/neuro-state";

type Tab = "dashboard" | "datasets" | "pipeline";
type Health = { inference_available: boolean; device: string; model: string };
type Protocol = {
  steps: { step: string; details: string }[];
  model_revision: string;
  source: { repo: string; revision: string };
};
export default function StudyWorkspace() {
  const { setCrosshairTarget } = useNeuroState();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [studies, setStudies] = useState<Study[]>([]);
  const [selected, setSelected] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const study = studies.find((s) => s.id === selected);
  const current = jobs.find((j) => j.study_id === selected);
  const result = current?.status === "completed" ? current.result : undefined;
  const active = current?.status === "queued" || current?.status === "running";
  const hasActiveJobs = jobs.some(
    (j) => j.status === "running" || j.status === "queued",
  );
  useEffect(() => {
    setCrosshairTarget(null);
  }, [selected, setCrosshairTarget]);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const [catalog, jobList, service, steps] = await Promise.all([
        api<{ studies: Study[] }>("/backend/studies"),
        api<{ jobs: Job[] }>("/backend/jobs"),
        api<Health>("/backend/health"),
        api<Protocol>("/backend/protocol"),
      ]);
      if (!live.current) return;
      setStudies(catalog.studies);
      setJobs(jobList.jobs);
      setHealth(service);
      setProtocol(steps);
      setSelected((id) =>
        catalog.studies.some((s) => s.id === id)
          ? id
          : (catalog.studies[0]?.id ?? ""),
      );
      setError("");
    } catch (e) {
      if (live.current)
        setError(
          e instanceof Error
            ? e.message
            : "Unable to reach the local MRI service.",
        );
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<{ jobs: Job[] }>("/backend/jobs");
        if (!disposed) {
          setJobs((old) =>
            data.jobs.map(
              (j) =>
                old.find(
                  (previous) =>
                    previous.id === j.id && previous.status === "completed",
                ) ?? j,
            ),
          );
          setError("");
        }
      } catch {
        if (!disposed)
          setError(
            "Connection interrupted. Retrying the local analysis service…",
          );
      }
      if (!disposed) timer = setTimeout(poll, 2000);
    };
    if (hasActiveJobs) timer = setTimeout(poll, 1500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [hasActiveJobs]);
  async function run() {
    if (!study || busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await api<Job>(
        `/backend/studies/${encodeURIComponent(study.id)}/analyze`,
        { method: "POST" },
      );
      setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start analysis.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setError("");
    try {
      const imported = await api<Study>("/backend/studies/upload", {
        method: "POST",
        body: new FormData(form),
      });
      setStudies((s) => [...s, imported]);
      setSelected(imported.id);
      setShowUpload(false);
      setTab("dashboard");
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="app-shell">
      <header className="masthead">
        <a href="#workspace" className="wordmark">
          <span className="brand-mark">
            <Plus size={25} strokeWidth={3} />
          </span>
          SYSTEM.ONCO<span className="version">/ 01</span>
        </a>
        <span className="masthead-caption">Brain tumor segmentation</span>
        <span className="research-label">Research workspace</span>
      </header>
      <nav className="workspace-tabs" aria-label="Workspace sections">
        {(["dashboard", "datasets", "pipeline"] as Tab[]).map(
          (value, index) => (
            <button
              key={value}
              className={tab === value ? "is-active" : ""}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => {
                setTab(value);
                setShowUpload(false);
              }}
            >
              <span>0{index + 1}</span>
              {value === "datasets" ? "Data & preparation" : value}
              <ArrowRight size={16} />
            </button>
          ),
        )}
      </nav>
      <main id="workspace">
        {error && (
          <div className="service-error" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => void refresh()}>
              <RefreshCw size={16} />
              Retry connection
            </button>
          </div>
        )}
        <div hidden={tab !== "dashboard"}>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">MRI / Volumetric study</p>
              <h1>
                STUDY WORKSPACE<span className="accent-period">.</span>
              </h1>
            </div>
            <p className="dashboard-intro">Explore. Locate. Review.</p>
          </div>
          <div className="study-toolbar">
            <label>
              Current study
              <select
                aria-label="Current study"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={loading}
              >
                {studies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
            <span className="study-dimensions">
              {study ? `${study.shape.join(" × ")} voxels` : "Loading studies…"}
            </span>
            <button className="button" onClick={() => setShowUpload((v) => !v)}>
              <Upload size={16} />
              Upload MRI
            </button>
            <button
              className="button run-analysis"
              disabled={
                !study || !health?.inference_available || active || busy
              }
              onClick={() => void run()}
            >
              {busy
                ? "Starting…"
                : active
                  ? "Analyzing…"
                  : result
                    ? "Run again"
                    : "Analyze study"}
              <ArrowRight size={18} />
            </button>
          </div>
          {showUpload && (
            <form className="upload-panel" onSubmit={upload}>
              <h2>Upload an aligned MRI study</h2>
              <p>
                Choose the four NIfTI sequences from the same study. Files
                remain on this computer.
              </p>
              <div className="upload-grid">
                {["t1", "t1c", "t2", "flair"].map((s) => (
                  <label key={s}>
                    {s.toUpperCase()}
                    <input
                      name={s}
                      type="file"
                      required
                      accept=".nii,.nii.gz"
                    />
                  </label>
                ))}
              </div>
              <button type="submit" className="button" disabled={uploading}>
                {uploading ? "Validating study…" : "Import study"}
              </button>
            </form>
          )}
          {active && (
            <div className="analysis-progress" role="status">
              <span>{current.stage}</span>
              <progress value={current.progress} max={100} />
              <span>{current.progress}%</span>
            </div>
          )}
          {current?.status === "failed" && (
            <p className="service-error" role="alert">
              {current.error}
            </p>
          )}
          {study ? (
            <Layout
              observation={
                <ClientObservationDeck
                  key={study.id}
                  study={study}
                  result={result}
                  active={tab === "dashboard"}
                />
              }
              synthesis={
                <SynthesisPanel
                  key={`${study.id}-${current?.id ?? "pending"}`}
                  result={result}
                  running={!!active}
                />
              }
            />
          ) : (
            <div className="empty-study">
              {loading
                ? "Connecting to the study library…"
                : "No study available. Import the prepared samples or upload four MRI sequences."}
            </div>
          )}
        </div>
        {tab === "datasets" && (
          <section className="information-page">
            <p className="eyebrow">02 / Data & preparation</p>
            <h1>
              THE STUDY LIBRARY<span className="accent-period">.</span>
            </h1>
            <p className="information-intro">
              Complete volumetric studies with four aligned sequences. Select a
              case to inspect it in the dashboard.
            </p>
            <div className="table-wrap">
              <table>
                <caption>Available local MRI studies</caption>
                <thead>
                  <tr>
                    <th>Study</th>
                    <th>Source</th>
                    <th>Volume</th>
                    <th>Reference</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.source}</td>
                      <td>{s.shape.join(" × ")}</td>
                      <td>
                        {s.has_reference ? "Annotated mask" : "Not supplied"}
                      </td>
                      <td>
                        <button
                          className="table-action"
                          onClick={() => {
                            setSelected(s.id);
                            setTab("dashboard");
                          }}
                        >
                          View study <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <caption>Dataset and model references</caption>
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Use</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href="https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset"
                      >
                        BraTS 2023 · Hugging Face ↗
                      </a>
                    </td>
                    <td>
                      T1, T1c, T2, FLAIR and reference labels. Mirror lists CC
                      BY 4.0; retain original challenge terms.
                    </td>
                    <td>3 samples downloaded</td>
                  </tr>
                  <tr>
                    <td>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href="https://www.kaggle.com/datasets/awsaf49/brats20-dataset-training-validation"
                      >
                        BraTS 2020 · Kaggle ↗
                      </a>
                    </td>
                    <td>
                      Alternative volumetric dataset; use four aligned NIfTI
                      sequences through Upload MRI.
                    </td>
                    <td>Optional source · not downloaded</td>
                  </tr>
                  <tr>
                    <td>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href="https://huggingface.co/MONAI/brats_mri_segmentation/blob/main/docs/README.md"
                      >
                        MONAI SegResNet ↗
                      </a>
                    </td>
                    <td>
                      Pretrained 3D CNN. BraTS 2018 training. Apache 2.0 model.
                    </td>
                    <td>
                      {health?.inference_available
                        ? "Weights installed"
                        : "Weights unavailable"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <caption>Preparation protocol</caption>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Operation</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {protocol?.steps.slice(0, 3).map((row, i) => (
                    <tr key={row.step}>
                      <td>0{i + 1}</td>
                      <td>{row.step}</td>
                      <td>{row.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small-copy provenance">
              Source revision: {protocol?.source.revision}
            </p>
          </section>
        )}
        {tab === "pipeline" && (
          <section className="information-page">
            <p className="eyebrow">03 / Pipeline</p>
            <h1>
              FROM VOXEL
              <br />
              TO EVIDENCE<span className="accent-period">.</span>
            </h1>
            <p className="information-intro">
              {health?.model ?? "CNN"} ·{" "}
              {health?.device.toUpperCase() ?? "OFFLINE"} · four-channel input ·
              three tumor regions
            </p>
            <div className="table-wrap">
              <table>
                <caption>Analysis jobs</caption>
                <thead>
                  <tr>
                    <th>Study</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Whole-tumor Dice</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length ? (
                    jobs.map((j) => (
                      <tr key={j.id}>
                        <td>{j.study_id}</td>
                        <td>{j.status}</td>
                        <td>{j.error ?? j.stage}</td>
                        <td>
                          {j.result?.reference_dice?.["Whole Tumor"]?.toFixed(
                            3,
                          ) ?? "—"}
                        </td>
                        <td>
                          {j.result ? (
                            <a href={j.result.assets.segmentation} download>
                              Download mask ↓
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        No analysis jobs yet. Choose a study and run the CNN.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <caption>What the pipeline actually does</caption>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Operation</th>
                  </tr>
                </thead>
                <tbody>
                  {protocol?.steps.map((row) => (
                    <tr key={row.step}>
                      <td>{row.step}</td>
                      <td>{row.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small-copy provenance">
              Pinned model revision: {protocol?.model_revision}
            </p>
          </section>
        )}
      </main>
      <footer>
        <span>SYSTEM.ONCO / MRI research</span>
        <span>Model-assisted segmentation · clinician review required</span>
        <span>{health ? "Local service online" : "Local service offline"}</span>
      </footer>
    </div>
  );
}
