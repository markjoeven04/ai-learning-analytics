import { useEffect, useState, useCallback } from "react";
import api from "../services/api";
import Layout from "../components/Layout";

const CRITERIA_LABELS = {
  content_validity: "Content is valid and relevant to learning outcomes",
  difficulty_appropriate: "Difficulty level is appropriate for the students",
  instructions_clear: "Instructions are clear and unambiguous",
  bias_free: "No cultural, gender, or socioeconomic bias detected",
  outcomes_covered: "Assessment items cover the stated course outcomes",
};

const PERIOD_LABELS = { prelim: "Prelim", midterm: "Midterm", semi_final: "Semi-Final", final: "Final" };
const TYPE_LABELS = { quiz: "Quiz", exam: "Exam", assignment: "Assignment" };
const QTYPE_LABELS = { multiple_choice: "Multiple choice", short_answer: "Short answer", problem: "Problem" };

// Course, instructor and assessment by name, not by ID.
function AssessmentInfo({ a }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-gray-800 truncate" title={a.course_title}>
        {a.course_code && <span className="text-indigo-600 mr-1.5">{a.course_code}</span>}
        {a.course_title || "Course"}
      </p>
      <p className="text-sm text-gray-700 mt-0.5">
        {a.title} <span className="text-xs text-gray-500">· {TYPE_LABELS[a.type] || a.type} · {PERIOD_LABELS[a.grading_period] || a.grading_period}</span>
      </p>
      <p className="text-xs text-gray-500">
        {[a.instructor_name && `Instructor: ${a.instructor_name}`, a.course_academic_period].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

// The drafted questions the Program Director is approving (read-only).
function QuestionList({ assessmentId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api.get(`/assessments/${assessmentId}/questions`)
      .then(res => { if (!cancelled) setData(res.data.questions); })
      .catch(() => { if (!cancelled) setError("Could not load the questions."); });
    return () => { cancelled = true; };
  }, [assessmentId]);

  if (error) return <p className="text-xs text-red-500">{error}</p>;
  if (!data) return <p className="text-xs text-gray-400">Loading questions…</p>;
  if (data.length === 0) {
    return (
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        The instructor has not drafted any questions in AILAS for this assessment, so there is nothing to review here.
        Ask the instructor for the test paper, or reject it and ask them to add the questions.
      </p>
    );
  }
  const total = data.reduce((sum, q) => sum + (q.points || 0), 0);
  return (
    <section className="rounded-lg border border-gray-200">
      <p className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-100">
        Questions <span className="font-normal normal-case text-gray-400">({data.length} · {total} points)</span>
      </p>
      <ol className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {data.map((q, i) => (
          <li key={q.id} className="px-3 py-2 text-sm">
            <p className="text-gray-800"><span className="font-semibold text-gray-500 mr-1">{i + 1}.</span>{q.question_text}</p>
            {q.choices?.length > 0 && (
              <ul className="mt-1 ml-5 text-xs text-gray-600 list-[lower-alpha] list-inside">
                {q.choices.map((c, k) => (
                  <li key={k} className={c === q.answer_key ? "text-emerald-700 font-medium" : ""}>{c}{c === q.answer_key ? " ✓" : ""}</li>
                ))}
              </ul>
            )}
            {!q.choices?.length && q.answer_key && <p className="mt-1 ml-5 text-xs text-gray-500">Answer key: {q.answer_key}</p>}
            <p className="mt-1 ml-5 text-xs text-gray-400">
              {[QTYPE_LABELS[q.question_type] || q.question_type, `${q.points} pt${q.points === 1 ? "" : "s"}`,
                q.competency_code ? `${q.competency_code} ${q.topic_name || ""}` : "No competency tagged", q.bloom_level].filter(Boolean).join(" · ")}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Advisory TOS / Bloom alignment hints (capstone §3.11.2 Phase 2), shown while reviewing.
function AlignmentHints({ assessmentId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/assessments/${assessmentId}/alignment-hints`)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [assessmentId]);

  if (!data) return null;
  const warnings = data.hints.filter(h => h.severity === "warning");
  const infos = data.hints.filter(h => h.severity !== "warning");
  return (
    <section aria-labelledby={`hints-${assessmentId}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p id={`hints-${assessmentId}`} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Alignment check <span className="font-normal normal-case text-gray-400">(advisory)</span>
      </p>
      {data.hints.length === 0 ? (
        <p className="text-xs text-emerald-700 mt-1">
          All {data.question_count} drafted questions match the Table of Specifications.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
          {[...warnings, ...infos].map((h, i) => (
            <li key={i} className={`text-xs ${h.severity === "warning" ? "text-amber-700" : "text-gray-500"}`}>
              {h.question_number ? <span className="font-semibold">Q{h.question_number}: </span> : null}
              {h.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApproveModal({ assessment, onClose, onDone }) {
  const [criteria, setCriteria] = useState({
    content_validity: false,
    difficulty_appropriate: false,
    instructions_clear: false,
    bias_free: false,
    outcomes_covered: false,
  });
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allCriteriaMet = Object.values(criteria).every(Boolean);

  const handleSubmit = async () => {
    setLoading(true); setError("");
    try {
      await api.post(`/assessments/${assessment.id}/approve`, { ...criteria, feedback: feedback || null });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail || "Approval failed.");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Approve Assessment</h2>
          <p className="text-xs text-gray-400">Once approved, the instructor is notified and can give the assessment and upload its scores.</p>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <AssessmentInfo a={assessment} />
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">You can read this exam but not change it — the content belongs to the instructor. If something needs fixing, return it with your reason and the instructor revises it.</p>
          <QuestionList assessmentId={assessment.id} />
          <AlignmentHints assessmentId={assessment.id} />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Review Criteria <span className="font-normal normal-case text-gray-400">(confirm each after reading the questions)</span></p>
          {Object.entries(CRITERIA_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={criteria[key]}
                onChange={e => setCriteria(c => ({ ...c, [key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className={`text-sm ${criteria[key] ? "text-gray-800" : "text-gray-500"}`}>{label}</span>
            </label>
          ))}
          {!allCriteriaMet && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              All criteria must be checked before approving.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Optional Comments</label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={2}
              placeholder="Any notes for the instructor…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !allCriteriaMet}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Approving…" : "Approve Assessment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ assessment, onClose, onDone }) {
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!feedback.trim()) { setError("Feedback is required for rejection."); return; }
    setLoading(true); setError("");
    try {
      await api.post(`/assessments/${assessment.id}/reject`, { feedback });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.detail || "Rejection failed.");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Return Assessment to Instructor</h2>
          <p className="text-xs text-gray-400">The instructor is notified with your reason and can revise and resubmit.</p>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          <AssessmentInfo a={assessment} />
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">You can read this exam but not change it — the content belongs to the instructor. If something needs fixing, return it with your reason and the instructor revises it.</p>
          <QuestionList assessmentId={assessment.id} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What the instructor should revise <span className="text-red-500">*</span></label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={4}
              placeholder="Explain what needs to be revised…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !feedback.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Returning…" : "Return to Instructor"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssessmentCard({ assessment, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <AssessmentInfo a={assessment} />
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium shrink-0">
          Pending Review
        </span>
      </div>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="mt-3 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-lg transition-colors">
        {open ? "Hide questions" : "View questions"}
      </button>
      {open && <div className="mt-3"><QuestionList assessmentId={assessment.id} /></div>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onApprove(assessment)}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onReject(assessment)}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-white text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
        >
          Return
        </button>
      </div>
    </div>
  );
}

export default function AssessmentApprovalQueue() {
  const [assessments, setAssessments] = useState([]);
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
      const res = await api.get("/assessments/pending-approval");
      setAssessments(res.data);
    } catch {
      showToast("Failed to load assessment queue.", "error");
    } finally { setFetching(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleActionDone = (action) => {
    const target = action === "approved" ? approveTarget : rejectTarget;
    setApproveTarget(null);
    setRejectTarget(null);
    setAssessments(prev => prev.filter(a => a.id !== target?.id));
    const who = target?.instructor_name || "The instructor";
    showToast(action === "approved"
      ? `"${target?.title}" approved. ${who} has been notified and can now give it and upload scores.`
      : `"${target?.title}" sent back. ${who} has been notified with your reason.`,
      action === "approved" ? "success" : "info");
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Assessment Approval Queue</h1>
            <p className="text-sm text-gray-500 mt-0.5">Review and approve instructor assessments before grade upload</p>
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
            toast.type === "error" ? "bg-red-50 text-red-700 border border-red-200" :
            "bg-blue-50 text-blue-700 border border-blue-200"
          }`}>
            {toast.msg}
          </div>
        )}

        {fetching ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : assessments.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
            <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p className="text-gray-500 text-sm">No assessments pending review.</p>
            <p className="text-xs text-gray-400 mt-1">Assessments appear here when an instructor in your college submits one for review.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments.map(a => (
              <AssessmentCard
                key={a.id}
                assessment={a}
                onApprove={setApproveTarget}
                onReject={setRejectTarget}
              />
            ))}
          </div>
        )}

        {approveTarget && (
          <ApproveModal
            assessment={approveTarget}
            onClose={() => setApproveTarget(null)}
            onDone={() => handleActionDone("approved")}
          />
        )}
        {rejectTarget && (
          <RejectModal
            assessment={rejectTarget}
            onClose={() => setRejectTarget(null)}
            onDone={() => handleActionDone("rejected")}
          />
        )}
      </div>
    </Layout>
  );
}
