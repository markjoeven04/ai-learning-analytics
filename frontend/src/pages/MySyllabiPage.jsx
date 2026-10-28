import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import Layout from "../components/Layout";
import SyllabusDetails from "../components/SyllabusDetails";
import { useAuth } from "../context/AuthContext";

const STAGE_LABELS = {
  draft: "Draft",
  pending_pd: "Pending PD",
  pending_dean: "Pending Dean",
  pending_vp: "Pending VP",
  fully_approved: "Fully Approved",
  rejected: "Rejected",
};

const STAGE_COLORS = {
  draft: "bg-gray-100 text-gray-600",
  pending_pd: "bg-amber-100 text-amber-700",
  pending_dean: "bg-amber-100 text-amber-700",
  pending_vp: "bg-amber-100 text-amber-700",
  fully_approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_COLORS = {
  pending: "bg-yellow-100 text-yellow-700",
  validated: "bg-emerald-100 text-emerald-700",
};

const CHAIN_NODES = [
  { key: "pending_pd", label: "PD" },
  { key: "pending_dean", label: "Dean" },
  { key: "pending_vp", label: "VP" },
  { key: "fully_approved", label: "Done" },
];

const STAGE_ORDER = ["draft", "pending_pd", "pending_dean", "pending_vp", "fully_approved"];

function ApprovalChain({ stage }) {
  const currentIdx = STAGE_ORDER.indexOf(stage);
  const rejected = stage === "rejected";

  return (
    <div className="flex items-center gap-1 mt-2">
      {CHAIN_NODES.map((node, i) => {
        const nodeStageIdx = STAGE_ORDER.indexOf(node.key);
        const done = !rejected && (currentIdx > nodeStageIdx || stage === "fully_approved");
        const active = !rejected && currentIdx === nodeStageIdx;

        return (
          <div key={node.key} className="flex items-center gap-1">
            <div className={`
              w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
              ${done ? "bg-green-500 border-green-500 text-white" : ""}
              ${active ? "bg-amber-400 border-amber-400 text-white" : ""}
              ${!done && !active ? "bg-gray-100 border-gray-300 text-gray-400" : ""}
            `}>
              {done ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span>{node.label[0]}</span>
              )}
            </div>
            {i < CHAIN_NODES.length - 1 && (
              <div className={`w-5 h-0.5 ${done ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SyllabusCard({ syllabus, onRefresh, onContinue, loading }) {
  const [open, setOpen] = useState(false);
  const stage = syllabus.approval_stage || "draft";
  const status = syllabus.status || "pending";
  const compCount = (syllabus.competencies || []).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            {syllabus.course_code} &bull; {syllabus.course_academic_period}
          </p>
          <h3 className="text-sm font-semibold text-gray-800 mt-0.5 truncate" title={syllabus.course_title}>{syllabus.course_title}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
            {status}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[stage] || "bg-gray-100 text-gray-600"}`}>
            {STAGE_LABELS[stage] || stage}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span>{compCount} competenc{compCount === 1 ? "y" : "ies"}</span>
      </div>

      <ApprovalChain stage={stage} />

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
          {open ? "Hide" : "View syllabus"}
        </button>
        {stage === "draft" && (
          <button
            onClick={() => onContinue(syllabus)}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Review Competencies &amp; Submit
          </button>
        )}
        {(stage === "pending_pd" || stage === "pending_dean" || stage === "pending_vp") && (
          <button
            onClick={() => onRefresh(syllabus)}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
        {stage === "fully_approved" && (
          <button
            onClick={() => onContinue(syllabus)}
            className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Continue to Assessments
          </button>
        )}
        {stage === "fully_approved" && status === "validated" && (
          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Endorsed · competencies locked
          </span>
        )}
        {stage === "rejected" && (
          <button
            onClick={() => onContinue(syllabus)}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            Revise &amp; Resubmit
          </button>
        )}
      </div>
      {open && <SyllabusDetails s={syllabus} />}
    </div>
  );
}

const TABS = ["All", "Pending", "Approved", "Rejected"];

function filterByTab(syllabi, tab) {
  if (tab === "All") return syllabi;
  if (tab === "Pending") return syllabi.filter(s => ["pending_pd", "pending_dean", "pending_vp"].includes(s.approval_stage));
  if (tab === "Approved") return syllabi.filter(s => s.approval_stage === "fully_approved");
  if (tab === "Rejected") return syllabi.filter(s => s.approval_stage === "rejected");
  return syllabi;
}

export default function MySyllabiPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const DRAFT_KEY = `ailas_wizard_draft:${user?.id}`;
  const [syllabi, setSyllabi] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("All");
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSyllabi = useCallback(async () => {
    try {
      const res = await api.get("/syllabi/mine");
      setSyllabi(res.data);
    } catch {
      setError("Failed to load syllabi.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchSyllabi(); }, [fetchSyllabi]);

  const handleRefresh = async (syllabus) => {
    setActionLoading(true);
    try {
      const res = await api.get(`/syllabi/${syllabus.id}`);
      setSyllabi(prev =>
        prev.map(s => s.id === syllabus.id
          ? { ...s, approval_stage: res.data.approval_stage, status: res.data.status }
          : s
        )
      );
      showToast("Status refreshed.", "success");
    } catch {
      showToast("Could not refresh status.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleContinue = (syllabus) => {
    const draft = {
      step: "validate",
      course: {
        id: syllabus.course_id,
        title: syllabus.course_title,
        code: syllabus.course_code,
        academic_period: syllabus.course_academic_period,
      },
      syllabus: {
        id: syllabus.id,
        course_id: syllabus.course_id,
        status: syllabus.status,
        approval_stage: syllabus.approval_stage,
        parsed_json: syllabus.parsed_json,
        competencies: syllabus.competencies || [],
      },
      editedCompetencies: syllabus.competencies || [],
      originalCompetencies: syllabus.competencies || [],
      approvalStage: syllabus.approval_stage,
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
    navigate("/instructor/processing");
  };

  const handleNewIngestion = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    navigate("/instructor/processing");
  };

  const displayed = filterByTab(syllabi, activeTab);

  const tabCount = (tab) => filterByTab(syllabi, tab).length;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Syllabi</h1>
            <p className="text-sm text-gray-500 mt-0.5">Track submission status and manage your syllabi</p>
          </div>
          <button
            onClick={handleNewIngestion}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Ingestion
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {!fetching && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"
                }`}>
                  {tabCount(tab)}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Toast */}
        {toast && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            toast.type === "success" ? "bg-green-50 text-green-700 border border-green-200" :
            toast.type === "error" ? "bg-red-50 text-red-700 border border-red-200" :
            "bg-blue-50 text-blue-700 border border-blue-200"
          }`}>
            {toast.msg}
          </div>
        )}

        {/* Content */}
        {fetching ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-500 text-sm">{error}</p>
            <button onClick={fetchSyllabi} className="mt-3 text-sm text-indigo-600 hover:underline">Retry</button>
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
            <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 text-sm">
              {activeTab === "All" ? "No syllabi yet." : `No ${activeTab.toLowerCase()} syllabi.`}
            </p>
            {activeTab === "All" && (
              <button
                onClick={handleNewIngestion}
                className="mt-3 text-sm text-indigo-600 hover:underline"
              >
                Upload your first syllabus
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {displayed.map(syllabus => (
              <SyllabusCard
                key={syllabus.id}
                syllabus={syllabus}
                onRefresh={handleRefresh}
                onContinue={handleContinue}
                loading={actionLoading}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
