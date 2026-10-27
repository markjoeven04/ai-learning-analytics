import { useState, useEffect, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import ExamQuestionsPanel from "../components/ExamQuestionsPanel";
import api from "../services/api";
import { useApi } from "../hooks/useApi";
import { useThresholds } from "../hooks/useThresholds";

// Competencies can be edited only before submission or after a rejection (locked once endorsed).
const EDITABLE_STAGES = ["draft", "rejected"];
const STEPS = ["course", "syllabus", "validate", "assessment", "csv", "mapping", "done"];
const STEP_LABELS = ["Create Course", "Upload Syllabus", "Review & Approval", "Create Assessment", "Upload CSV", "Review Mapping", "Complete"];
const STEP_DESCRIPTIONS = {
  course: "Define the course details before uploading materials.",
  syllabus: "Upload the syllabus — AI will extract competencies and topics automatically.",
  validate: "Edit the AI-extracted competencies, then submit them with the syllabus for approval. They are locked once endorsed.",
  assessment: "Define the assessment type and grading period for score tracking.",
  csv: "Upload a CSV of student scores to be mapped to competencies.",
  mapping: "Review how each question was mapped to a competency — approve or reassign.",
  done: "The course and assessment are set up and ready for analytics.",
};
const OCR_PHASES = [
  { key: "ocr", label: "OCR Text Extraction", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { key: "nlp", label: "NLP Topic Classification", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.346A3.001 3.001 0 0012 15a3 3 0 00-2.971 2.589l-.347-.346z" },
  { key: "risk", label: "Risk Classification Rules", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
];
const DRAFT_KEY = "ailas_wizard_draft";

function InfoTooltip({ text }) {
  return (
    <span className="group relative inline-flex items-center ml-1">
      <span className="text-gray-400 cursor-help text-xs leading-none rounded-full border border-gray-300 w-3.5 h-3.5 inline-flex items-center justify-center font-medium">?</span>
      <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 z-20 shadow-lg pointer-events-none w-48 text-center">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  );
}

function FileUploadZone({ file, onFile, accept, hint, id, maxMB }) {
  const [dragActive, setDragActive] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault(); setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div>
      <label htmlFor={id}
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
          dragActive ? "border-indigo-500 bg-indigo-100" : file ? "border-indigo-400 bg-indigo-50" : "border-gray-300 hover:border-indigo-300 hover:bg-gray-50"
        }`}
      >
        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        {file ? (
          <div className="text-center">
            <span className="text-sm text-indigo-700 font-medium block">{file.name}</span>
            <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onFile(null); }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors mt-1">× Remove file</button>
          </div>
        ) : (
          <>
            <span className="text-sm text-indigo-600 font-medium">Click or drag file here to upload</span>
            {hint && <span className="text-xs text-gray-400">{hint}</span>}
          </>
        )}
        <input type="file" id={id} accept={accept} className="hidden"
          onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
      </label>
      {maxMB && <p className="text-xs text-gray-400 mt-1">Max {maxMB} MB</p>}
    </div>
  );
}

function PhaseIndicator({ phases, activeIndex, done }) {
  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-4">
      <p className="text-xs text-indigo-400 mb-4 font-medium tracking-wide uppercase">AI Processing Pipeline · ~30–60 sec</p>

      {/* Horizontal stepper */}
      <div className="flex items-start">
        {phases.map((phase, i) => {
          const isActive = i === activeIndex && !done;
          const isDone = done || i < activeIndex;
          return (
            <div key={phase.key} className="flex items-start flex-1 min-w-0">
              {/* Step node */}
              <div className="flex flex-col items-center shrink-0">
                {/* Circle indicator */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isDone
                    ? "bg-indigo-500"
                    : isActive
                    ? "border-2 border-indigo-500 bg-white"
                    : "bg-gray-200"
                }`}>
                  {isDone ? (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isActive ? (
                    /* Spinner ring */
                    <svg className="w-4 h-4 text-indigo-500 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-gray-400 block" />
                  )}
                </div>
                {/* Step label below circle */}
                <div className="mt-2 text-center max-w-20 px-0.5">
                  <p className={`text-xs font-medium leading-tight ${
                    isDone ? "text-indigo-600" : isActive ? "text-indigo-700" : "text-gray-400"
                  }`}>{phase.label}</p>
                  {isActive && (
                    <p className="text-xs text-indigo-400 mt-0.5 animate-pulse">Processing…</p>
                  )}
                  {isDone && (
                    <p className="text-xs text-green-600 mt-0.5">Done</p>
                  )}
                </div>
              </div>

              {/* Connector line (skip after last step) */}
              {i < phases.length - 1 && (
                <div className={`flex-1 h-0.5 mt-4 mx-1 rounded-full transition-all duration-700 ${isDone ? "bg-indigo-400" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MappingReview({ assessmentId, courseId, onDone }) {
  const T = useThresholds();
  const { data: items, loading } = useApi(`/assessments/${assessmentId}/mapping-queue`);
  const { data: competencies } = useApi(`/syllabi/courses/${courseId}/competencies`);
  const [filterLow, setFilterLow] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [changedItems, setChangedItems] = useState(new Set());
  const [skipped, setSkipped] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [showApproveAllConfirm, setShowApproveAllConfirm] = useState(false);
  const [sortOrder, setSortOrder] = useState("asc");
  const [expandedQuestion, setExpandedQuestion] = useState(null);

  const pending = (items || []).filter(item => !skipped.has(item.id));
  const filtered = pending.filter(item => !filterLow || (item.confidence_score || 0) < T.mapping_review_threshold);
  const displayed = [...filtered].sort((a, b) => {
    const aS = a.confidence_score ?? 0; const bS = b.confidence_score ?? 0;
    return sortOrder === "asc" ? aS - bS : bS - aS;
  });
  const reviewedCount = (items?.length || 0) - pending.length;
  const reviewProgress = items?.length ? Math.round((reviewedCount / items.length) * 100) : 0;

  const handleApproveAll = async () => {
    setShowApproveAllConfirm(false); setSaving(true);
    try {
      for (const item of (items || [])) {
        if (!skipped.has(item.id)) {
          await api.put(`/assessments/items/${item.id}/tag?competency_id=${overrides[item.id] || item.mapped_competency_id}`);
        }
      }
      onDone();
    } finally { setSaving(false); }
  };

  const handleApprove = async (item) => {
    const compId = overrides[item.id] || item.mapped_competency_id;
    if (!compId) return;
    setSaving(true);
    try {
      await api.put(`/assessments/items/${item.id}/tag?competency_id=${compId}`);
      setSkipped(s => new Set([...s, item.id]));
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-3 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="flex gap-2">
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-24 ml-auto" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items?.length) {
    return (
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-8 text-center space-y-3">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-green-700 font-semibold">All items mapped with high confidence!</p>
        <p className="text-sm text-green-600">No manual review needed.</p>
        <button onClick={onDone} className="mt-2 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">Continue →</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-700">Topic Mapping Review</h2>
          <p className="text-xs text-gray-400 mt-0.5">{pending.length} items pending · approve or reassign each one</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSortOrder(s => s === "asc" ? "desc" : "asc")}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors">
            Confidence {sortOrder === "asc" ? "↑ Low first" : "↓ High first"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filterLow} onChange={e => setFilterLow(e.target.checked)} className="rounded" />
            Low confidence only
          </label>
          <button disabled={saving || pending.length === 0} onClick={() => setShowApproveAllConfirm(true)}
            className="bg-indigo-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            Approve All
          </button>
        </div>
      </div>

      {filterLow && (
        <div>
          <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 text-xs text-amber-700">
            Filtered: low confidence only (&lt;{Math.round(T.mapping_review_threshold * 100)}%)
            <button onClick={() => setFilterLow(false)} className="text-amber-400 hover:text-amber-700 ml-0.5 transition-colors">×</button>
          </span>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-400">
          <span>{reviewedCount} of {items.length} reviewed</span>
          <span>{reviewProgress}%</span>
        </div>
        <div className="bg-gray-200 rounded-full h-1.5">
          <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${reviewProgress}%` }} />
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {displayed.length === 0 && (
          <p className="text-gray-400 text-sm py-4 text-center">No items match the current filter.</p>
        )}
        {displayed.map(item => (
          <div key={item.id} className={`border-l-4 border rounded-lg p-3 space-y-2 shadow-sm hover:shadow-md transition-shadow duration-200 ${
            (item.confidence_score ?? 1) >= T.mapping_review_threshold ? "border-l-green-400 border-gray-200" : "border-l-amber-400 border-gray-200"
          }`}>
            <div>
              <p className={`text-sm text-gray-700 leading-snug ${expandedQuestion === item.id ? "" : "line-clamp-3"}`}>
                {item.question_text}
              </p>
              {(item.question_text || "").length > 120 && (
                <button onClick={() => setExpandedQuestion(expandedQuestion === item.id ? null : item.id)}
                  className="text-xs text-indigo-500 hover:underline mt-0.5">
                  {expandedQuestion === item.id ? "Show less" : "Read more"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">AI:</span>
              <span className="text-xs font-mono text-indigo-600">{item.mapped_competency_code || "—"}</span>
              <span className="text-xs text-gray-500">{item.mapped_topic_name || "Unmapped"}</span>
              {item.confidence_score !== null && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  item.confidence_score >= T.mapping_review_threshold ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}>{Math.round((item.confidence_score || 0) * 100)}% conf.</span>
              )}
              {changedItems.has(item.id) && (
                <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">Changed</span>
              )}
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <select
                  value={overrides[item.id] || item.mapped_competency_id || ""}
                  onChange={e => {
                    const v = e.target.value;
                    setOverrides(o => ({ ...o, [item.id]: v }));
                    if (v !== String(item.mapped_competency_id)) {
                      setChangedItems(s => new Set([...s, item.id]));
                    } else {
                      setChangedItems(s => { const n = new Set(s); n.delete(item.id); return n; });
                    }
                  }}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">— change topic —</option>
                  {(competencies || []).map(c => (
                    <option key={c.id} value={c.id}>{c.competency_code} · {c.topic_name}</option>
                  ))}
                </select>
                <button disabled={saving} onClick={() => handleApprove(item)}
                  className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 disabled:opacity-50 transition-colors">Approve</button>
                <button onClick={() => setSkipped(s => new Set([...s, item.id]))}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200 transition-colors">Skip</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {displayed.length === 0 && pending.length === 0 && (
        <button onClick={onDone} className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">Finish Review</button>
      )}

      {showApproveAllConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-800">Approve All Items</h3>
            <p className="text-sm text-gray-600">This will approve all {pending.length} pending items using the current (or overridden) topic mappings. Continue?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowApproveAllConfirm(false)} className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={handleApproveAll} disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? "Approving…" : "Approve All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EDIT_INPUT = "border border-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500";
// Locked (under review / endorsed): read as plain text, not as an input box.
const LOCKED_INPUT = "border border-transparent bg-transparent text-gray-800 cursor-default focus:outline-none";

const saveDraft = (data) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch {} };

const BLOOM_LEVELS = ["Remembering", "Understanding", "Applying", "Analyzing", "Evaluating", "Creating"];
const BLOOM_COLORS = {
  Remembering: "bg-blue-100 text-blue-700", Understanding: "bg-teal-100 text-teal-700",
  Applying: "bg-green-100 text-green-700", Analyzing: "bg-amber-100 text-amber-700",
  Evaluating: "bg-orange-100 text-orange-700", Creating: "bg-purple-100 text-purple-700",
};

function TosEditor({ assessment, courseId, onDone }) {
  const { data: competencies } = useApi(courseId ? `/syllabi/courses/${courseId}/competencies` : null);
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalWeight = entries.reduce((s, e) => s + (parseFloat(e.weight_percent) || 0), 0);
  const weightOk = Math.abs(totalWeight - 100) < 0.01 || entries.length === 0;

  const addRow = () => {
    if (!competencies?.length) return;
    setEntries(prev => [...prev, { competency_id: competencies[0].id, bloom_level: "Remembering", item_count: 1, weight_percent: 0 }]);
  };

  const update = (i, key, val) => setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [key]: val } : e));

  const handleSave = async () => {
    if (entries.length > 0 && !weightOk) { setError("Weights must sum to 100%."); return; }
    setSaving(true); setError("");
    try {
      for (const entry of entries) {
        await api.post(`/assessments/${assessment.id}/tos`, entry);
      }
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save TOS.");
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 4 of 7 — TOS</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${weightOk ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {totalWeight.toFixed(0)}% / 100%
        </span>
      </div>
      <div>
        <h2 className="text-base font-semibold text-gray-700">Table of Specifications (optional)</h2>
        <p className="text-sm text-gray-500 mt-0.5">Map competencies to Bloom's levels and assign item weights. Skip if not required.</p>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            No TOS entries yet. Add a row or skip to continue.
          </p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-4">
              <select value={entry.competency_id} onChange={e => update(i, "competency_id", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {(competencies || []).map(c => <option key={c.id} value={c.id}>{c.competency_code} — {c.topic_name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <select value={entry.bloom_level} onChange={e => update(i, "bloom_level", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {BLOOM_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <input type="number" min={0} placeholder="Items"
                value={entry.item_count}
                onChange={e => update(i, "item_count", parseInt(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div className="col-span-2">
              <div className="relative">
                <input type="number" min={0} max={100} step={0.5} placeholder="Weight"
                  value={entry.weight_percent}
                  onChange={e => update(i, "weight_percent", parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            </div>
            <div className="col-span-1 flex justify-center">
              <button onClick={() => setEntries(prev => prev.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-400 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Column headers:</span>
          <span className="text-gray-400">Competency | Bloom's Level | Items | Weight%</span>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      {!weightOk && entries.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Weights sum to {totalWeight.toFixed(1)}% — must equal 100% before saving.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={addRow} disabled={!competencies?.length}
          className="px-3 py-2 text-xs font-medium border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors">
          + Add Row
        </button>
        <button onClick={handleSave} disabled={saving || (entries.length > 0 && !weightOk)}
          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : entries.length === 0 ? "Skip TOS →" : "Save TOS & Continue →"}
        </button>
      </div>
    </div>
  );
}

export default function ProcessingInterface() {
  const T = useThresholds();
  const [step, setStep] = useState("course");
  const [courseForm, setCourseForm] = useState({ title: "", code: "", academic_period: "" });
  const [course, setCourse] = useState(null);
  const [syllabusFile, setSyllabusFile] = useState(null);
  const [syllabus, setSyllabus] = useState(null);
  const [editedCompetencies, setEditedCompetencies] = useState([]);
  const [originalCompetencies, setOriginalCompetencies] = useState([]);
  const [assessmentForm, setAssessmentForm] = useState({ title: "", type: "quiz", grading_period: "prelim", assessment_category: "formative", date: "" });
  const [assessment, setAssessment] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [uploadSummary, setUploadSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [showResume, setShowResume] = useState(false);
  const [draftData, setDraftData] = useState(null);
  const [ocrPhase, setOcrPhase] = useState(0);
  const [ocrDone, setOcrDone] = useState(false);
  const ocrTimer = useRef(null);
  const [compSearch, setCompSearch] = useState("");
  const [expandedComp, setExpandedComp] = useState(null);
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [courseErrors, setCourseErrors] = useState({});
  const [assessmentErrors, setAssessmentErrors] = useState({});
  const [curricula, setCurricula] = useState([]);
  const [currSubjects, setCurrSubjects] = useState([]);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState("");
  const [approvalStage, setApprovalStage] = useState(null);
  const [rejectionFeedback, setRejectionFeedback] = useState(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const currentStepIndex = STEPS.indexOf(step);
  const competenciesLocked = !!syllabus && !EDITABLE_STAGES.includes(approvalStage || "draft");

  const canProceed = (() => {
    if (step === "course") return !!(courseForm.title.trim() && courseForm.code.trim() && courseForm.academic_period.trim());
    if (step === "syllabus") return !!syllabusFile;
    if (step === "validate") return editedCompetencies.length > 0;
    if (step === "assessment") return !!assessmentForm.title.trim();
    if (step === "csv") return !!csvFile;
    return true;
  })();

  // Load curricula for Step 1 subject picker
  useEffect(() => {
    api.get("/curricula/").then(r => setCurricula(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedCurriculumId) { setCurrSubjects([]); return; }
    api.get(`/curricula/${selectedCurriculumId}/subjects`).then(r => setCurrSubjects(r.data)).catch(() => {});
  }, [selectedCurriculumId]);

  // Load draft — auto-restore immediately, no click needed
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft.step || draft.step === "course" || draft.step === "done") return;
      // Older drafts parked an uploaded syllabus on step 2; its review now lives on step 3.
      setStep(draft.step === "syllabus" && draft.syllabus ? "validate" : draft.step);
      if (draft.course)              setCourse(draft.course);
      if (draft.syllabus)            setSyllabus(draft.syllabus);
      if (draft.editedCompetencies)  setEditedCompetencies(draft.editedCompetencies);
      if (draft.originalCompetencies) setOriginalCompetencies(draft.originalCompetencies);
      if (draft.assessmentForm)      setAssessmentForm(draft.assessmentForm);
      if (draft.assessment)          setAssessment(draft.assessment);
      if (draft.approvalStage)       setApprovalStage(draft.approvalStage);
      setDraftData(draft);
      setShowResume(true); // keep banner so user can "Start fresh"
    } catch {}
  }, []);

  // Beforeunload warning
  useEffect(() => {
    const handler = (e) => {
      if (step !== "done" && step !== "course") { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step]);

  // CSV preview
  useEffect(() => {
    if (!csvFile) { setCsvPreview(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = (e.target.result || "").split("\n").filter(l => l.trim());
      const headers = (lines[0] || "").split(",").map(h => h.trim().replace(/"/g, ""));
      setCsvPreview({ rows: Math.max(0, lines.length - 1), headers });
    };
    reader.readAsText(csvFile);
  }, [csvFile]);

  useEffect(() => () => clearInterval(ocrTimer.current), []);

  const resumeDraft = () => {
    if (!draftData) return;
    if (draftData.step) setStep(draftData.step === "syllabus" && draftData.syllabus ? "validate" : draftData.step);
    if (draftData.course) setCourse(draftData.course);
    if (draftData.syllabus) setSyllabus(draftData.syllabus);
    if (draftData.editedCompetencies) setEditedCompetencies(draftData.editedCompetencies);
    if (draftData.originalCompetencies) setOriginalCompetencies(draftData.originalCompetencies);
    if (draftData.assessmentForm) setAssessmentForm(draftData.assessmentForm);
    if (draftData.assessment) setAssessment(draftData.assessment);
    if (draftData.approvalStage) setApprovalStage(draftData.approvalStage);
    setShowResume(false);
  };

  const startOcrProgress = () => {
    setOcrPhase(0); setOcrDone(false);
    let phase = 0;
    ocrTimer.current = setInterval(() => {
      phase += 1;
      if (phase < OCR_PHASES.length) setOcrPhase(phase);
      else clearInterval(ocrTimer.current);
    }, 1800);
  };

  // Fetch latest approval stage from server and sync local state + draft
  const refreshApprovalStage = useCallback(async (syllabusObj) => {
    const target = syllabusObj || syllabus;
    if (!target?.id) return;
    try {
      const res = await api.get(`/syllabi/${target.id}`);
      const stage = res.data.approval_stage || "draft";
      setApprovalStage(stage);
      let comps = editedCompetencies;
      if (!EDITABLE_STAGES.includes(stage)) {
        // Submitted or endorsed: show exactly what the approvers reviewed.
        comps = res.data.competencies || [];
        setEditedCompetencies(comps);
        setOriginalCompetencies(comps);
      }
      let feedback = null;
      if (stage === "rejected") {
        const hist = await api.get(`/syllabi/${target.id}/approval-history`);
        const last = [...hist.data].reverse().find(h => h.status === "rejected");
        feedback = last?.feedback || null;
        setRejectionFeedback(feedback);
      }
      saveDraft({ step: "validate", course, syllabus: target, editedCompetencies: comps, originalCompetencies, assessmentForm, approvalStage: stage });
    } catch {}
  }, [syllabus, course, editedCompetencies, originalCompetencies, assessmentForm]);

  // Auto-refresh approval stage whenever the review step becomes active with a known syllabus
  useEffect(() => {
    if (step === "validate" && syllabus?.id) {
      refreshApprovalStage(syllabus);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, syllabus?.id]);

  // If we're on step "syllabus" and have a course but no syllabus in state,
  // fetch it from the server (covers old drafts + direct navigation)
  useEffect(() => {
    if (step === "syllabus" && course?.id && !syllabus) {
      api.get(`/syllabi/by-course/${course.id}`)
        .then(res => {
          const s = res.data;
          const comps = s.competencies || [];
          setSyllabus(s);
          setEditedCompetencies(comps);
          setOriginalCompetencies(comps);
          const stage = s.approval_stage || "draft";
          setApprovalStage(stage);
          setStep("validate");
          saveDraft({ step: "validate", course, syllabus: s, editedCompetencies: comps, originalCompetencies: comps, assessmentForm, approvalStage: stage });
        })
        .catch(() => { /* no syllabus yet — show upload form */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, course?.id, syllabus]);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api.post("/courses/", courseForm);
      setCourse(res.data);
      setStep("syllabus");
      saveDraft({ step: "syllabus", course: res.data, assessmentForm });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create course");
    } finally { setLoading(false); }
  };

  const handleUploadSyllabus = async (e) => {
    e.preventDefault();
    if (!syllabusFile) return;
    if (syllabusFile.size > 25 * 1024 * 1024) { setError("File exceeds 25 MB limit"); return; }
    setError(""); setLoading(true); startOcrProgress();
    try {
      const fd = new FormData(); fd.append("file", syllabusFile);
      const res = await api.post(`/syllabi/upload?course_id=${course.id}`, fd);
      setOcrDone(true); clearInterval(ocrTimer.current);
      setSyllabus(res.data);
      const comps = res.data.competencies || [];
      setEditedCompetencies(comps); setOriginalCompetencies(comps);
      const stage = res.data.approval_stage || "draft";
      setApprovalStage(stage);
      setRejectionFeedback(null);
      saveDraft({ step: "validate", course, syllabus: res.data, editedCompetencies: comps, originalCompetencies: comps, assessmentForm, approvalStage: stage });
      setStep("validate");
    } catch (err) {
      setOcrDone(false); setError(err.response?.data?.detail || "Failed to upload syllabus");
    } finally { setLoading(false); }
  };

  // Save the edited competencies and send the syllabus into the approval chain.
  const handleSubmitForApproval = async () => {
    setError(""); setSubmittingReview(true);
    try {
      const saved = await api.put(`/syllabi/${syllabus.id}/competencies`, { competencies: editedCompetencies });
      const comps = saved.data.competencies || editedCompetencies;
      const action = approvalStage === "rejected" ? "resubmit" : "submit-for-review";
      const res = await api.post(`/syllabi/${syllabus.id}/${action}`);
      const stage = res.data.approval_stage;
      setEditedCompetencies(comps); setOriginalCompetencies(comps);
      setApprovalStage(stage); setRejectionFeedback(null);
      saveDraft({ step: "validate", course, syllabus, editedCompetencies: comps, originalCompetencies: comps, assessmentForm, approvalStage: stage });
    } catch (err) {
      setError(err.response?.data?.detail || "Submit failed");
    } finally { setSubmittingReview(false); }
  };

  const handleValidate = async () => {
    setError(""); setLoading(true);
    try {
      // Endorsed competencies are locked; this only confirms them.
      await api.put(`/syllabi/${syllabus.id}/validate`, {});
      setStep("assessment");
      saveDraft({ step: "assessment", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm });
    } catch (err) {
      setError(err.response?.data?.detail || "Validation failed");
    } finally { setLoading(false); }
  };

  const handleCreateAssessment = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api.post(`/assessments/${course.id}`, assessmentForm);
      setAssessment(res.data);
      setStep("csv");
      saveDraft({ step: "csv", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment: res.data });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create assessment");
    } finally { setLoading(false); }
  };

  const handleSubmitAssessmentForReview = async () => {
    if (!assessment?.id) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post(`/assessments/${assessment.id}/submit-for-review`);
      setAssessment(res.data);
      saveDraft({ step: "csv", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment: res.data });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to submit for review");
    } finally { setLoading(false); }
  };

  const handleRefreshAssessmentStatus = async () => {
    if (!assessment?.id) return;
    setLoading(true);
    try {
      const res = await api.get(`/assessments/${assessment.id}/approval-history`);
      const statusRes = await api.get(`/assessments/course/${course.id}`);
      const updated = statusRes.data.find(a => a.id === assessment.id);
      if (updated) {
        setAssessment(updated);
        saveDraft({ step: "csv", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment: updated });
      }
    } catch {
    } finally { setLoading(false); }
  };

  const handleResubmitAssessment = async () => {
    if (!assessment?.id) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post(`/assessments/${assessment.id}/resubmit`);
      setAssessment(res.data);
      saveDraft({ step: "csv", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment: res.data });
    } catch (err) {
      setError(err.response?.data?.detail || "Resubmit failed");
    } finally { setLoading(false); }
  };

  const handleUploadCsv = async (e) => {
    e.preventDefault();
    if (!csvFile) return;
    if (csvFile.size > 10 * 1024 * 1024) { setError("File exceeds 10 MB limit"); return; }
    setError(""); setLoading(true); setUploadPercent(0);
    try {
      const fd = new FormData(); fd.append("file", csvFile);
      const res = await api.post(`/assessments/${assessment.id}/upload`, fd, {
        onUploadProgress: (ev) => { if (ev.total) setUploadPercent(Math.round((ev.loaded / ev.total) * 100)); },
      });
      setUploadSummary(res.data);
      setStep("mapping");
      saveDraft({ step: "mapping", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment });
    } catch (err) {
      setError(err.response?.data?.detail || "CSV upload failed");
    } finally { setLoading(false); }
  };

  // Competency drag handlers
  const handleDragStart = (e, idx) => { setDraggedIdx(idx); e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const arr = [...editedCompetencies];
    const [removed] = arr.splice(draggedIdx, 1);
    arr.splice(idx, 0, removed);
    setEditedCompetencies(arr); setDraggedIdx(idx);
  };
  const handleDragEnd = () => setDraggedIdx(null);

  const filteredComps = editedCompetencies
    .map((c, i) => ({ comp: c, origIdx: i }))
    .filter(({ comp }) => !compSearch.trim() ||
      (comp.competency_code || "").toLowerCase().includes(compSearch.toLowerCase()) ||
      (comp.topic_name || "").toLowerCase().includes(compSearch.toLowerCase()));

  const highConfCount = editedCompetencies.filter(c => (c.confidence_score ?? 1) >= T.mapping_review_threshold).length;
  const hasConfidenceData = editedCompetencies.some(c => c.confidence_score != null);

  const goBack = () => { if (currentStepIndex > 0) setStep(STEPS[currentStepIndex - 1]); };

  // Upload summary stats
  const uploadTotal = uploadSummary?.questions || 0;
  const uploadMapped = uploadTotal - (uploadSummary?.flagged_for_review || 0);
  const uploadCreatedPct = uploadTotal ? Math.round((uploadMapped / uploadTotal) * 100) : 0;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800 mb-2">Ingestion Module</h1>
        <p className="text-sm text-gray-500 mb-6">Set up a course, syllabus, and assessment data in 7 guided steps.</p>

        {/* Progress restored banner */}
        {showResume && draftData && (
          <div className="mb-5 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-indigo-800">Progress restored</p>
                <p className="text-xs text-indigo-500 mt-0.5 truncate">Resuming from: <strong>{STEP_LABELS[STEPS.indexOf(draftData.step)]}</strong></p>
              </div>
            </div>
            <button
              onClick={() => {
                setShowResume(false);
                localStorage.removeItem(DRAFT_KEY);
                setStep("course"); setCourse(null); setSyllabus(null);
                setEditedCompetencies([]); setOriginalCompetencies([]);
                setCourseForm({ title: "", code: "", academic_period: "" });
                setAssessment(null); setApprovalStage(null); setRejectionFeedback(null);
                setSelectedCurriculumId(""); setCurrSubjects([]);
              }}
              className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors shrink-0">
              Start fresh
            </button>
          </div>
        )}

        {/* Mobile stepper */}
        <div className="sm:hidden mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              step === "done" ? "bg-indigo-600 text-white" : "bg-white text-indigo-700 border-2 border-indigo-600"
            }`}>{currentStepIndex + 1}</div>
            <span className="text-sm font-medium text-indigo-700">{STEP_LABELS[currentStepIndex]}</span>
            <span className="text-xs text-gray-400 ml-auto">Step {currentStepIndex + 1} of {STEPS.length}</span>
          </div>
          <div className="bg-gray-200 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(currentStepIndex / (STEPS.length - 1)) * 100}%` }} />
          </div>
        </div>

        {/* Desktop stepper */}
        <div className="hidden sm:flex items-start mb-4 overflow-x-auto pb-2 -mx-2 px-2">
          {STEP_LABELS.map((label, i) => {
            const s = STEPS[i];
            const active = step === s;
            const done = currentStepIndex > i;
            return (
              <div key={s} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                    done ? "bg-indigo-600 text-white"
                    : active ? "bg-white text-indigo-700 border-2 border-indigo-600"
                    : "bg-gray-100 text-gray-400"
                  }`}>
                    {done ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : i + 1}
                  </div>
                  <span className={`text-xs mt-1 text-center leading-tight max-w-16 ${active ? "text-indigo-700 font-medium" : done ? "text-indigo-400" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className={`flex-1 h-1 mx-1 mb-5 rounded-full ${done ? "bg-indigo-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar (desktop) */}
        <div className="hidden sm:block mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{STEP_DESCRIPTIONS[step]}</span>
            <span>{Math.round((currentStepIndex / (STEPS.length - 1)) * 100)}% complete</span>
          </div>
          <div className="bg-gray-200 rounded-full h-1">
            <div className="bg-indigo-600 h-1 rounded-full transition-all duration-300"
              style={{ width: `${(currentStepIndex / (STEPS.length - 1)) * 100}%` }} />
          </div>
        </div>

        {/* Back button */}
        {currentStepIndex > 0 && step !== "done" && (
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* ── Step 1: Create Course ── */}
        {step === "course" && (
          <form onSubmit={handleCreateCourse} className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 1 of 7</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-700">Create Course</h2>
              <p className="text-sm text-gray-500 mt-0.5">{STEP_DESCRIPTIONS.course}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                Course Title
                <InfoTooltip text="Official course name as it appears in the catalog (e.g. Data Structures and Algorithms)" />
              </label>
              <input required placeholder="e.g. Data Structures and Algorithms"
                value={courseForm.title}
                onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))}
                onBlur={e => setCourseErrors(errs => ({ ...errs, title: e.target.value.trim() ? "" : "Required" }))}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${courseErrors.title ? "border-red-400" : "border-gray-300"}`} />
              {courseErrors.title && <p className="text-xs text-red-500 mt-1">{courseErrors.title}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                Course Code
                <InfoTooltip text="Unique course identifier used in your curriculum (e.g. CS 201 or BSCS 201)" />
              </label>
              <input required placeholder="e.g. CS 201"
                value={courseForm.code}
                onChange={e => setCourseForm(f => ({ ...f, code: e.target.value }))}
                onBlur={e => setCourseErrors(errs => ({ ...errs, code: e.target.value.trim() ? "" : "Required" }))}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${courseErrors.code ? "border-red-400" : "border-gray-300"}`} />
              {courseErrors.code && <p className="text-xs text-red-500 mt-1">{courseErrors.code}</p>}
            </div>
            {curricula.length > 0 && (
              <div className="border border-indigo-100 rounded-xl bg-indigo-50/40 p-3 space-y-3">
                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Link to Curriculum (optional)</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Curriculum</label>
                  <select value={selectedCurriculumId}
                    onChange={e => {
                      setSelectedCurriculumId(e.target.value);
                      setCourseForm(f => ({ ...f, curriculum_subject_id: "" }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Select curriculum</option>
                    {curricula.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {selectedCurriculumId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <select value={courseForm.curriculum_subject_id || ""}
                      onChange={e => {
                        const subj = currSubjects.find(s => s.id === e.target.value);
                        setCourseForm(f => ({
                          ...f,
                          curriculum_subject_id: e.target.value || null,
                          title: subj ? subj.title : f.title,
                          code: subj ? subj.subject_code : f.code,
                        }));
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select subject</option>
                      {currSubjects.map(s => <option key={s.id} value={s.id}>{s.subject_code} — {s.title}</option>)}
                    </select>
                    {courseForm.curriculum_subject_id && (
                      <p className="text-xs text-indigo-500 mt-1">Title and code auto-filled from selected subject.</p>
                    )}
                    {currSubjects.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        This curriculum has no subjects yet. An administrator can add them under Curricula, or you can skip linking and enter the title and code above.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                Academic Period
                <InfoTooltip text="The semester and academic year this course is offered (e.g. AY 2025-2026 S1)" />
              </label>
              <input required placeholder="e.g. AY 2025-2026 S1"
                value={courseForm.academic_period}
                onChange={e => setCourseForm(f => ({ ...f, academic_period: e.target.value }))}
                onBlur={e => setCourseErrors(errs => ({ ...errs, academic_period: e.target.value.trim() ? "" : "Required" }))}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${courseErrors.academic_period ? "border-red-400" : "border-gray-300"}`} />
              {courseErrors.academic_period && <p className="text-xs text-red-500 mt-1">{courseErrors.academic_period}</p>}
            </div>
            <button disabled={loading || !canProceed}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {loading ? "Creating…" : "Create Course →"}
            </button>
          </form>
        )}

        {/* ── Step 2: Upload Syllabus + Approval Gate ── */}
        {step === "syllabus" && (
          <div className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 2 of 7</span>
              {approvalStage && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  approvalStage === "fully_approved" ? "bg-green-100 text-green-700"
                  : approvalStage === "rejected" ? "bg-red-100 text-red-600"
                  : approvalStage === "draft" ? "bg-gray-100 text-gray-500"
                  : "bg-amber-100 text-amber-700"
                }`}>
                  {approvalStage === "draft" ? "Draft" : approvalStage === "fully_approved" ? "Approved" : approvalStage === "rejected" ? "Rejected" : "Pending Approval"}
                </span>
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-700">
                Upload Syllabus — <span className="text-indigo-600">{course?.title}</span>
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{STEP_DESCRIPTIONS.syllabus}</p>
            </div>

            {/* Upload form — only show if no syllabus uploaded yet */}
            {!syllabus ? (
              <form onSubmit={handleUploadSyllabus} className="space-y-4">
                <FileUploadZone file={syllabusFile} onFile={setSyllabusFile}
                  accept=".pdf,.docx" hint="PDF or DOCX" id="syllabus-file" maxMB={25} />
                {loading && <PhaseIndicator phases={OCR_PHASES} activeIndex={ocrPhase} done={ocrDone} />}
                <button disabled={loading || !syllabusFile}
                  className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {loading ? "Processing…" : "Upload & Parse →"}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-green-700 font-medium">Syllabus uploaded and parsed — {editedCompetencies.length} competencies extracted</span>
                </div>
                <button onClick={() => setStep("validate")}
                  className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                  Review Extracted Competencies →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Validate Competencies ── */}
        {step === "validate" && (
          <div className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 3 of 7</span>
              <div className="flex gap-2 items-center">
                {approvalStage && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    approvalStage === "fully_approved" ? "bg-green-100 text-green-700"
                    : approvalStage === "rejected" ? "bg-red-100 text-red-600"
                    : approvalStage === "draft" ? "bg-gray-100 text-gray-500"
                    : "bg-amber-100 text-amber-700"
                  }`}>
                    {approvalStage === "draft" ? "Draft" : approvalStage === "fully_approved" ? "Endorsed · Locked" : approvalStage === "rejected" ? "Returned" : "Pending Approval"}
                  </span>
                )}
                {!competenciesLocked && (
                  <button onClick={() => { setEditedCompetencies([...originalCompetencies]); setCompSearch(""); setPendingDeleteIdx(null); }}
                    className="text-xs border border-gray-300 text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                    Reset to AI suggestions
                  </button>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-700">Review AI-Extracted Competencies</h2>
              <p className="text-sm text-gray-500 mt-0.5">{STEP_DESCRIPTIONS.validate}</p>
            </div>

            {/* Rejection feedback */}
            {approvalStage === "rejected" && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-1">
                <p className="text-sm font-semibold text-red-700">Syllabus Returned</p>
                {rejectionFeedback && <p className="text-sm text-red-600 italic">"{rejectionFeedback}"</p>}
                <p className="text-xs text-red-500">Revise the competencies below, then resubmit for approval.</p>
              </div>
            )}

            {/* Approval chain progress */}
            {approvalStage && !["draft", "fully_approved", "rejected"].includes(approvalStage) && (() => {
              const CHAIN = [
                { key: "pd",   label: "Program Director",    done: "Approved ✓" },
                { key: "dean", label: "Dean",                done: "Approved ✓" },
                { key: "vp",   label: "VP Academic Affairs", done: "Endorsed ✓" },
              ];
              const stageOrder = ["pending_pd", "pending_dean", "pending_vp"];
              const currentIdx = stageOrder.indexOf(approvalStage);
              return (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-4">
                  <p className="text-sm font-semibold text-amber-800">Awaiting Approval — competencies are read-only while under review</p>
                  <div className="flex items-start">
                    {CHAIN.map((node, i) => {
                      const isDone = i < currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <div key={node.key} className="flex items-start flex-1 min-w-0">
                          <div className="flex flex-col items-center">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                              isDone    ? "bg-green-500"
                              : isCurrent ? "border-2 border-amber-500 bg-white"
                              : "bg-gray-200"
                            }`}>
                              {isDone ? (
                                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : isCurrent ? (
                                <svg className="w-4 h-4 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                  <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              ) : (
                                <span className="text-xs font-bold text-gray-400">{i + 1}</span>
                              )}
                            </div>
                            <p className={`text-xs mt-1.5 text-center leading-tight px-0.5 ${
                              isDone ? "text-green-700 font-medium" : isCurrent ? "text-amber-700 font-semibold" : "text-gray-400"
                            }`}>{node.label}</p>
                            <p className={`text-xs mt-0.5 ${
                              isDone ? "text-green-500" : isCurrent ? "text-amber-500 animate-pulse" : "text-gray-300"
                            }`}>{isDone ? node.done : isCurrent ? "Reviewing…" : "Waiting"}</p>
                          </div>
                          {i < CHAIN.length - 1 && (
                            <div className={`flex-1 h-0.5 mt-4 mx-1 rounded-full transition-colors ${isDone ? "bg-green-400" : "bg-gray-200"}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => refreshApprovalStage(syllabus)}
                    className="w-full py-2 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition-colors">
                    ↻ Refresh Status
                  </button>
                </div>
              );
            })()}

            {approvalStage === "fully_approved" && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-sm text-green-700">Endorsed by the VP for Academic Affairs — these competencies are final and can no longer be edited.</span>
              </div>
            )}

            {/* Confidence indicator */}
            {hasConfidenceData && editedCompetencies.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                  <div className="bg-green-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.round((highConfCount / editedCompetencies.length) * 100)}%` }} />
                </div>
                <span className="text-xs text-gray-500 shrink-0">
                  {Math.round((highConfCount / editedCompetencies.length) * 100)}% high confidence
                </span>
              </div>
            )}

            {/* Search */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input value={compSearch} onChange={e => setCompSearch(e.target.value)}
                  placeholder="Filter by code or topic…"
                  className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {editedCompetencies.length} total
                {compSearch && ` · ${filteredComps.length} shown`}
              </span>
            </div>
            {compSearch && !competenciesLocked && <p className="text-xs text-gray-400 -mt-2">Clear search to enable drag-to-reorder</p>}

            <div className="space-y-2 max-h-96 overflow-y-auto min-w-0">
              {filteredComps.map(({ comp, origIdx }) => (
                <div key={origIdx}
                  draggable={!compSearch && !competenciesLocked}
                  onDragStart={e => !compSearch && handleDragStart(e, origIdx)}
                  onDragOver={e => !compSearch && handleDragOver(e, origIdx)}
                  onDragEnd={handleDragEnd}
                  className={`border border-gray-200 rounded-lg p-2.5 space-y-2 transition-opacity ${draggedIdx === origIdx ? "opacity-50" : "opacity-100"}`}
                >
                  <div className="flex gap-2 items-center">
                    {!compSearch && !competenciesLocked && (
                      <span className="text-gray-300 cursor-grab active:cursor-grabbing shrink-0 text-lg leading-none select-none">⠿</span>
                    )}
                    <input value={comp.competency_code}
                      onChange={e => { const c = [...editedCompetencies]; c[origIdx] = { ...c[origIdx], competency_code: e.target.value }; setEditedCompetencies(c); }}
                      placeholder="Code" readOnly={competenciesLocked}
                      className={`w-32 rounded px-2 py-1 text-xs shrink-0 ${competenciesLocked ? LOCKED_INPUT + " font-semibold" : EDIT_INPUT}`} />
                    <input value={comp.topic_name}
                      onChange={e => { const c = [...editedCompetencies]; c[origIdx] = { ...c[origIdx], topic_name: e.target.value }; setEditedCompetencies(c); }}
                      placeholder="Topic name" readOnly={competenciesLocked}
                      className={`flex-1 rounded px-2 py-1 text-xs ${competenciesLocked ? LOCKED_INPUT : EDIT_INPUT}`} />
                    {comp.confidence_score != null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                        comp.confidence_score >= T.mapping_review_threshold ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}>{Math.round(comp.confidence_score * 100)}%</span>
                    )}
                    <button onClick={() => setExpandedComp(expandedComp === origIdx ? null : origIdx)}
                      title="Learning outcomes"
                      className="text-gray-300 hover:text-indigo-500 transition-colors shrink-0">
                      <svg className={`w-4 h-4 transition-transform ${expandedComp === origIdx ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {competenciesLocked ? null : pendingDeleteIdx === origIdx ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-gray-500">Remove?</span>
                        <button onClick={() => { setEditedCompetencies(editedCompetencies.filter((_, j) => j !== origIdx)); setPendingDeleteIdx(null); }}
                          className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors">Yes</button>
                        <button onClick={() => setPendingDeleteIdx(null)}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors">No</button>
                      </div>
                    ) : (
                      <button onClick={() => { setPendingDeleteIdx(origIdx); setExpandedComp(null); }}
                        title="Remove" className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {expandedComp === origIdx && (
                    <div className="pl-2 border-l-2 border-indigo-200 space-y-1">
                      {(comp.learning_outcomes || []).length > 0 ? (
                        <>
                          {(comp.learning_outcomes || []).map((lo, li) => (
                            <input key={li} value={lo}
                              onChange={e => {
                                const c = [...editedCompetencies];
                                const los = [...(c[origIdx].learning_outcomes || [])];
                                los[li] = e.target.value;
                                c[origIdx] = { ...c[origIdx], learning_outcomes: los };
                                setEditedCompetencies(c);
                              }}
                              readOnly={competenciesLocked}
                              className={`w-full rounded px-2 py-1 text-xs ${competenciesLocked ? LOCKED_INPUT : EDIT_INPUT}`}
                              placeholder={`Learning outcome ${li + 1}`} />
                          ))}
                          {!competenciesLocked && <button onClick={() => { const c = [...editedCompetencies]; c[origIdx] = { ...c[origIdx], learning_outcomes: [...(c[origIdx].learning_outcomes || []), ""] }; setEditedCompetencies(c); }}
                            className="text-xs text-indigo-500 hover:underline">+ Add outcome</button>}
                        </>
                      ) : competenciesLocked ? (
                        <p className="text-xs text-gray-400 px-2">No learning outcomes listed.</p>
                      ) : (
                        <button onClick={() => { const c = [...editedCompetencies]; c[origIdx] = { ...c[origIdx], learning_outcomes: [""] }; setEditedCompetencies(c); }}
                          className="text-xs text-indigo-500 hover:underline">+ Add learning outcome</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!competenciesLocked && (
              <div className="flex items-center gap-3">
                <button onClick={() => setEditedCompetencies([...editedCompetencies, { competency_code: "", topic_name: "", learning_outcomes: [] }])}
                  className="text-indigo-600 text-sm hover:underline">
                  + Add competency
                </button>
                <span className="text-xs text-gray-400">{editedCompetencies.length} competencies</span>
              </div>
            )}
            {!competenciesLocked && (
              <button disabled={submittingReview || !canProceed} onClick={handleSubmitForApproval}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {submittingReview ? "Submitting…"
                  : approvalStage === "rejected" ? `Save & Resubmit ${editedCompetencies.length} Competencies →`
                  : `Save & Submit ${editedCompetencies.length} Competencies for Approval →`}
              </button>
            )}
            {approvalStage === "fully_approved" && (
              <button disabled={loading} onClick={handleValidate}
                className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
                {loading ? "Continuing…" : "Continue to Create Assessment →"}
              </button>
            )}
          </div>
        )}

        {/* ── Step 4: Create Assessment ── */}
        {step === "assessment" && !assessment && (
          <form onSubmit={handleCreateAssessment} className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 4 of 7</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-700">Create Assessment</h2>
              <p className="text-sm text-gray-500 mt-0.5">{STEP_DESCRIPTIONS.assessment}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input required placeholder="e.g. Prelim Exam"
                value={assessmentForm.title}
                onChange={e => setAssessmentForm(f => ({ ...f, title: e.target.value }))}
                onBlur={e => setAssessmentErrors(errs => ({ ...errs, title: e.target.value.trim() ? "" : "Required" }))}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${assessmentErrors.title ? "border-red-400" : "border-gray-300"}`} />
              {assessmentErrors.title && <p className="text-xs text-red-500 mt-1">{assessmentErrors.title}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                  Type
                  <InfoTooltip text="Quiz = short formative; Exam = major summative; Assignment = project-based" />
                </label>
                <select value={assessmentForm.type} onChange={e => setAssessmentForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="quiz">Quiz</option>
                  <option value="exam">Exam</option>
                  <option value="assignment">Assignment</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                  Grading Period
                  <InfoTooltip text="The academic period this assessment belongs to. Prelim → Midterm → Semi-Final → Final" />
                </label>
                <select value={assessmentForm.grading_period} onChange={e => setAssessmentForm(f => ({ ...f, grading_period: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="prelim">Prelim</option>
                  <option value="midterm">Midterm</option>
                  <option value="semi_final">Semi-Final</option>
                  <option value="final">Final</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                Assessment Category
                <InfoTooltip text="Formative = ongoing practice/quizzes; Summative = major evaluations (exams, final projects)" />
              </label>
              <div className="flex gap-3">
                {[{ value: "formative", label: "Formative", desc: "Quizzes, activities, recitations" },
                  { value: "summative", label: "Summative", desc: "Exams, major projects" }].map(opt => (
                  <label key={opt.value}
                    className={`flex-1 flex flex-col gap-0.5 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      assessmentForm.assessment_category === opt.value
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-indigo-300"
                    }`}>
                    <input type="radio" name="assessment_category" value={opt.value}
                      checked={assessmentForm.assessment_category === opt.value}
                      onChange={e => setAssessmentForm(f => ({ ...f, assessment_category: e.target.value }))}
                      className="sr-only" />
                    <span className={`text-sm font-semibold ${assessmentForm.assessment_category === opt.value ? "text-indigo-700" : "text-gray-700"}`}>{opt.label}</span>
                    <span className="text-xs text-gray-500">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                Assessment Date / Due Date
                <InfoTooltip text="When was this assessment administered or due? Recorded for submission-timeliness context; it does not affect the risk classification." />
              </label>
              <input
                type="date"
                value={assessmentForm.date}
                onChange={e => setAssessmentForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button disabled={loading || !canProceed}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {loading ? "Creating…" : "Create Assessment →"}
            </button>
          </form>
        )}

        {/* ── Step 4b: TOS Editor (after assessment created) ── */}
        {step === "assessment" && assessment && (
          <TosEditor assessment={assessment} courseId={course?.id} onDone={() => {
            setStep("csv");
            saveDraft({ step: "csv", course, syllabus, editedCompetencies, originalCompetencies, assessmentForm, assessment });
          }} />
        )}

        {/* ── Step 5: Upload CSV ── */}
        {step === "csv" && assessment && course && (
          <ExamQuestionsPanel assessment={assessment} courseId={course.id} />
        )}
        {step === "csv" && assessment?.approval_status && assessment.approval_status !== "approved" && (
          <div className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 5 of 7</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-700">Assessment Approval Required</h2>
              <p className="text-sm text-gray-500 mt-0.5">Your assessment must be approved by the Program Director before you can upload grades.</p>
            </div>

            {/* draft — not submitted yet */}
            {assessment.approval_status === "draft" && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                  <p className="text-sm font-medium text-gray-700">Assessment not yet submitted</p>
                </div>
                <p className="text-xs text-gray-500 ml-4">Submit your assessment to the Program Director for review. Once approved, you can upload student grades.</p>
                <button onClick={handleSubmitAssessmentForReview} disabled={loading}
                  className="ml-4 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {loading ? "Submitting…" : "Submit for PD Review"}
                </button>
              </div>
            )}

            {/* pending_pd — awaiting PD */}
            {assessment.approval_status === "pending_pd" && (
              <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                  </svg>
                  <p className="text-sm font-medium text-amber-700">Waiting for Program Director approval</p>
                </div>
                <p className="text-xs text-amber-600 ml-6">Your assessment has been submitted. The PD will review and approve or reject it. Check back later.</p>
                <button onClick={handleRefreshAssessmentStatus} disabled={loading}
                  className="ml-6 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {loading ? "Checking…" : "Refresh Status"}
                </button>
              </div>
            )}

            {/* rejected */}
            {assessment.approval_status === "rejected" && (
              <div className="bg-red-50 rounded-xl border border-red-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-red-700">Assessment was rejected by the Program Director</p>
                </div>
                <p className="text-xs text-red-600 ml-6">Please revise your assessment based on the PD's feedback, then resubmit.</p>
                <button onClick={handleResubmitAssessment} disabled={loading}
                  className="ml-6 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {loading ? "Resubmitting…" : "Resubmit for Review"}
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        )}

        {step === "csv" && (!assessment?.approval_status || assessment.approval_status === "approved") && (
          <form onSubmit={handleUploadCsv} className="bg-white rounded-xl border border-indigo-100 shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-0.5 rounded-full">Step 5 of 7</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-700">Upload Assessment Scores</h2>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Approved</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{STEP_DESCRIPTIONS.csv}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 flex items-start justify-between gap-4">
              <div className="text-xs text-gray-600 font-mono">
                Required: <strong>student_id, question_text, score, max_score</strong><br />
                Optional: submission_date, competency_code<br />
                <span className="font-sans text-gray-500">
                  One row per student per question. Fill competency_code (e.g. {editedCompetencies[0]?.competency_code || "CLO1"}) to tag a question yourself and skip topic mapping for it.
                </span>
              </div>
              <button type="button" onClick={() => {
                const code = editedCompetencies[0]?.competency_code || "CLO1";
                const csv = ["student_id,question_text,score,max_score,submission_date,competency_code",
                  `2023-00001,What is the time complexity of binary search?,8,10,2025-10-01,${code}`,
                  "2023-00001,Define encapsulation in OOP.,7,10,2025-10-01,",
                  `2023-00002,What is the time complexity of binary search?,6,10,2025-10-01,${code}`,
                  "2023-00002,Define encapsulation in OOP.,9,10,2025-10-01,",
                ].join("\n");
                const a = Object.assign(document.createElement("a"), {
                  href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
                  download: "assessment_template.csv",
                });
                a.click();
              }} className="shrink-0 text-indigo-600 border border-indigo-300 rounded px-2 py-1 text-xs hover:bg-indigo-50 transition-colors">
                Download template
              </button>
            </div>

            <FileUploadZone file={csvFile} onFile={setCsvFile} accept=".csv" hint="CSV only" id="csv-file" maxMB={10} />

            {csvPreview && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs space-y-1">
                <p className="font-medium text-indigo-700">{csvPreview.rows} data rows detected</p>
                <p className="text-indigo-500 font-mono">Columns: {csvPreview.headers.join(", ")}</p>
              </div>
            )}

            {loading && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Uploading…</span><span>{uploadPercent}%</span>
                </div>
                <div className="bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all duration-200" style={{ width: `${uploadPercent}%` }} />
                </div>
              </div>
            )}

            <button disabled={loading || !canProceed}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {loading ? "Uploading…" : "Upload & Map Topics →"}
            </button>
          </form>
        )}

        {/* ── Step 6: Mapping Review ── */}
        {step === "mapping" && assessment && (
          <>
            {uploadSummary && (() => {
              const flaggedPct = 100 - uploadCreatedPct;
              return (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">Upload Summary</p>
                    <p className="text-xs text-gray-400">{uploadTotal} questions from {uploadSummary.total_rows} score rows</p>
                  </div>
                  <div className="flex h-6 rounded-lg overflow-hidden">
                    <div className="bg-green-500 flex items-center justify-center" style={{ width: `${uploadCreatedPct}%` }}>
                      {uploadCreatedPct > 15 && <span className="text-xs text-white font-medium">{uploadCreatedPct}%</span>}
                    </div>
                    <div className="bg-amber-400 flex items-center justify-center" style={{ width: `${flaggedPct}%` }}>
                      {flaggedPct > 15 && <span className="text-xs text-white font-medium">{flaggedPct}%</span>}
                    </div>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="flex items-center gap-1 text-green-700"><span className="w-2 h-2 bg-green-500 rounded-full inline-block" />{uploadMapped} mapped{uploadSummary.pre_tagged ? ` (${uploadSummary.pre_tagged} tagged in CSV)` : ""}</span>
                    <span className="flex items-center gap-1 text-amber-600"><span className="w-2 h-2 bg-amber-400 rounded-full inline-block" />{uploadSummary.flagged_for_review} sent to topic mapping</span>
                  </div>
                </div>
              );
            })()}
            <MappingReview assessmentId={assessment.id} courseId={course.id} onDone={() => {
              setStep("done");
              try { localStorage.removeItem(DRAFT_KEY); } catch {}
            }} />
          </>
        )}

        {/* ── Step 7: Done ── */}
        {step === "done" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-md p-8 text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-semibold text-gray-700 text-lg">Processing Complete</h2>
              <p className="text-sm text-gray-500">
                Course <span className="font-medium text-indigo-600">{course?.title}</span> is ready.
                Risk classifications update each time new results are uploaded.
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <button onClick={() => { setStep("assessment"); setAssessment(null); setCsvFile(null); setCsvPreview(null); setUploadSummary(null); setUploadPercent(0); }}
                  className="border border-indigo-300 text-indigo-600 px-4 py-2 rounded-lg text-sm hover:bg-indigo-50 transition-colors">
                  Upload another assessment
                </button>
                <button onClick={() => {
                  setStep("course"); setCourse(null); setSyllabus(null); setEditedCompetencies([]); setOriginalCompetencies([]);
                  setCourseForm({ title: "", code: "", academic_period: "" }); setAssessment(null);
                  setSelectedCurriculumId(""); setCurrSubjects([]);
                  setCsvFile(null); setCsvPreview(null); setUploadSummary(null); setUploadPercent(0);
                  setCourseErrors({}); setAssessmentErrors({});
                }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition-colors">
                  New course
                </button>
              </div>
            </div>

            {/* Topic Mapping Review CTA */}
            <a
              href="/instructor/topic-mapping"
              className="flex items-center justify-between gap-4 bg-white border border-indigo-200 rounded-xl shadow-sm px-5 py-4 hover:bg-indigo-50 hover:border-indigo-400 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 group-hover:text-indigo-700 transition-colors">Review Topic Mappings</p>
                  <p className="text-xs text-gray-500 mt-0.5">Confirm or override the AI's question-to-competency mappings. Low-confidence items are listed first.</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-indigo-400 shrink-0 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </Layout>
  );
}
