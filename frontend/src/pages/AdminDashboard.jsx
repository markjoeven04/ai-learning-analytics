import { useState, useEffect, useCallback } from "react";
import Layout from "../components/Layout";
import Pagination from "../components/Pagination";
import { useApi } from "../hooks/useApi";
import api from "../services/api";
import { Link } from "react-router-dom";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
} from "chart.js";

ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement);

const PAGE_SIZE = 5;

function timeAgo(isoString) {
  if (!isoString) return "";
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function refreshedAgo(date) {
  if (!date) return null;
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Skeleton loaders ───────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-lg bg-gray-200 shrink-0" />
      <div className="flex-1">
        <div className="h-6 w-10 bg-gray-200 rounded mb-1.5" />
        <div className="h-3 w-20 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

function RowSkeleton({ cols = 2 }) {
  return (
    <div className="flex items-center gap-2 py-1.5 animate-pulse">
      <div className="w-4 h-3 bg-gray-200 rounded shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="h-3 w-20 bg-gray-200 rounded" />
        <div className="h-2.5 w-32 bg-gray-100 rounded" />
      </div>
      {cols > 1 && <div className="w-10 h-4 bg-gray-200 rounded shrink-0" />}
    </div>
  );
}

// ── StatCard with optional delta indicator ────────────────────────────────────

function StatCard({ label, value, colorClass, icon, delta, deltaLabel }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold text-gray-800 leading-none">{value ?? "—"}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── SectionCard with elevation ─────────────────────────────────────────────────

function SectionCard({ title, children, className = "", action }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex flex-col ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 shrink-0">
          {title && <h2 className="text-base font-semibold text-gray-700">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Audit label / color maps ───────────────────────────────────────────────────

const AUDIT_LABELS = {
  login: "Logged in",
  logout: "Logged out",
  create_user: "Created user",
  deactivate_user: "Deactivated user",
  bulk_import_students: "Bulk imported students",
  upload_syllabus: "Uploaded syllabus",
  validate_syllabus: "Validated syllabus",
  upload_csv: "Uploaded CSV",
  override_tag: "Tag override",
  add_resource: "Resource added",
  delete_resource: "Resource deleted",
  change_password: "Password changed",
  mapping_override: "Mapping reviewed",
  mapping_revert: "Mapping reverted",
  create_custom_competency: "Custom topic tag created",
  ingestion: "File ingested",
};

const INGESTION_KIND_LABELS = {
  syllabus: "Syllabus (PDF/DOCX)",
  assessment_csv: "Assessment CSV",
  topic_mapping_batch: "AI topic mapping (per batch, target < 5 s)",
};

const AUDIT_COLORS = {
  login: "bg-green-100 text-green-700",
  logout: "bg-gray-100 text-gray-500",
  create_user: "bg-indigo-100 text-indigo-700",
  deactivate_user: "bg-red-100 text-red-700",
  bulk_import_students: "bg-blue-100 text-blue-700",
  upload_syllabus: "bg-amber-100 text-amber-700",
  validate_syllabus: "bg-emerald-100 text-emerald-700",
  upload_csv: "bg-purple-100 text-purple-700",
  override_tag: "bg-amber-100 text-amber-700",
  add_resource: "bg-cyan-100 text-cyan-700",
  delete_resource: "bg-red-100 text-red-700",
  change_password: "bg-purple-100 text-purple-700",
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { data: stats,     loading: loadingStats,    refetch: refetchStats }    = useApi("/analytics/admin/stats");
  const { data: subjects,  loading: loadingSubjects, refetch: refetchSubjects } = useApi("/analytics/admin/subject-performance");
  const { data: auditLogs, loading: loadingAudit,    refetch: refetchAudit }    = useApi("/analytics/admin/audit-logs");
  const { data: enrollmentTrends, loading: loadingTrends, refetch: refetchTrends } = useApi("/analytics/admin/enrollment-trends");

  const [logsPage,      setLogsPage]      = useState(1);
  const [failurePage,   setFailurePage]   = useState(1);
  const [topPage,       setTopPage]       = useState(1);
  const [reportsPage,   setReportsPage]   = useState(1);
  const [failureSort,   setFailureSort]   = useState("desc");
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const { data: susResults } = useApi("/surveys/sus/results");
  const { data: ingestion } = useApi("/analytics/admin/ingestion-stats");
  const { data: health } = useApi("/health");

  const TOP_PAGE_SIZE     = 5;
  const FAILURE_PAGE_SIZE = 5;
  const REPORTS_PAGE_SIZE = 5;

  useEffect(() => {
    if (stats !== null) setLastRefreshed(new Date());
  }, [stats]);

  useEffect(() => { setFailurePage(1); }, [failureSort]);

  const handleRefresh = useCallback(() => {
    refetchStats(); refetchSubjects(); refetchAudit(); refetchTrends();
  }, [refetchStats, refetchSubjects, refetchAudit, refetchTrends]);

  // ── Derived lists ─────────────────────────────────────────────────────────────
  const topSubjects = (() => {
    if (!subjects) return [];
    const sorted = [...subjects].sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0));
    const cutoff = sorted[4]?.avg_score ?? null;
    return cutoff !== null ? sorted.filter(s => (s.avg_score || 0) >= cutoff) : sorted.slice(0, 5);
  })();

  const needsReview = subjects ? subjects.filter(s => s.failure_rate > 25) : [];

  const highFailure = subjects
    ? subjects
        .filter(s => s.failure_rate >= 30)
        .sort((a, b) => failureSort === "desc"
          ? b.failure_rate - a.failure_rate
          : a.failure_rate - b.failure_rate
        )
    : [];

  const recentReports = (auditLogs || []).filter(l =>
    ["upload_csv", "upload_syllabus", "validate_syllabus", "bulk_import_students"].includes(l.action)
  );

  // ── 7-day audit activity sparkbar (item 9) ────────────────────────────────────
  const activityDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const activityCounts = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toDateString();
    return (auditLogs || []).filter(l => new Date(l.timestamp).toDateString() === key).length;
  });
  const activityChartData = {
    labels: activityDays,
    datasets: [{
      data: activityCounts,
      backgroundColor: "#6366f1",
      borderRadius: 3,
    }],
  };
  const activityOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { displayColors: false, callbacks: { title: items => items[0].label } },
    },
    scales: {
      x: { display: false },
      y: { display: false, beginAtZero: true },
    },
  };

  // ── Critical subjects banner (item 12) ────────────────────────────────────────
  const criticalSubjects = subjects ? subjects.filter(s => s.failure_rate >= 50) : [];
  const isRefreshing = loadingStats || loadingSubjects || loadingAudit || loadingTrends;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header with data freshness + refresh button (item 7) */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Institutional overview</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {lastRefreshed && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Refreshed {refreshedAgo(lastRefreshed)}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh data"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Critical failure alert banner (item 12) */}
        {criticalSubjects.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-700">Critical Failure Alert</p>
              <p className="text-xs text-red-600 mt-0.5">
                {criticalSubjects.length} subject{criticalSubjects.length !== 1 ? "s" : ""}{" "}
                {criticalSubjects.length !== 1 ? "have" : "has"} a failure rate at or above 50%:{" "}
                {criticalSubjects.map(s => s.course_code).join(", ")}.
              </p>
            </div>
          </div>
        )}

        {/* Stat cards — 6 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {loadingStats ? (
            Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard
                label="Total Users"    value={stats?.total_users}
                colorClass="bg-gray-100 text-gray-600"
                icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"
              />
              <StatCard
                label="Students"       value={stats?.total_students}
                colorClass="bg-indigo-50 text-indigo-600"
                icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
              <StatCard
                label="Instructors"    value={stats?.total_instructors}
                colorClass="bg-emerald-50 text-emerald-600"
                icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
              <StatCard
                label="Active Courses" value={stats?.total_courses}
                colorClass="bg-amber-50 text-amber-600"
                icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
              <StatCard
                label="Syllabi"        value={stats?.total_syllabi}
                colorClass="bg-purple-50 text-purple-600"
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
              <StatCard
                label="Resources"      value={stats?.total_resources}
                colorClass="bg-green-50 text-green-600"
                icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </>
          )}
        </div>

        {/* Top Subjects + Needs Review + Failure Rate — 3-col */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Top Performing Subjects */}
          <SectionCard title="Top Performing Subjects">
            {loadingSubjects ? (
              <div className="flex-1 space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}
              </div>
            ) : topSubjects.length ? (
              <>
                <div className="flex-1 space-y-1">
                  {topSubjects.slice((topPage - 1) * TOP_PAGE_SIZE, topPage * TOP_PAGE_SIZE).map((s, i) => (
                    <div key={s.course_id} className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <span className="text-xs font-bold text-gray-300 w-4 shrink-0">
                        {(topPage - 1) * TOP_PAGE_SIZE + i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-indigo-600">{s.course_code}</p>
                        <p className="text-xs text-gray-600 truncate">{s.course_title}</p>
                      </div>
                      <span className="text-sm font-bold text-green-600 shrink-0">{s.avg_score}%</span>
                    </div>
                  ))}
                </div>
                <Pagination page={topPage} total={topSubjects.length} pageSize={TOP_PAGE_SIZE} onChange={setTopPage} />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-xs text-gray-400">No subject data yet.</p>
                <p className="text-xs text-gray-300 mt-0.5">Appears after assessments are graded.</p>
              </div>
            )}
          </SectionCard>

          {/* Subjects Requiring Review */}
          <SectionCard title="Subjects Requiring Review">
            {loadingSubjects ? (
              <div className="flex-1 space-y-1">
                {Array.from({ length: 4 }).map((_, i) => <RowSkeleton key={i} />)}
              </div>
            ) : needsReview.length ? (
              <div className="flex-1 space-y-1">
                {needsReview.slice(0, 5).map(s => (
                  <div key={s.course_id} className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-red-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-red-500">{s.course_code}</p>
                      <p className="text-xs text-gray-600 truncate">{s.course_title}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-red-600">{s.failure_rate}%</p>
                      <p className="text-xs text-gray-400">fail rate</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-green-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-gray-400">All subjects are performing well.</p>
                <p className="text-xs text-gray-300 mt-0.5">No subjects above 25% failure rate.</p>
              </div>
            )}
          </SectionCard>

          {/* Failure Rate by Subject — with sort toggle (item 11) */}
          <SectionCard
            title="Failure Rate by Subject"
            action={
              <button
                onClick={() => setFailureSort(s => s === "desc" ? "asc" : "desc")}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                title={failureSort === "desc" ? "Show lowest first" : "Show highest first"}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d={failureSort === "desc"
                      ? "M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                      : "M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"
                    }
                  />
                </svg>
                {failureSort === "desc" ? "Highest" : "Lowest"}
              </button>
            }
          >
            {loadingSubjects ? (
              <div className="flex-1 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <RowSkeleton key={i} cols={2} />)}
              </div>
            ) : highFailure.length ? (
              <>
                <div className="flex-1 space-y-2.5">
                  {highFailure.slice((failurePage - 1) * FAILURE_PAGE_SIZE, failurePage * FAILURE_PAGE_SIZE).map(s => (
                    <div key={s.course_id} className="px-2 py-1 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-mono text-indigo-600 mr-1.5 whitespace-nowrap">{s.course_code}</span>
                          <span className="text-xs text-gray-700 truncate">{s.course_title}</span>
                        </div>
                        <div className="text-right ml-3 shrink-0">
                          <span className={`text-sm font-bold ${s.failure_rate >= 50 ? "text-red-600" : "text-amber-600"}`}>
                            {s.failure_rate}%
                          </span>
                          <p className="text-xs text-gray-400">{s.failing_count}/{s.total_students} failing</p>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${s.failure_rate >= 50 ? "bg-red-400" : "bg-amber-400"}`}
                          style={{ width: `${s.failure_rate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Pagination page={failurePage} total={highFailure.length} pageSize={FAILURE_PAGE_SIZE} onChange={setFailurePage} />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-green-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-gray-400">No subjects at 30% failure rate or above.</p>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── NEW: Enrollment & Performance Trends + Failure Rate by Subject ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Enrollment & Performance Trends — dual-axis mixed chart */}
          <SectionCard title="Enrollment & Performance Trends">
            {loadingTrends ? (
              <div className="h-64 flex items-end gap-1.5 animate-pulse">
                {[55, 70, 45, 80, 60, 75, 50, 65].map((h, i) => (
                  <div key={i} className="flex-1 bg-gray-100 rounded-t" style={{ height: `${h}%` }} />
                ))}
              </div>
            ) : enrollmentTrends?.length ? (() => {
              const worstIdx = enrollmentTrends.reduce(
                (minI, row, i, arr) => (row.avg_score ?? 100) < (arr[minI]?.avg_score ?? 100) ? i : minI,
                0
              );
              const pointColors = enrollmentTrends.map((_, i) =>
                i === worstIdx ? "#ef4444" : "rgba(245,158,11,1)"
              );
              const pointRadii = enrollmentTrends.map((_, i) =>
                i === worstIdx ? 8 : 4
              );
              const trendData = {
                labels: enrollmentTrends.map(r => r.period),
                datasets: [
                  {
                    type: "bar",
                    label: "Student Count",
                    data: enrollmentTrends.map(r => r.student_count),
                    backgroundColor: "rgba(99,102,241,0.75)",
                    borderRadius: 5,
                    yAxisID: "y",
                    order: 2,
                  },
                  {
                    type: "line",
                    label: "Avg Score",
                    data: enrollmentTrends.map(r => r.avg_score),
                    borderColor: "#f59e0b",
                    borderWidth: 2.5,
                    tension: 0.3,
                    pointBackgroundColor: pointColors,
                    pointRadius: pointRadii,
                    pointHoverRadius: 6,
                    yAxisID: "y1",
                    order: 1,
                    fill: false,
                  },
                ],
              };
              const trendOptions = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                  legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
                  tooltip: {
                    callbacks: {
                      afterBody: (items) => {
                        const lineItem = items.find(i => i.datasetIndex === 1);
                        if (lineItem && lineItem.dataIndex === worstIdx) {
                          return ["⚠ Worst period"];
                        }
                        return [];
                      },
                    },
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  y: {
                    type: "linear",
                    position: "left",
                    beginAtZero: true,
                    ticks: { font: { size: 10 } },
                    grid: { color: "rgba(0,0,0,0.04)" },
                    title: { display: true, text: "Students", font: { size: 10 }, color: "#6366f1" },
                  },
                  y1: {
                    type: "linear",
                    position: "right",
                    beginAtZero: false,
                    min: 0,
                    max: 100,
                    ticks: { font: { size: 10 } },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "Avg Score (%)", font: { size: 10 }, color: "#f59e0b" },
                  },
                },
              };
              return (
                <div className="h-64">
                  <Bar data={trendData} options={trendOptions} />
                </div>
              );
            })() : (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-xs text-gray-400">No enrollment trend data yet.</p>
              </div>
            )}
          </SectionCard>

          {/* Failure Rate by Subject — ranked list */}
          <SectionCard title="Failure Rate by Subject">
            {loadingSubjects ? (
              <div className="flex-1 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse space-y-1">
                    <div className="flex justify-between">
                      <div className="h-3 w-28 bg-gray-200 rounded" />
                      <div className="h-3 w-10 bg-gray-100 rounded" />
                    </div>
                    <div className="h-1.5 w-full bg-gray-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : subjects?.length ? (
              <div className="flex-1 space-y-2.5">
                {[...subjects]
                  .sort((a, b) => b.failure_rate - a.failure_rate)
                  .slice(0, 10)
                  .map(s => (
                    <div key={s.course_id} className="px-2 py-1 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
                          <span className="text-xs font-mono text-indigo-600 shrink-0">{s.course_code}</span>
                          <span className="text-xs text-gray-600 truncate">{s.course_title}</span>
                        </div>
                        <span className={`text-xs font-bold ml-3 shrink-0 ${
                          s.failure_rate >= 50 ? "text-red-600" : s.failure_rate >= 25 ? "text-amber-600" : "text-green-600"
                        }`}>
                          {s.failure_rate}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            s.failure_rate >= 50 ? "bg-red-400" : s.failure_rate >= 25 ? "bg-amber-400" : "bg-green-400"
                          }`}
                          style={{ width: `${Math.min(s.failure_rate, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-green-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-gray-400">No subject failure data yet.</p>
              </div>
            )}
          </SectionCard>
        </div>

        {/* What the external AI provider receives (panel comments 6 and 7) */}
        {health?.llm && (
          <SectionCard title="AI Provider and Data Handling">
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">Providers</p>
                {Object.keys(health.llm.providers || {}).length ? (
                  Object.entries(health.llm.providers).map(([name, state]) => (
                    <p key={name} className="text-gray-800 capitalize">{name} <span className={`text-xs ${state === "closed" ? "text-green-600" : "text-amber-600"}`}>· {state === "closed" ? "available" : state.replace("_", "-")}</span></p>
                  ))
                ) : <p className="text-amber-600">None configured (rule-based fallbacks in use)</p>}
                <p className="text-xs text-gray-400 mt-1">Gemini fallback: {health.llm.data_handling?.gemini_fallback_enabled ? "enabled" : "disabled"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Sent to the provider</p>
                <p className="text-gray-700">{health.llm.data_handling?.sent}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Never sent</p>
                <p className="text-gray-700">Student numbers, names, emails, scores, grades or risk results. Requests are sent with storage disabled (<code className="text-xs">store=false</code>).</p>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Ingestion parse rate and latency vs. capstone §3.1 Objective 1 targets */}
        {ingestion?.kinds?.length > 0 && (
          <SectionCard title="File Ingestion">
            <p className="text-xs text-gray-500 mb-3">
              Target: 100% of valid files parsed, each in under {ingestion.target_ms / 1000} s.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th scope="col" className="py-1.5 pr-3 font-medium">File type</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">Attempts</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">Parsed</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">Median</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">95th pct</th>
                    <th scope="col" className="py-1.5 font-medium text-right">Under target</th>
                  </tr>
                </thead>
                <tbody>
                  {ingestion.kinds.map(k => (
                    <tr key={k.kind} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 pr-3 text-gray-700">{INGESTION_KIND_LABELS[k.kind] || k.kind}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-700">{k.attempts}</td>
                      <td className={`py-1.5 pr-3 text-right font-semibold ${k.parse_rate_pct === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                        {k.parse_rate_pct}%
                      </td>
                      <td className="py-1.5 pr-3 text-right text-gray-700">{(k.median_ms / 1000).toFixed(2)} s</td>
                      <td className="py-1.5 pr-3 text-right text-gray-700">{(k.p95_ms / 1000).toFixed(2)} s</td>
                      <td className={`py-1.5 text-right font-semibold ${k.within_target_pct === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                        {k.within_target_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ── NEW: Recent Activity feed ── */}
        <SectionCard
          title="Recent Activity"
          action={<Link to="/admin/audit-logs" className="text-xs text-indigo-600 hover:underline">View All →</Link>}
        >
          {loadingAudit ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-40 bg-gray-200 rounded" />
                  </div>
                  <div className="h-3 w-14 bg-gray-100 rounded shrink-0" />
                </div>
              ))}
            </div>
          ) : auditLogs?.length ? (
            <div className="space-y-1">
              {auditLogs.filter(log => log.action !== "ingestion").slice(0, 5).map(log => {
                const dotColor = {
                  login: "bg-green-400",
                  logout: "bg-gray-300",
                  create_user: "bg-indigo-400",
                  deactivate_user: "bg-red-400",
                  bulk_import_students: "bg-blue-400",
                  upload_syllabus: "bg-amber-400",
                  validate_syllabus: "bg-emerald-400",
                  upload_csv: "bg-purple-400",
                  override_tag: "bg-amber-400",
                  add_resource: "bg-cyan-400",
                  delete_resource: "bg-red-400",
                  change_password: "bg-purple-400",
                }[log.action] || "bg-gray-300";
                return (
                  <div key={log.id} className="flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <p className="text-xs text-gray-700 flex-1 min-w-0">
                      <span className="font-semibold">{log.actor_name || "Unknown"}</span>
                      {" "}
                      <span className="text-gray-500">{AUDIT_LABELS[log.action] || log.action}</span>
                    </p>
                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(log.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-gray-400">No recent activity.</p>
            </div>
          )}
        </SectionCard>

        {/* Recent Reports + Security & Audit Logs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Recent Reports */}
          <SectionCard title="Recent Reports">
            {loadingAudit ? (
              <div className="flex-1 space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}
              </div>
            ) : recentReports.length ? (
              <>
                <div className="flex-1 space-y-1">
                  {recentReports.slice((reportsPage - 1) * REPORTS_PAGE_SIZE, reportsPage * REPORTS_PAGE_SIZE).map(log => (
                    <div key={log.id} className="flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 capitalize">{log.action.replace(/_/g, " ")}</p>
                        <p className="text-xs text-gray-400 truncate">{log.actor_name || "—"}</p>
                      </div>
                      <p className="text-xs text-gray-400 shrink-0">{new Date(log.timestamp).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
                <Pagination page={reportsPage} total={recentReports.length} pageSize={REPORTS_PAGE_SIZE} onChange={setReportsPage} />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-xs text-gray-400">No reports yet.</p>
                <p className="text-xs text-gray-300 mt-0.5">Appears after CSV or syllabus uploads.</p>
              </div>
            )}
          </SectionCard>

          {/* Security & Audit Logs */}
          <SectionCard
            title="Security & Audit Logs"
            action={<Link to="/audit-logs" className="text-xs text-indigo-600 hover:underline">View all</Link>}
          >
            {loadingAudit ? (
              <div className="flex-1 space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} cols={3} />)}
              </div>
            ) : auditLogs?.length ? (
              <>
                {/* 7-day activity sparkbar (item 9) */}
                <div className="shrink-0 mb-3">
                  <p className="text-xs text-gray-400 mb-1.5">7-day activity</p>
                  <div className="h-14">
                    <Bar data={activityChartData} options={activityOptions} />
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  {auditLogs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE).map(log => (
                    <div key={log.id} className="flex items-start gap-2.5 px-2 py-1.5 -mx-2 rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                      <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${AUDIT_COLORS[log.action] || "bg-gray-100 text-gray-600"}`}>
                        {AUDIT_LABELS[log.action] || log.action}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-700 truncate">
                          {log.actor_name || "Unknown"}
                          {log.extra_data?.email && <span className="text-gray-400"> · {log.extra_data.email}</span>}
                        </p>
                        {log.extra_data?.file && (
                          <p className="text-xs text-gray-400 truncate">{log.extra_data.file}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{timeAgo(log.timestamp)}</span>
                    </div>
                  ))}
                </div>
                <Pagination page={logsPage} total={auditLogs.length} pageSize={PAGE_SIZE} onChange={setLogsPage} />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <svg className="w-8 h-8 text-gray-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-xs text-gray-400">No audit entries yet.</p>
              </div>
            )}
          </SectionCard>
        </div>

        {/* T11-06: SUS Score */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* SUS Score Card */}
          <SectionCard
            title="System Usability Scale (SUS)"
            action={
              <Link to="/sus-survey" className="text-xs text-indigo-600 hover:underline font-medium">
                Take Survey →
              </Link>
            }
          >
            {!susResults || susResults.total_responses === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-xs text-gray-400">No survey responses yet.</p>
                <p className="text-xs text-gray-300 mt-0.5">Share the survey link with users to collect SUS scores.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <p className={`text-4xl font-bold leading-none ${
                      susResults.avg_sus_score >= 80 ? "text-green-600"
                      : susResults.avg_sus_score >= 68 ? "text-indigo-600"
                      : susResults.avg_sus_score >= 51 ? "text-amber-600"
                      : "text-red-600"
                    }`}>{susResults.avg_sus_score}</p>
                    <p className="text-xs text-gray-400 mt-0.5">avg score</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
                        susResults.avg_sus_score >= 80 ? "bg-green-100 text-green-700"
                        : susResults.avg_sus_score >= 68 ? "bg-indigo-100 text-indigo-700"
                        : susResults.avg_sus_score >= 51 ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                      }`}>{susResults.usability_rating}</span>
                      <span className="text-xs text-gray-400">{susResults.total_responses} response{susResults.total_responses !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          susResults.avg_sus_score >= 80 ? "bg-green-400"
                          : susResults.avg_sus_score >= 68 ? "bg-indigo-400"
                          : susResults.avg_sus_score >= 51 ? "bg-amber-400"
                          : "bg-red-400"
                        }`}
                        style={{ width: `${susResults.avg_sus_score}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-lg py-2">
                    <p className="text-sm font-bold text-gray-700">{susResults.min_score}</p>
                    <p className="text-xs text-gray-400">Min</p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg py-2">
                    <p className="text-sm font-bold text-indigo-700">{susResults.avg_sus_score}</p>
                    <p className="text-xs text-indigo-400">Avg</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg py-2">
                    <p className="text-sm font-bold text-gray-700">{susResults.max_score}</p>
                    <p className="text-xs text-gray-400">Max</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  {susResults.threshold_pct}% of respondents scored ≥ 68 (acceptable threshold)
                </p>
              </div>
            )}
          </SectionCard>


        </div>

      </div>
    </Layout>
  );
}
