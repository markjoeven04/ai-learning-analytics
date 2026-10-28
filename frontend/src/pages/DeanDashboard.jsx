import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import Pagination from "../components/Pagination";
import { useApi } from "../hooks/useApi";
import api from "../services/api";
import { Bar } from "react-chartjs-2";
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

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
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

function StatCard({ label, value, colorClass, icon }) {
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

function ApprovalStatCard({ label, count, color, to }) {
  const card = (
    <div className={`rounded-xl border p-5 transition-shadow hover:shadow-md ${color}`}>
      <p className="text-3xl font-bold">{count === null ? <span className="animate-pulse">—</span> : count}</p>
      <p className="text-sm mt-1 font-medium">{label}</p>
      {to && <p className="text-xs mt-2 opacity-70">View queue →</p>}
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

export default function DeanDashboard() {
  const { data: stats, loading: loadingStats, refetch: refetchStats } = useApi("/analytics/college/stats");
  const { data: subjects, loading: loadingSubjects, refetch: refetchSubjects } = useApi("/analytics/college/subject-performance");
  const { data: enrollmentTrends, loading: loadingTrends, refetch: refetchTrends } = useApi("/analytics/college/enrollment-trends");

  const [approvalCounts, setApprovalCounts] = useState({ syllabi: null, grades: null });
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [topPage, setTopPage] = useState(1);
  const [failurePage, setFailurePage] = useState(1);
  const [failureSort, setFailureSort] = useState("desc");

  const TOP_PAGE_SIZE = 5;
  const FAILURE_PAGE_SIZE = 5;

  useEffect(() => {
    const load = async () => {
      const [syllabi, grades] = await Promise.allSettled([
        api.get("/syllabi/pending-approval"),
        api.get("/grade-submissions/pending"),
      ]);
      setApprovalCounts({
        syllabi: syllabi.status === "fulfilled" ? syllabi.value.data.length : 0,
        grades: grades.status === "fulfilled" ? grades.value.data.length : 0,
      });
    };
    load();
  }, []);

  useEffect(() => {
    if (stats !== null) setLastRefreshed(new Date());
  }, [stats]);

  useEffect(() => { setFailurePage(1); }, [failureSort]);

  const handleRefresh = useCallback(() => {
    refetchStats(); refetchSubjects(); refetchTrends();
  }, [refetchStats, refetchSubjects, refetchTrends]);

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

  const criticalSubjects = subjects ? subjects.filter(s => s.failure_rate >= 50) : [];
  const isRefreshing = loadingStats || loadingSubjects || loadingTrends;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Dean Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">College performance overview and endorsement queue</p>
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

        {/* Critical failure alert */}
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

        {/* College stat cards — 4 (no user count) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {loadingStats ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard
                label="Instructors" value={stats?.total_instructors}
                colorClass="bg-emerald-50 text-emerald-600"
                icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
              <StatCard
                label="Active Courses" value={stats?.total_courses}
                colorClass="bg-amber-50 text-amber-600"
                icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
              <StatCard
                label="Syllabi" value={stats?.total_syllabi}
                colorClass="bg-purple-50 text-purple-600"
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
              <StatCard
                label="Students" value={stats?.total_students}
                colorClass="bg-indigo-50 text-indigo-600"
                icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </>
          )}
        </div>

        {/* Approval queue — Dean only sees Syllabi + Grade Submissions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ApprovalStatCard label="Syllabi Awaiting Endorsement" count={approvalCounts.syllabi}
            color="bg-amber-50 border-amber-200 text-amber-700" to="/syllabus-approval" />
          <ApprovalStatCard label="Grade Submissions Awaiting" count={approvalCounts.grades}
            color="bg-indigo-50 border-indigo-200 text-indigo-700" to="/grade-approval" />
        </div>

        {/* 3-col subject panels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

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
              </div>
            )}
          </SectionCard>

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
              </div>
            )}
          </SectionCard>

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

        {/* Enrollment Trends + Failure Rate ranked list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <SectionCard title="Enrollment &amp; Performance Trends">
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
              const pointRadii = enrollmentTrends.map((_, i) => i === worstIdx ? 8 : 4);
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

      </div>
    </Layout>
  );
}
