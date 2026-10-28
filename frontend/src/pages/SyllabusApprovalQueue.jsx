import { useState, useEffect, useCallback } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === "error" ? "bg-red-600" : "bg-green-600";
  return (
    <div className={`fixed bottom-4 right-4 ${bg} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-[9999] flex items-center gap-2`}>
      {message}
      <button onClick={onClose} className="ml-1 text-white/70 hover:text-white">✕</button>
    </div>
  );
}

const STAGE_LABELS = {
  draft: "Draft",
  pending_pd: "Waiting — Program Director",
  pending_dean: "Waiting — Dean",
  pending_vp: "Waiting — VP",
  fully_approved: "Fully Approved",
  rejected: "Rejected",
};

const STAGE_COLORS = {
  draft: "bg-gray-100 text-gray-500",
  pending_pd: "bg-amber-100 text-amber-700",
  pending_dean: "bg-amber-100 text-amber-700",
  pending_vp: "bg-amber-100 text-amber-700",
  fully_approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
};

const NEXT_STAGE_LABEL = {
  program_director: "Pending Dean Review",
  dean: "Pending VP Review",
  vp_academic_affairs: "Endorsed (final)",
};

// The VP for Academic Affairs gives the final endorsement rather than an approval.
const actionVerb = (role) => (role === "vp_academic_affairs" ? "Endorse" : "Approve");

