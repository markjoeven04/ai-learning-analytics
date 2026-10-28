import { useState, useEffect } from "react";
import { openResourceFile } from "../utils/resourceFile";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler,
  RadarController,
} from "chart.js";
import { Radar, Line } from "react-chartjs-2";
import Layout from "../components/Layout";
import RiskBadge from "../components/RiskBadge";
import StatCard from "../components/StatCard";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { useThresholds } from "../hooks/useThresholds";

ChartJS.register(
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler,
  RadarController,
);

const RESOURCE_TYPE_CONFIG = {
  video:    { label: "Video",    bg: "bg-purple-100", text: "text-purple-700", icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  reading:  { label: "Reading",  bg: "bg-amber-100",  text: "text-amber-700",  icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  exercise: { label: "Exercise", bg: "bg-green-100",  text: "text-green-700",  icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" },
};

function ResourceTypeTag({ type }) {
  const cfg = RESOURCE_TYPE_CONFIG[type] || { label: type, bg: "bg-gray-100", text: "text-gray-600", icon: "" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.icon && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
        </svg>
      )}
      {cfg.label}
    </span>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
      <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
      <div className="h-2.5 bg-gray-100 rounded w-3/4" />
    </div>
  );
}

function SkeletonBlock({ className = "h-64" }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 animate-pulse ${className}`}>
      <div className="h-3 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="h-full bg-gray-100 rounded" />
    </div>
  );
}

export default function StudentDashboard() {
  const T = useThresholds();
  const { user } = useAuth();
  const { data: courses, loading: loadingCourses } = useApi("/analytics/me/courses");
  const [selectedCourse, setSelectedCourse] = useState(null);

  useEffect(() => {
    if (courses?.length > 0 && !selectedCourse) {
      setSelectedCourse(courses[0]);
    }
  }, [courses]);

  // Support both field-name conventions from the API:
  // spec shape: { course_id, course_code, course_title, instructor_name, academic_period }
  const courseId = selectedCourse?.course_id ?? selectedCourse?.id ?? null;

  const { data: risk, loading: loadingRisk } = useApi(
    courseId ? `/analytics/me/risk?course_id=${courseId}` : null,
    [courseId],
  );
  const { data: scores, loading: loadingScores } = useApi(
    courseId ? `/analytics/me/competency-scores?course_id=${courseId}` : null,
    [courseId],
  );
  const { data: recs, loading: loadingRecs } = useApi(
    courseId ? `/analytics/me/recommendations?course_id=${courseId}` : null,
    [courseId],
  );
  // Ratings given this session, layered over the saved my_feedback values.
  const [recFeedback, setRecFeedback] = useState({});
  const rateRec = async (resourceId, helpful) => {
    setRecFeedback(prev => ({ ...prev, [resourceId]: helpful }));
    try {
      await api.post(`/analytics/me/recommendations/${resourceId}/feedback`, { helpful, course_id: courseId });
    } catch {
      setRecFeedback(prev => { const next = { ...prev }; delete next[resourceId]; return next; });
    }
  };
  const { data: trend, loading: loadingTrend } = useApi(
    courseId ? `/analytics/me/trend?course_id=${courseId}` : null,
    [courseId],
  );
  const { data: attendance } = useApi(
    courseId ? `/analytics/me/attendance?course_id=${courseId}` : null,
    [courseId],
  );
  const { data: consultations } = useApi(
    courseId ? `/analytics/me/consultations?course_id=${courseId}` : null,
    [courseId],
  );
  const { data: standing } = useApi(
    courseId ? `/analytics/me/academic-standing?course_id=${courseId}` : null,
    [courseId],
  );

  // Derived stats from competency scores
  const weakCount    = scores?.filter(s => s.is_weak).length ?? 0;
  const totalComps   = scores?.length ?? 0;
  const masteryPct   = totalComps > 0 ? Math.round(((totalComps - weakCount) / totalComps) * 100) : null;
  const avgScore     = scores?.length
    ? Math.round(scores.reduce((sum, s) => sum + (s.average_score ?? 0), 0) / scores.length)
    : null;

  // Radar chart data
  const radarData = scores?.length ? {
    labels: scores.map(s => s.competency_code),
    datasets: [
      {
        label: "Your Score",
        data: scores.map(s => s.average_score),
        backgroundColor: "rgba(99,102,241,0.15)",
        borderColor: "#6366f1",
        borderWidth: 2,
        pointBackgroundColor: scores.map(s => s.is_weak ? "#ef4444" : "#6366f1"),
        pointRadius: 4,
      },
      {
        label: `Target (${T.mastery_threshold}%)`,
        data: scores.map(() => T.mastery_threshold),
        backgroundColor: "transparent",
        borderColor: "rgba(156,163,175,0.6)",
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
      },
    ],
  } : null;

  // Trend line chart — API shape: { period, avg_score }
  const trendPoints = trend?.filter(t => (t.avg_score ?? t.score) !== null && (t.avg_score ?? t.score) !== undefined) ?? [];
  const trendData = trendPoints.length > 1 ? {
    labels: trendPoints.map(t => t.period),
    datasets: [
      {
        label: "Score (%)",
        data: trendPoints.map(t => t.avg_score ?? t.score),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.1)",
        borderWidth: 2.5,
        pointBackgroundColor: "#6366f1",
        pointRadius: 5,
        tension: 0.3,
        fill: true,
      },
      {
        label: `Target (${T.mastery_threshold}%)`,
        data: trendPoints.map(() => T.mastery_threshold),
        borderColor: "rgba(156,163,175,0.6)",
        borderWidth: 1.5,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        backgroundColor: "transparent",
      },
    ],
  } : null;

  // Helper: display name for a course (supports both API shapes)
  function courseLabel(c) {
    const code  = c.course_code  ?? c.code  ?? "";
    const title = c.course_title ?? c.title ?? "";
    return `${code} — ${title}`;
  }

  // Course selector value key (prefer course_id)
  function courseKey(c) {
    return c.course_id ?? c.id ?? "";
  }

  if (loadingCourses) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-pulse">
            <div>
              <div className="h-5 bg-gray-200 rounded w-44 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
            <div className="h-9 bg-gray-200 rounded-lg w-56" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        </div>
      </Layout>
    );
  }

  const loadingData = loadingRisk || loadingScores || loadingRecs || loadingTrend;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Student Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Welcome back, {user?.full_name?.split(" ")[0]}</p>
          </div>
          {courses?.length > 0 && (
            <select
              aria-label="Select course"
              className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              value={selectedCourse ? courseKey(selectedCourse) : ""}
              onChange={e => {
                const found = courses.find(c => String(courseKey(c)) === e.target.value);
                setSelectedCourse(found || null);
              }}
            >
              <option value="">Select a course</option>
              {courses.map(c => (
                <option key={courseKey(c)} value={courseKey(c)}>{courseLabel(c)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Course info banner */}
        {selectedCourse && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs font-mono text-indigo-500 mr-2">
                {selectedCourse.course_code ?? selectedCourse.code}
              </span>
              <span className="text-sm font-semibold text-indigo-800">
                {selectedCourse.course_title ?? selectedCourse.title}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-indigo-600 ml-auto flex-wrap">
              {(selectedCourse.academic_period) && (
                <span className="bg-indigo-100 px-2 py-0.5 rounded-full">{selectedCourse.academic_period}</span>
              )}
              {(selectedCourse.instructor_name) && (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {selectedCourse.instructor_name}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Empty state — no course selected */}
        {!courseId && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-8 text-center">
            <svg className="w-10 h-10 text-indigo-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-indigo-700 font-medium text-sm">
              {courses?.length === 0
                ? "No course data yet."
                : "Select a course above to view your analytics."}
            </p>
            {courses?.length === 0 && (
              <p className="text-indigo-500 text-xs mt-1">Your instructor needs to upload assessment scores first.</p>
            )}
          </div>
        )}

        {courseId && (
          <>
            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {loadingScores ? (
                [...Array(3)].map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <StatCard
                    label="Average Score"
                    value={avgScore !== null ? `${avgScore}%` : "—"}
                    color="indigo"
                    sub={avgScore !== null ? (avgScore >= T.mastery_threshold ? "Passing" : "Below passing") : "No data"}
                  />
                  <StatCard
                    label="Competency Mastery"
                    value={masteryPct !== null ? `${masteryPct}%` : "—"}
                    color={masteryPct !== null ? (masteryPct >= 70 ? "green" : "amber") : "indigo"}
                    sub={totalComps > 0 ? `${totalComps - weakCount}/${totalComps} competencies` : "No data"}
                  />
                  <StatCard
                    label="At-Risk Topics"
                    value={scores ? weakCount : "—"}
                    color={weakCount > 0 ? "red" : "green"}
                    sub={`below ${T.mastery_threshold}% threshold`}
                  />
                </>
              )}
            </div>

            {/* Risk Status badge row (below stat cards) */}
            {!loadingRisk && risk && (
              <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-5 py-3">
                <span className="text-sm text-gray-500 shrink-0">Risk Status</span>
                <RiskBadge level={risk.risk_level} size="lg" />
                {risk.reason && (
                  <span className="text-xs text-gray-500 ml-auto text-right">
                    {risk.reason} <span className="text-gray-400">· rule-based</span>
                  </span>
                )}
              </div>
            )}
            {loadingRisk && (
              <div className="h-14 bg-white rounded-xl border border-gray-200 animate-pulse" />
            )}

            {/* T5-D-06: Academic Standing Banner */}
            {standing && standing.standing && standing.standing !== "good" && (() => {
              const STANDING_CONFIG = {
                warning:       { bg: "bg-amber-50",  border: "border-amber-300",  text: "text-amber-800",  icon: "text-amber-500", label: "Academic Warning",       msg: "Your academic standing has been flagged. Continued performance below passing thresholds may escalate to probation." },
                probation:     { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-800", icon: "text-orange-500", label: "Academic Probation",    msg: "You are currently on academic probation. Please coordinate with your instructor immediately and follow your improvement plan." },
                dismissal_risk:{ bg: "bg-red-50",    border: "border-red-300",    text: "text-red-800",   icon: "text-red-500",   label: "Dismissal Risk",         msg: "Your academic standing is at dismissal risk. Urgent intervention required — contact your instructor and academic adviser now." },
              };
              const cfg = STANDING_CONFIG[standing.standing];
              if (!cfg) return null;
              return (
                <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cfg.bg} ${cfg.border}`}>
                  <svg className={`w-5 h-5 mt-0.5 shrink-0 ${cfg.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</p>
                    <p className={`text-xs mt-0.5 ${cfg.text} opacity-80`}>{cfg.msg}</p>
                  </div>
                </div>
              );
            })()}

            {/* ── Learning Gap Analysis (Radar) + Performance Trend (Line) ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Radar */}
              <SectionCard title="Learning Gap Analysis">
                {loadingScores ? (
                  <div className="h-64 bg-gray-100 rounded animate-pulse" />
                ) : radarData ? (
                  <>
                    <div className="relative h-64">
                      <Radar
                        data={radarData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: "bottom",
                              labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                            },
                          },
                          scales: {
                            r: {
                              min: 0,
                              max: 100,
                              ticks: {
                                stepSize: 25,
                                font: { size: 9 },
                                callback: v => `${v}%`,
                                backdropColor: "transparent",
                              },
                              pointLabels: { font: { size: 10 } },
                            },
                          },
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Dashed line = {T.mastery_threshold}% passing threshold</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                    <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                    </svg>
                    <p className="text-sm text-gray-400">Learning gap chart unavailable</p>
                    <p className="text-xs text-gray-300 mt-0.5">No competency scores yet</p>
                  </div>
                )}
              </SectionCard>

              {/* Trend */}
              <SectionCard title="Performance Trend">
                {loadingTrend ? (
                  <div className="h-48 bg-gray-100 rounded animate-pulse" />
                ) : trendData ? (
                  <>
                    <figure aria-label="Score trend line chart" className="relative h-48">
                      <Line
                        data={trendData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              display: true,
                              position: "bottom",
                              labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                            },
                          },
                          scales: {
                            y: {
                              min: 0,
                              max: 100,
                              ticks: { callback: v => `${v}%`, font: { size: 11 } },
                              grid: { color: "rgba(0,0,0,0.05)" },
                            },
                            x: { ticks: { font: { size: 11 } } },
                          },
                        }}
                      />
                    </figure>
                    <p className="text-xs text-gray-400 mt-2">Score progression across grading periods</p>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {trendPoints.map(t => {
                        const score = t.avg_score ?? t.score;
                        const passing = score >= T.mastery_threshold;
                        return (
                          <div key={t.period} className="flex-1 min-w-16 text-center bg-gray-50 rounded-lg py-2 px-1 border border-gray-100">
                            <p className="text-xs text-gray-500">{t.period}</p>
                            <p className="text-sm font-bold text-gray-800">{score?.toFixed(1)}%</p>
                            {t.letter_grade && (
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                                passing ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                              }`}>{t.letter_grade}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-300">
                    <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                    <p className="text-sm text-gray-400">Trend chart unavailable</p>
                    <p className="text-xs text-gray-300 mt-0.5">Needs data from at least 2 periods</p>
                  </div>
                )}
              </SectionCard>
            </div>

            {/* ── Learning Gaps list ── */}
            {!loadingScores && scores?.some(s => s.is_weak) && (
              <SectionCard title="Learning Gaps">
                <div className="space-y-2">
                  {scores.filter(s => s.is_weak).map(s => {
                    const gap = T.mastery_threshold - s.average_score;
                    return (
                      <div key={s.competency_id} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
                        <div>
                          <span className="text-xs font-mono text-red-500 mr-2">{s.competency_code}</span>
                          <span className="text-sm text-gray-700">{s.topic_name}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-red-600">{s.average_score}%</span>
                          <p className="text-xs text-red-400">{gap.toFixed(1)}% gap</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {/* ── Recommended resources (matched to learning gaps by competency tags) ── */}
            <SectionCard title="Recommended Resources">
              {loadingRecs ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : recs?.length > 0 ? (
                <div className="space-y-2">
                  {recs[0]?.personalized_message && (
                    <p className="text-sm text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5 leading-relaxed">
                      {recs[0].personalized_message}
                    </p>
                  )}
                  {recs.slice(0, 6).map(r => {
                    const rating = r.id in recFeedback ? recFeedback[r.id] : r.my_feedback;
                    return (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={r.has_file ? (e) => { e.preventDefault(); openResourceFile(r); } : undefined}
                      className="flex flex-1 min-w-0 items-center gap-3 p-3 group"
                    >
                      <div className="shrink-0">
                        <ResourceTypeTag type={r.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-700 group-hover:text-indigo-600 truncate">
                          {r.title}
                          {r.has_file && <span className="text-xs text-gray-400 font-normal"> · {r.file_name}</span>}
                        </p>
                        {r.instructor_endorsed && (
                          <p className="text-[11px] font-medium text-emerald-700 mt-0.5">✓ Recommended by your instructor</p>
                        )}
                        {r.description && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{r.description}</p>
                        )}
                        {r.competency_tags?.length > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">
                            {r.competency_tags.slice(0, 4).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="ml-auto shrink-0 flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          r.relevance_score >= 0.7 ? "bg-green-100 text-green-700" :
                          r.relevance_score >= 0.4 ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {Math.round(r.relevance_score * 100)}% match
                        </span>
                        <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </a>
                    <div className="flex items-center gap-1 pr-2 shrink-0" role="group" aria-label={`Was "${r.title}" helpful?`}>
                      {[[true, "👍", "Helpful"], [false, "👎", "Not helpful"]].map(([value, icon, label]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => rateRec(r.id, value)}
                          aria-pressed={rating === value}
                          title={label}
                          aria-label={label}
                          className={`w-8 h-8 rounded-lg text-sm transition-colors ${
                            rating === value ? "bg-indigo-100 ring-1 ring-indigo-300" : "hover:bg-gray-100 opacity-60 hover:opacity-100"
                          }`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-6">
                  No recommendations yet. Upload your scores to get personalized suggestions.
                </p>
              )}
            </SectionCard>

            {/* ── Attendance ── */}
            {attendance && attendance.total_sessions > 0 && (
              <SectionCard title="Attendance">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Sessions", value: attendance.total_sessions, color: "text-gray-800" },
                    { label: "Present",  value: attendance.present_count,  color: "text-green-600" },
                    { label: "Absent",   value: attendance.absent_count,   color: "text-red-600" },
                    { label: "Late",     value: attendance.late_count,     color: "text-amber-600" },
                  ].map(item => (
                    <div key={item.label} className="text-center bg-gray-50 rounded-lg py-3">
                      <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        attendance.absence_rate > 0.3 ? "bg-red-400" : attendance.absence_rate > 0.15 ? "bg-amber-400" : "bg-green-400"
                      }`}
                      style={{ width: `${Math.round(attendance.absence_rate * 100)}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${
                    attendance.absence_rate > 0.3 ? "text-red-600" : attendance.absence_rate > 0.15 ? "text-amber-600" : "text-green-600"
                  }`}>
                    {Math.round(attendance.absence_rate * 100)}% absent
                  </span>
                </div>
                {attendance.absence_rate > 0.3 && (
                  <p className="text-xs text-red-600 mt-2 bg-red-50 rounded-lg px-3 py-2">
                    Your absence rate exceeds 30% and may affect your academic standing.
                  </p>
                )}
              </SectionCard>
            )}

            {/* ── Grade Consultation Status ── */}
            {consultations?.length > 0 && (() => {
              const latest = consultations[0];
              const STATUS_CONFIG = {
                passed:     { bg: "bg-green-50",  border: "border-green-200",  badge: "bg-green-100 text-green-700",  label: "Passed" },
                failed:     { bg: "bg-red-50",    border: "border-red-200",    badge: "bg-red-100 text-red-700",      label: "Failed" },
                incomplete: { bg: "bg-amber-50",  border: "border-amber-200",  badge: "bg-amber-100 text-amber-700",  label: "Incomplete" },
                dropped:    { bg: "bg-gray-50",   border: "border-gray-200",   badge: "bg-gray-100 text-gray-600",    label: "Dropped" },
              };
              const cfg = STATUS_CONFIG[latest.academic_status] ?? STATUS_CONFIG.dropped;
              const today = new Date().toISOString().slice(0, 10);
              const incOverdue = latest.academic_status === "incomplete" && latest.completion_deadline && latest.completion_deadline < today;
              return (
                <SectionCard title="Grade Consultation">
                  <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${cfg.bg} ${cfg.border}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                        {latest.grading_period && (
                          <span className="text-xs text-gray-500">
                            {latest.grading_period.replace("_", " ").replace(/\b\w/g, s => s.toUpperCase())}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{latest.created_at ? new Date(latest.created_at).toLocaleDateString() : ""}</span>
                      </div>
                      {latest.notes && <p className="text-sm text-gray-700 mb-1">{latest.notes}</p>}
                      {latest.next_steps && <p className="text-xs text-indigo-600">Next: {latest.next_steps}</p>}
                      {latest.academic_status === "incomplete" && latest.completion_deadline && (
                        <p className={`text-xs mt-1 font-medium ${incOverdue ? "text-red-600" : "text-amber-600"}`}>
                          INC deadline: {latest.completion_deadline}{incOverdue ? " (OVERDUE)" : ""}
                        </p>
                      )}
                      {latest.academic_status === "incomplete" && latest.incomplete_reason && (
                        <p className="text-xs text-gray-500 mt-0.5">Reason: {latest.incomplete_reason}</p>
                      )}
                    </div>
                  </div>
                  {consultations.length > 1 && (
                    <p className="text-xs text-gray-400 mt-2">{consultations.length - 1} earlier consultation{consultations.length > 2 ? "s" : ""} on record.</p>
                  )}
                </SectionCard>
              );
            })()}

            {/* All passing — positive state */}
            {!loadingScores && scores?.length > 0 && weakCount === 0 && !loadingRecs && !recs?.length && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <p className="text-green-700 font-medium text-sm">
                  You are passing all competencies for this course.
                </p>
                <p className="text-green-500 text-xs mt-1">Keep it up!</p>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
