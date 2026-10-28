import { useState, useEffect } from "react";
import api from "../services/api";

// Advisory measurable-outcome and program-outcome check (capstone §3.11.2 Phase 1).
export function AlignmentCheck({ syllabusId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/syllabi/${syllabusId}/alignment-check`)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [syllabusId]);

  if (!data) return null;
  const vague = data.measurability.filter(r => !r.measurable);
  const pa = data.program_alignment;
  return (
    <section aria-labelledby={`align-${syllabusId}`} className="rounded-xl border border-gray-200 px-4 py-3 space-y-2">
      <p id={`align-${syllabusId}`} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Alignment check <span className="font-normal normal-case text-gray-400">(advisory)</span>
      </p>
      {vague.length === 0 ? (
        <p className="text-xs text-emerald-700">All learning outcomes use measurable action verbs.</p>
      ) : (
        <ul className="space-y-0.5">
          {vague.map(r => (
            <li key={r.competency_code} className="text-xs text-amber-700">
              <span className="font-semibold">{r.competency_code}:</span> {r.issues[0]}
            </li>
          ))}
        </ul>
      )}
      {pa ? (
        <div className="text-xs text-gray-600 space-y-0.5">
          <p>
            Program ({data.program_name}):{" "}
            {pa.unaligned_clos.length === 0
              ? <span className="text-emerald-700">every CLO supports at least one program outcome.</span>
              : <span className="text-amber-700">{pa.unaligned_clos.join(", ")} support no program outcome.</span>}
          </p>
          {pa.uncovered_program_outcomes.length > 0 && (
            <p className="text-gray-500">
              Not covered by this course: {pa.uncovered_program_outcomes.map(code => `${code} (${pa.outcome_codes[code]})`).join("; ")}
            </p>
          )}
        </div>
      ) : (
        data.alignment_status && <p className="text-xs text-gray-400">{data.alignment_status}</p>
      )}
    </section>
  );
}

// Read-only view of what the approver is signing off: competencies, outcomes and the source file.
export default function SyllabusDetails({ s }) {
  const [fileError, setFileError] = useState(null);
  const openFile = async () => {
    setFileError(null);
    try {
      const res = await api.get(`/syllabi/${s.id}/file`, { responseType: "blob" });
      const href = URL.createObjectURL(res.data);
      window.open(href, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch {
      setFileError("The original file is not available.");
    }
  };
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Competencies</p>
        <button onClick={openFile} className="text-xs text-indigo-600 hover:underline">Open original syllabus file ↗</button>
      </div>
      {fileError && <p className="text-xs text-red-600">{fileError}</p>}
      {(s.competencies || []).length === 0 ? (
        <p className="text-xs text-gray-400">No competencies extracted.</p>
      ) : (
        <ol className="space-y-2">
          {[...s.competencies].sort((a, b) => a.competency_code.localeCompare(b.competency_code)).map(c => (
            <li key={c.id} className="text-sm">
              <span className="font-mono text-xs text-indigo-600 mr-2">{c.competency_code}</span>
              <span className="text-gray-800">{c.topic_name}</span>
              {c.learning_outcomes?.length > 0 && (
                <ul className="mt-0.5 ml-6 list-disc text-xs text-gray-500 space-y-0.5">
                  {c.learning_outcomes.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      <AlignmentCheck syllabusId={s.id} />
    </div>
  );
}
