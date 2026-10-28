import { useState, useRef, useEffect } from "react";
import Pagination from "../components/Pagination";
import { Line, Radar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler,
} from "chart.js";
import Layout from "../components/Layout";
import RiskBadge from "../components/RiskBadge";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { useThresholds } from "../hooks/useThresholds";
import { openResourceFile } from "../utils/resourceFile";

ChartJS.register(
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler,
);

const RISK_COLOR = {
  "At-Risk":  { border: "border-red-400",    bg: "bg-red-50",   text: "text-red-700"   },
  "On-Track": { border: "border-green-400",  bg: "bg-green-50", text: "text-green-700" },
  "Excelling":{ border: "border-blue-400",   bg: "bg-blue-50",  text: "text-blue-700"  },
};

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800 leading-none">{value ?? "—"}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-24">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-600">Select a course</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs">Choose a course from the list to view your performance breakdown, trends, and study recommendations.</p>
    </div>
  );
}

const PAGE_SIZE = 10;

function CourseDetail({ course }) {
  const T = useThresholds();
  const cid = course.id;
  const { data: risk }   = useApi(`/analytics/me/risk?course_id=${cid}`, [cid]);
  const { data: scores } = useApi(`/analytics/me/competency-scores?course_id=${cid}`, [cid]);
  const { data: trend }  = useApi(`/analytics/me/trend?course_id=${cid}`, [cid]);
  const { data: recs }   = useApi(`/analytics/me/recommendations?course_id=${cid}`, [cid]);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [cid]);

  const avgScore = scores?.length
    ? Math.round(scores.reduce((s, c) => s + c.average_score, 0) / scores.length)
    : null;
  const weakCount = scores?.filter(c => c.is_weak).length ?? 0;
  const totalComps = scores?.length ?? 0;
  const masteryPct = totalComps > 0 ? Math.round(((totalComps - weakCount) / totalComps) * 100) : null;

  const trendPoints = trend?.filter(t => t.score !== null) ?? [];
  const trendChartData = trendPoints.length > 0 ? {
    labels: trendPoints.map(t => t.period),
    datasets: [{
      label: "Score (%)",
      data: trendPoints.map(t => t.score),
      borderColor: "#6366f1",
      backgroundColor: "rgba(99,102,241,0.08)",
      borderWidth: 2.5,
      pointBackgroundColor: "#6366f1",
      pointRadius: 5,
      tension: 0.35,
      fill: true,
    }],
  } : null;

  const radarData = scores?.length ? {
    labels: scores.map(s => s.competency_code),
    datasets: [
      {
        label: "Your Score",
        data: scores.map(s => s.average_score),
        backgroundColor: "rgba(99,102,241,0.15)",
        borderColor: "rgba(99,102,241,0.85)",
        borderWidth: 2,
        pointBackgroundColor: scores.map(s => s.is_weak ? "#ef4444" : "#6366f1"),
        pointRadius: 4,
      },
      {
        label: `Passing (${T.mastery_threshold}%)`,
        data: scores.map(() => T.mastery_threshold),
        backgroundColor: "transparent",
        borderColor: "rgba(156,163,175,0.5)",
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
      },
    ],
  } : null;

  const riskCfg = RISK_COLOR[risk?.risk_level] ?? {};

  return (
    <div className="h-full overflow-y-auto space-y-5 pr-1">
      {/* Course header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
              {course.code}
            </span>
            {course.academic_period && (
              <span className="text-xs text-gray-400">{course.academic_period}</span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-800">{course.title}</h2>
          {course.instructor_name && (
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {course.instructor_name}
            </p>
          )}
        </div>
        {risk && <RiskBadge level={risk.risk_level} size="lg" />}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Average Score"
          value={avgScore !== null ? `${avgScore}%` : null}
          sub="across all assessments"
          accent="border-gray-200 bg-white"
        />
        <StatCard
          label="Competency Mastery"
          value={masteryPct !== null ? `${masteryPct}%` : null}
          sub={`${totalComps - weakCount} of ${totalComps} passed`}
          accent="border-gray-200 bg-white"
        />
        <StatCard
          label="Weak Areas"
          value={weakCount > 0 ? weakCount : "None"}
          sub={weakCount > 0 ? `competencies below ${T.mastery_threshold}%` : "all competencies passing"}
          accent={weakCount > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}
        />
      </div>

      {/* Charts row */}
      {(trendChartData || radarData) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {trendChartData && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score Trend</p>
              <figure aria-label="Score trend line chart">
              <Line
                data={trendChartData}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { min: 0, max: 100, ticks: { stepSize: 25 }, grid: { color: "#f8fafc" } },
                    x: { grid: { display: false } },
                  },
                }}
                height={140}
              />
              </figure>
            </div>
          )}
          {radarData && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Competency Radar</p>
              <figure aria-label="Competency radar chart">
              <Radar
                data={radarData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
                  scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } } } },
                }}
                height={140}
              />
              </figure>
            </div>
          )}
        </div>
      )}

      {/* Competency table */}
      {scores?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Competency Breakdown</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                <th className="px-5 py-2.5 text-left">Code</th>
                <th className="px-5 py-2.5 text-left">Topic</th>
                <th className="px-5 py-2.5 text-left w-40">Progress</th>
                <th className="px-5 py-2.5 text-right w-20">Score</th>
                <th className="px-5 py-2.5 text-right w-20">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scores.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(c => (
                <tr key={c.competency_code} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs font-bold text-indigo-600">{c.competency_code}</td>
                  <td className="px-5 py-3 text-gray-700">{c.topic_name}</td>
                  <td className="px-5 py-3">
                    <div className="h-1.5 bg-gray-100 rounded-full">
                      <div
                        className={`h-1.5 rounded-full transition-all ${c.is_weak ? "bg-red-400" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(c.average_score, 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-700">
                    {c.average_score.toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 text-right">
                    {c.is_weak
                      ? <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Weak</span>
                      : <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Passing</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} total={scores.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      )}

      {/* Recommendations */}
      {recs?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommended Resources</p>
          </div>
          <div className="divide-y divide-gray-100">
            {recs.slice(0, 4).map((r, i) => (
              <div key={i} className="px-5 py-3.5 flex items-center gap-4">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{r.title}</p>
                  {r.description && <p className="text-xs text-gray-400 truncate mt-0.5">{r.description}</p>}
                </div>
                {r.type && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full capitalize shrink-0">
                    {r.type}
                  </span>
                )}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer"
                    onClick={r.has_file ? (e) => { e.preventDefault(); openResourceFile(r); } : undefined}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 shrink-0">
                    Open →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CourseDropdown({ courses, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = courses.find(c => c.id === selectedId);
  const filtered = courses.filter(c =>
    !search ||
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative w-full sm:max-w-md">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-colors"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">
              {selected.code}
            </span>
            <span className="text-gray-700 truncate">{selected.title}</span>
          </span>
        ) : (
          <span className="text-gray-400">Select a course…</span>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-full z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search courses…"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-4">No courses match "{search}"</p>
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }}
                className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                  c.id === selectedId ? "bg-indigo-50" : ""
                }`}
              >
                <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">
                  {c.code}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`truncate text-sm ${c.id === selectedId ? "font-medium text-indigo-700" : "text-gray-700"}`}>
                    {c.title}
                  </p>
                  {c.instructor_name && (
                    <p className="text-xs text-gray-400 truncate">{c.instructor_name}</p>
                  )}
                </div>
                {c.id === selectedId && (
                  <svg className="w-3.5 h-3.5 text-indigo-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyCoursesPage() {
  const { user } = useAuth();
  const { data: courses, loading } = useApi("/analytics/me/courses");
  const [selectedId, setSelectedId] = useState(null);

  const selected = (courses || []).find(c => c.id === selectedId);

  if (!selectedId && courses?.length) {
    setSelectedId(courses[0].id);
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">My Courses</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? "Loading…" : `${(courses || []).length} enrolled course${(courses || []).length !== 1 ? "s" : ""}`}
            </p>
          </div>
          {!loading && (courses || []).length > 0 && (
            <CourseDropdown
              courses={courses || []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading courses…</div>
        ) : (courses || []).length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl py-20 text-center">
            <p className="text-sm text-gray-500">No courses found.</p>
            <p className="text-xs text-gray-400 mt-1">Your instructor will enroll you once grades are uploaded.</p>
          </div>
        ) : selected ? (
          <CourseDetail course={selected} />
        ) : (
          <EmptyState />
        )}
      </div>
    </Layout>
  );
}