// Advisory measurable-outcome and program-outcome check (capstone §3.11.2 Phase 1).
function AlignmentCheck({ syllabusId }) {
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
function SyllabusDetails({ s }) {
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

function SyllabusCard({ s, acting, verb, onApprove, onReject, onHistory }) {
  const [open, setOpen] = useState(false);
  const compCount = s.competencies?.length ?? 0;
  const courseSnippet = s.course_id ? s.course_id.slice(0, 8) + "…" : "—";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[s.approval_stage]}`}>
              {STAGE_LABELS[s.approval_stage] || s.approval_stage}
            </span>
            {compCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                {compCount} competencies
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-800 truncate">
            {s.parsed_json?.course_title || `Syllabus — Course ${courseSnippet}`}
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>Course ID: <span className="font-mono">{courseSnippet}</span></span>
            <span>Syllabus: <span className="font-mono">{s.id.slice(0, 8)}…</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 px-2.5 py-1.5 rounded-lg transition-colors">
            {open ? "Hide" : "View"}
          </button>
          <button onClick={() => onHistory(s.id)}
            className="text-xs text-gray-500 hover:text-indigo-600 border border-gray-200 px-2.5 py-1.5 rounded-lg transition-colors">
            History
          </button>
          <button onClick={() => onReject(s)}
            disabled={acting === s.id}
            className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
            Reject
          </button>
          <button onClick={() => onApprove(s)}
            disabled={acting === s.id}
            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {acting === s.id ? "Processing…" : verb}
          </button>
        </div>
      </div>
      {open && <SyllabusDetails s={s} />}
    </div>
  );
}

export default function SyllabusApprovalQueue() {
  const { user } = useAuth();
  const verb = actionVerb(user?.role);
  const [syllabi, setSyllabi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  // Approve modal
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveFeedback, setApproveFeedback] = useState("");

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectFeedback, setRejectFeedback] = useState("");

  // History modal
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState([]);

  const [toast, setToast] = useState(null);
  const showToast = (message, type = "success") => setToast({ message, type });

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/syllabi/pending-approval");
      setSyllabi(res.data);
    } catch { showToast("Failed to load queue", "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleApprove = async () => {
    if (!approveTarget) return;
    setActing(approveTarget.id);
    try {
      await api.post(`/syllabi/${approveTarget.id}/approve`, { feedback: approveFeedback.trim() || "" });
      showToast(verb === "Endorse" ? "Syllabus endorsed" : "Syllabus approved");
      setApproveTarget(null);
      setApproveFeedback("");
      fetchQueue();
    } catch (err) { showToast(err.response?.data?.detail || `${verb} failed`, "error"); }
    finally { setActing(null); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setActing(rejectTarget.id);
    try {
      await api.post(`/syllabi/${rejectTarget.id}/reject`, { feedback: rejectFeedback });
      showToast("Syllabus rejected");
      setRejectTarget(null);
      setRejectFeedback("");
      fetchQueue();
    } catch (err) { showToast(err.response?.data?.detail || "Reject failed", "error"); }
    finally { setActing(null); }
  };

  const openHistory = async (syllabusId) => {
    setHistoryTarget(syllabusId);
    try {
      const res = await api.get(`/syllabi/${syllabusId}/approval-history`);
      setHistory(res.data);
    } catch { setHistory([]); }
  };

  const roleLabel = {
    program_director: "Program Director",
    dean: "Dean",
    vp_academic_affairs: "VP Academic Affairs",
  }[user?.role] || user?.role;

  const nextStageLabel = NEXT_STAGE_LABEL[user?.role] || "next stage";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Syllabus Approval Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Reviewing as <span className="font-medium text-indigo-600">{roleLabel}</span> · {syllabi.length} pending
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-32" />
              </div>
            ))}
          </div>
        ) : syllabi.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-500">No syllabi pending your review</p>
            <p className="text-xs text-gray-400 mt-1">Check back later or refresh the page.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {syllabi.map(s => (
              <SyllabusCard
                key={s.id}
                s={s}
                acting={acting}
                verb={verb}
                onApprove={syl => { setApproveTarget(syl); setApproveFeedback(""); }}
                onReject={syl => { setRejectTarget(syl); setRejectFeedback(""); }}
                onHistory={openHistory}
              />
            ))}
          </div>
        )}

        {/* ── Approve confirmation modal ── */}
        {approveTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-800">{verb === "Endorse" ? "Confirm Endorsement" : "Confirm Approval"}</h2>
                  <p className="text-xs text-gray-400">This action cannot be undone</p>
                </div>
              </div>

              <div className="px-6 py-4 space-y-4">
                <AlignmentCheck syllabusId={approveTarget.id} />
                {/* Syllabus summary */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Syllabus</span>
                    <span className="font-mono">{approveTarget.id.slice(0, 12)}…</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Competencies</span>
                    <span className="font-medium text-gray-700">{approveTarget.competencies?.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Current stage</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[approveTarget.approval_stage]}`}>
                      {STAGE_LABELS[approveTarget.approval_stage]}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Will advance to</span>
                    <span className="text-green-600 font-medium">{nextStageLabel}</span>
                  </div>
                </div>

                {/* Optional comment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comment <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={approveFeedback}
                    onChange={e => setApproveFeedback(e.target.value)}
                    placeholder="Add notes for the record…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
                  />
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button
                  onClick={() => setApproveTarget(null)}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  disabled={acting === approveTarget.id}
                  className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
                  {acting === approveTarget.id ? (verb === "Endorse" ? "Endorsing…" : "Approving…") : `Yes, ${verb}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reject modal ── */}
        {rejectTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-800">Reject Syllabus</h2>
                  <p className="text-xs text-gray-400">The instructor will be notified to revise</p>
                </div>
              </div>

              <div className="px-6 py-4 space-y-4">
                {/* Syllabus summary */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Syllabus</span>
                    <span className="font-mono">{rejectTarget.id.slice(0, 12)}…</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Competencies</span>
                    <span className="font-medium text-gray-700">{rejectTarget.competencies?.length ?? 0}</span>
                  </div>
                </div>

                {/* Required feedback */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={rejectFeedback}
                    onChange={e => setRejectFeedback(e.target.value)}
                    placeholder="Describe what the instructor needs to revise…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                  />
                  {!rejectFeedback.trim() && (
                    <p className="text-xs text-gray-400 mt-1">Feedback is required before rejecting.</p>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button
                  onClick={() => setRejectTarget(null)}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectFeedback.trim() || acting === rejectTarget.id}
                  className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                  {acting === rejectTarget.id ? "Rejecting…" : "Yes, Reject"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── History modal ── */}
        {historyTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">Approval History</h2>
                <button onClick={() => setHistoryTarget(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="px-6 py-4 space-y-3 max-h-80 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No approval records yet.</p>
                ) : history.map(h => (
                  <div key={h.id} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${h.status === "approved" ? "bg-green-500" : "bg-red-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-700 capitalize">{h.role.replace(/_/g, " ")}</span>
                        <span className={`text-xs font-medium ${h.status === "approved" ? "text-green-600" : "text-red-600"}`}>
                          {h.status === "approved" && h.role === "vp_academic_affairs" ? "endorsed" : h.status}
                        </span>
                      </div>
                      {h.feedback && <p className="text-xs text-gray-500 mt-0.5 italic">"{h.feedback}"</p>}
                      <p className="text-xs text-gray-400">{h.reviewed_at ? new Date(h.reviewed_at).toLocaleString() : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Layout>
  );
}
