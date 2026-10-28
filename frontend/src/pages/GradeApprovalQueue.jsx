import { useEffect, useState, useCallback } from "react";
import api from "../services/api";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";

const PERIOD_LABELS = {
  prelim: "Prelim", midterm: "Midterm", semi_final: "Semi-Final", final: "Final",
};

// The VP for Academic Affairs gives the final endorsement rather than an approval.
const actionVerb = (role) => (role === "vp_academic_affairs" ? "Endorse" : "Approve");

const NEXT_STEP = {
  program_director: "It moves to the Dean for review.",
  dean: "It moves to the VP for Academic Affairs for final endorsement.",
  vp_academic_affairs: "This is the final step: the grades are officially posted and the instructor is notified.",
};
const ASSESSMENT_STATUS = {
  draft: ["Not submitted for review", "bg-gray-100 text-gray-600"],
  pending_pd: ["Awaiting Program Director", "bg-amber-100 text-amber-700"],
  approved: ["Approved", "bg-green-100 text-green-700"],
  rejected: ["Rejected", "bg-red-100 text-red-600"],
};
const fmtPct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

// Course, instructor and period by name, not by ID.
function SubmissionInfo({ s }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-gray-800 truncate" title={s.course_title}>
        {s.course_code && <span className="text-indigo-600 mr-1.5">{s.course_code}</span>}
        {s.course_title || "Course"}
      </p>
      <p className="text-sm text-gray-700 mt-0.5">{PERIOD_LABELS[s.grading_period] || s.grading_period} grades</p>
      <p className="text-xs text-gray-500">
        {[s.instructor_name && `Instructor: ${s.instructor_name}`, s.course_academic_period,
          s.submitted_at && `Submitted ${new Date(s.submitted_at).toLocaleDateString()}`].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

// What is being signed off: the period's results, the assessments behind them, earlier sign-offs.
function SubmissionDetails({ s }) {
  const unreviewed = (s.assessments || []).filter(a => a.approval_status !== "approved");
  return (
    <div className="space-y-3 text-sm">
      {unreviewed.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Not reviewed by the Program Director:</span>{" "}
          {unreviewed.map(a => a.title).join(", ")}. These grades come from {unreviewed.length === 1 ? "an exam" : "exams"} that
          never passed assessment review. You may still approve, or return them to the instructor with your reason.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded-lg p-2"><p className="text-lg font-bold text-gray-800">{s.students}</p><p className="text-xs text-gray-500">students graded</p></div>
        <div className="bg-gray-50 rounded-lg p-2"><p className="text-lg font-bold text-gray-800">{fmtPct(s.class_average)}</p><p className="text-xs text-gray-500">class average</p></div>
        <div className="bg-gray-50 rounded-lg p-2"><p className={`text-lg font-bold ${s.below_passing ? "text-red-600" : "text-gray-800"}`}>{s.below_passing}</p><p className="text-xs text-gray-500">below {s.passing_threshold ?? 75}%</p></div>
      </div>
      {s.notes && <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2"><span className="font-medium">Instructor's note:</span> {s.notes}</p>}
      <div className="rounded-lg border border-gray-200">
        <p className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-100">Assessments this period</p>
        {(s.assessments || []).length === 0 ? (
          <p className="px-3 py-2 text-xs text-amber-700">No assessments were recorded for this period, so there are no scores behind these grades.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {s.assessments.map((a, i) => {
                const [label, cls] = ASSESSMENT_STATUS[a.approval_status] || [a.approval_status, "bg-gray-100 text-gray-600"];
                return (
                  <tr key={i} className="border-t border-gray-100 first:border-0">
                    <td className="px-3 py-1.5 text-gray-800">{a.title} <span className="text-gray-400 capitalize">· {a.type}</span></td>
                    <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span></td>
                    <td className="px-2 py-1.5 text-right text-gray-500">{a.students ? `${a.students} scored` : "No scores yet"}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmtPct(a.average)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {(s.grades || []).length > 0 && (
        <div className="rounded-lg border border-gray-200">
          <p className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-100">
            Grade sheet <span className="font-normal normal-case text-gray-400">(read-only · only the instructor can change a grade)</span>
          </p>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">#</th>
                  <th className="px-2 py-1.5 text-left font-medium">Student</th>
                  <th className="px-2 py-1.5 text-left font-medium">Student No.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Score</th>
                  <th className="px-2 py-1.5 text-right font-medium">Grade</th>
                  <th className="px-3 py-1.5 text-left font-medium">Remark</th>
                </tr>
              </thead>
              <tbody>
                {s.grades.map((g, i) => (
                  <tr key={i} className={`border-t border-gray-100 ${g.passed ? "" : "bg-red-50/60"}`}>
                    <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5 text-gray-800">{g.name}</td>
                    <td className="px-2 py-1.5 text-gray-500 font-mono">{g.student_number || "—"}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{fmtPct(g.percent)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${g.passed ? "text-gray-800" : "text-red-600"}`}>{g.grade}</td>
                    <td className={`px-3 py-1.5 ${g.passed ? "text-green-700" : "text-red-600 font-medium"}`}>{g.passed ? "Passed" : "Failed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {(s.approvals || []).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Earlier sign-offs</p>
          <ul className="space-y-1">
            {s.approvals.map((h, i) => (
              <li key={i} className="text-xs text-gray-600">
                <span className={h.status === "approved" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                  {h.status === "approved" ? "Approved" : "Rejected"}
                </span>{" "}by {h.approver_name || h.role} ({h.role}){h.reviewed_at && ` on ${new Date(h.reviewed_at).toLocaleDateString()}`}
                {h.feedback && <span className="italic text-gray-500"> — "{h.feedback}"</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ApproveModal({ submission, verb, nextStep, onClose, onDone }) {
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setLoading(true); setError("");
    try {
      await api.post(`/grade-submissions/${submission.id}/approve`, { feedback: feedback || null });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail || `${verb} failed.`);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{verb} Grade Submission</h2>
          <p className="text-xs text-gray-400">{nextStep}</p>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">These grades belong to the instructor. You are confirming them, not changing them — only {submission.instructor_name || "the instructor"} can correct a grade.</p>
          <SubmissionInfo s={submission} />
          <SubmissionDetails s={submission} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Optional Comments</label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
              placeholder="Any notes for the next approver or instructor…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {loading ? (verb === "Endorse" ? "Endorsing…" : "Approving…") : `Yes, ${verb}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ submission, onClose, onDone }) {
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!feedback.trim()) { setError("Feedback is required for rejection."); return; }
    setLoading(true); setError("");
    try {
      await api.post(`/grade-submissions/${submission.id}/reject`, { feedback });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail || "Rejection failed.");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Reject Grade Submission</h2>
          <p className="text-xs text-gray-400">It goes back to the instructor with your reason; they must resubmit from the start of the approval chain.</p>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <SubmissionInfo s={submission} />
          <SubmissionDetails s={submission} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Rejection <span className="text-red-500">*</span></label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={4}
              placeholder="Explain what needs to be revised…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleSubmit} disabled={loading || !feedback.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubmissionCard({ submission, verb, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const s = submission;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <SubmissionInfo s={s} />
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium shrink-0">Pending Review</span>
      </div>
      <p className="text-xs text-gray-600 mt-2">
        {s.students} student{s.students === 1 ? "" : "s"} · class average {fmtPct(s.class_average)} ·{" "}
        <span className={s.below_passing ? "text-red-600 font-medium" : ""}>{s.below_passing} below {s.passing_threshold ?? 75}%</span>
        {s.approvals?.length > 0 && <> · approved by {s.approvals.filter(h => h.status === "approved").map(h => h.role).join(", ")}</>}
      </p>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="mt-3 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-lg transition-colors">
        {open ? "Hide details" : "View details"}
      </button>
      {open && <div className="mt-3"><SubmissionDetails s={s} /></div>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => onApprove(submission)}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
          {verb}
        </button>
        <button onClick={() => onReject(submission)}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-white text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors">
          Reject
        </button>
      </div>
    </div>
  );
}

export default function GradeApprovalQueue() {
  const { user } = useAuth();
  const verb = actionVerb(user?.role);
  const [submissions, setSubmissions] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchQueue = useCallback(async () => {
    setFetching(true);
    try {
      const res = await api.get("/grade-submissions/pending");
      setSubmissions(res.data);
    } catch {
      showToast("Failed to load grade submission queue.", "error");
    } finally { setFetching(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleDone = (action, target) => {
    setApproveTarget(null);
    setRejectTarget(null);
    setSubmissions(prev => prev.filter(s => s.id !== target.id));
    const what = `${target.course_code || "Course"} ${PERIOD_LABELS[target.grading_period] || target.grading_period} grades`;
    const msg = action === "rejected"
      ? `${what} sent back to ${target.instructor_name || "the instructor"} with your reason.`
      : `${what} ${action}. ${NEXT_STEP[user?.role] || ""}`;
    showToast(msg, action === "rejected" ? "info" : "success");
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Grade Approval Queue</h1>
            <p className="text-sm text-gray-500 mt-0.5">Review grade submissions from instructors</p>
          </div>
          <button onClick={fetchQueue} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {toast && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            toast.type === "success" ? "bg-green-50 text-green-700 border border-green-200" :
            toast.type === "info" ? "bg-blue-50 text-blue-700 border border-blue-200" :
            "bg-red-50 text-red-700 border border-red-200"
          }`}>{toast.msg}</div>
        )}

        {fetching ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
            <p className="text-sm text-gray-500">No grade submissions pending your review.</p>
            <p className="text-xs text-gray-400 mt-1">Submissions appear here when they reach your step in the approval chain (Program Director → Dean → VP).</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map(s => (
              <SubmissionCard key={s.id} submission={s} verb={verb} onApprove={setApproveTarget} onReject={setRejectTarget} />
            ))}
          </div>
        )}

        {approveTarget && (
          <ApproveModal
            submission={approveTarget}
            verb={verb}
            nextStep={NEXT_STEP[user?.role]}
            onClose={() => setApproveTarget(null)}
            onDone={() => handleDone(verb === "Endorse" ? "endorsed" : "approved", approveTarget)}
          />
        )}
        {rejectTarget && (
          <RejectModal
            submission={rejectTarget}
            onClose={() => setRejectTarget(null)}
            onDone={() => handleDone("rejected", rejectTarget)}
          />
        )}
      </div>
    </Layout>
  );
}
