import { useState, useEffect, useCallback, useMemo } from "react";
import Pagination from "../components/Pagination";
import Layout from "../components/Layout";
import RiskBadge from "../components/RiskBadge";
import { useApi } from "../hooks/useApi";
import api from "../services/api";
import { useThresholds } from "../hooks/useThresholds";
import { openResourceFile } from "../utils/resourceFile";

const RISK_ORDER = { "At-Risk": 0, "On-Track": 1, "Excelling": 2 };
const PAGE_SIZE = 10;

// ─── RiskBar ────────────────────────────────────────────────────────────────

function RiskBar({ at_risk = 0, on_track = 0, excelling = 0 }) {
  const total = at_risk + on_track + excelling;
  if (!total) return null;
  const pctRisk = (at_risk / total) * 100;
  const pctOn   = (on_track / total) * 100;
  const pctExc  = (excelling / total) * 100;
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex w-full bg-gray-100">
      {pctRisk > 0 && <div className="bg-red-400 h-full" style={{ width: `${pctRisk}%` }} />}
      {pctOn   > 0 && <div className="bg-green-400 h-full" style={{ width: `${pctOn}%` }} />}
      {pctExc  > 0 && <div className="bg-blue-400 h-full" style={{ width: `${pctExc}%` }} />}
    </div>
  );
}

// ─── MasteryBar ─────────────────────────────────────────────────────────────

function MasteryBar({ score, isWeak }) {
  const pct = Math.min(score, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isWeak ? "bg-red-400" : "bg-indigo-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${isWeak ? "text-red-600" : "text-gray-700"}`}>
        {score.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────

const STAT_COLORS = {
  red:   { border: "border-l-red-400 border-red-100",   text: "text-red-600",   ring: "hover:ring-red-200" },
  green: { border: "border-l-green-400 border-green-100", text: "text-green-600", ring: "hover:ring-green-200" },
  blue:  { border: "border-l-blue-400 border-blue-100",  text: "text-blue-600",  ring: "hover:ring-blue-200" },
  gray:  { border: "border-l-gray-300 border-gray-200",  text: "text-gray-700",  ring: "hover:ring-gray-200" },
};

function StatCard({ label, value, color = "gray", onClick, trend, loading }) {
  const c = STAT_COLORS[color] || STAT_COLORS.gray;
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 flex flex-col justify-between min-h-[90px] border-l-4 transition-all
        ${c.border} ${onClick ? `cursor-pointer hover:shadow-md hover:ring-2 hover:ring-offset-1 ${c.ring}` : ""}`}
    >
      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-16 bg-gray-100 rounded" />
          <div className="h-3 w-20 bg-gray-100 rounded" />
        </div>
      ) : (
        <>
          <p className={`text-3xl font-bold leading-none ${c.text}`}>{value ?? 0}</p>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            {typeof trend === "number" && trend !== 0 && (
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                trend > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}>
                {trend > 0 ? `↑${trend}` : `↓${Math.abs(trend)}`}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 border-l-4 border-l-gray-200 bg-white p-4 min-h-[90px] animate-pulse flex flex-col justify-between">
      <div className="h-8 w-16 bg-gray-100 rounded" />
      <div className="h-3 w-20 bg-gray-100 rounded" />
    </div>
  );
}

// ─── TableRowSkeleton ────────────────────────────────────────────────────────

const SKEL_WIDTHS = ["w-6", "w-28", "w-20", "w-16", "w-12", "w-24", "w-16", "w-12"];

function TableRowSkeleton({ cols = 8 }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-5 py-3">
          <div className={`animate-pulse h-3.5 bg-gray-100 rounded ${SKEL_WIDTHS[i % SKEL_WIDTHS.length]}`} />
        </td>
      ))}
    </tr>
  );
}

// ─── AtRiskAlertStrip ────────────────────────────────────────────────────────

function AtRiskAlertStrip({ students, onDismiss }) {
  if (!students?.length) return null;
  const names = students.slice(0, 5).map(s => s.full_name).join(", ");
  const extra = students.length > 5 ? ` +${students.length - 5} more` : "";
  return (
    <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm bg-amber-50 border border-amber-200 text-amber-800">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 inline-block" />
      <span>
        <strong>{students.length} at-risk student{students.length !== 1 ? "s" : ""}</strong>: {names}{extra}
      </span>
      <button
        onClick={onDismiss}
        className="ml-auto p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-lg transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── CompetencyChart ─────────────────────────────────────────────────────────

function CompetencyChart({ courseId, onFilterByCompetency, activeCompetency }) {
  const T = useThresholds();
  const { data: distribution } = useApi(
    courseId ? `/analytics/courses/${courseId}/competency-distribution` : null,
    [courseId]
  );
  if (!distribution?.length) return null;

  const weakCount = distribution.filter(d => d.class_avg < T.mastery_threshold).length;
  const overallAvg = distribution.reduce((s, d) => s + d.class_avg, 0) / distribution.length;
  const sorted = [...distribution].sort((a, b) => a.class_avg - b.class_avg);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-gray-800">Competency Averages</p>
            <p className="text-xs text-gray-400 mt-0.5">{distribution.length} competencies tracked this course</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {weakCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-50 text-red-600 border border-red-100 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                {weakCount} below {T.mastery_threshold}%
              </span>
            )}
            <span className="text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 px-2.5 py-1 rounded-full">
              Class avg: <strong>{overallAvg.toFixed(1)}%</strong>
            </span>
            {activeCompetency && (
              <button
                onClick={() => onFilterByCompetency?.(null)}
                className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-600 text-white px-2.5 py-1 rounded-full hover:bg-indigo-700 transition-colors"
              >
                Filtering: {distribution.find(d => d.topic_name === activeCompetency)?.competency_code}
                <span className="ml-0.5 font-bold">×</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Detailed competency breakdown */}
      <div className="border-t border-gray-100 divide-y divide-gray-50">
        {sorted.map(d => {
          const isWeak = d.class_avg < T.mastery_threshold;
          const isActive = activeCompetency === d.topic_name;
          const passRate = Math.round(((d.total_students - d.below_passing_count) / d.total_students) * 100);
          return (
            <button
              key={d.competency_code}
              onClick={() => onFilterByCompetency?.(isActive ? null : d.topic_name)}
              className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                isActive ? "bg-indigo-50" : "hover:bg-gray-50"
              }`}
            >
              {/* Code badge */}
              <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                isWeak ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600"
              }`}>
                {d.competency_code}
              </span>

              {/* Topic + progress bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-xs font-medium text-gray-700 truncate">{d.topic_name}</span>
                  <span className={`text-xs font-bold shrink-0 ${isWeak ? "text-red-600" : "text-indigo-600"}`}>
                    {d.class_avg.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isWeak ? "bg-red-400" : "bg-indigo-400"}`}
                    style={{ width: `${Math.min(d.class_avg, 100)}%` }}
                  />
                </div>
              </div>

              {/* Pass rate */}
              <div className="text-right shrink-0 min-w-[80px]">
                {d.below_passing_count > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-red-500">{d.below_passing_count} failing</p>
                    <p className="text-xs text-gray-400">{passRate}% pass rate</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-green-600">All passing</p>
                    <p className="text-xs text-gray-400">100% pass rate</p>
                  </>
                )}
              </div>

              {/* Active indicator */}
              {isActive && (
                <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── StudentProfileDrawer ─────────────────────────────────────────────────────

function StudentProfileDrawer({ student, courseId, onClose }) {
  const T = useThresholds();
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { data: profile, loading } = useApi(
    student && courseId
      ? `/analytics/courses/${courseId}/students/${student.student_id_hash}/profile`
      : null,
    [student?.student_id_hash, courseId]
  );

  const TYPE_COLORS = {
    video:    "bg-purple-100 text-purple-700",
    reading:  "bg-amber-100 text-amber-700",
    exercise: "bg-green-100 text-green-700",
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">
              {profile?.full_name || student.full_name}
            </h2>
            {profile?.student_number && (
              <p className="text-xs text-gray-400 mt-0.5">{profile.student_number}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1 text-gray-400 text-sm">Loading profile…</div>
        ) : profile ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Avg Score</p>
                <p className={`text-xl font-bold ${
                  profile.avg_score === null ? "text-gray-300"
                  : profile.avg_score >= 90 ? "text-blue-600"
                  : profile.avg_score >= T.mastery_threshold ? "text-green-600"
                  : "text-red-600"
                }`}>
                  {profile.avg_score !== null ? `${profile.avg_score}%` : "—"}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Risk</p>
                <div className="flex justify-center mt-1">
                  <RiskBadge level={profile.risk_level} size="sm" />
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Learning Gaps</p>
                <p className="text-xl font-bold text-indigo-600">{profile.learning_gaps ?? "—"}</p>
              </div>
            </div>

            {(profile.program || profile.year_level) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {profile.program && (
                  <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium">{profile.program}</span>
                )}
                {profile.year_level && (
                  <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{profile.year_level}</span>
                )}
              </div>
            )}

            {profile.period_trend?.some(t => t.score !== null) && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score by Period</p>
                <div className="flex items-end gap-2">
                  {profile.period_trend.map(pt => (
                    <div key={pt.period} className="flex-1 text-center">
                      <div className="flex flex-col items-center justify-end h-16 mb-1">
                        {pt.score !== null ? (
                          <div
                            className={`w-full rounded-t-sm transition-all ${pt.score >= T.mastery_threshold ? "bg-indigo-400" : "bg-red-400"}`}
                            style={{ height: `${Math.max(pt.score, 4)}%` }}
                          />
                        ) : (
                          <div className="w-full h-1 bg-gray-100 rounded" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{pt.period.replace("Semi-Final", "Semi")}</p>
                      <p className={`text-xs font-semibold ${pt.score !== null ? (pt.score >= T.mastery_threshold ? "text-indigo-600" : "text-red-600") : "text-gray-300"}`}>
                        {pt.score !== null ? `${pt.score}%` : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {profile.competency_scores?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Competency Scores
                  {profile.competency_scores.filter(c => c.is_weak).length > 0 && (
                    <span className="ml-2 normal-case text-red-500">
                      {profile.competency_scores.filter(c => c.is_weak).length} weak
                    </span>
                  )}
                </p>
                <div className="space-y-2.5">
                  {profile.competency_scores.map(c => (
                    <div key={c.competency_code}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-xs font-bold text-indigo-600 shrink-0">{c.competency_code}</span>
                          <span className="text-xs text-gray-600 truncate">{c.topic_name}</span>
                        </div>
                        {c.is_weak && (
                          <span className="text-xs text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0 ml-2">Weak</span>
                        )}
                      </div>
                      <MasteryBar score={c.average_score} isWeak={c.is_weak} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {profile.recommendations?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">AI-Recommended Resources</p>
                <div className="space-y-2">
                  {profile.recommendations.map((r, i) => (
                    <a
                      key={r.id ?? i}
                      href={r.url}
                      onClick={r.has_file ? (e) => { e.preventDefault(); openResourceFile(r); } : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors group"
                    >
                      <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TYPE_COLORS[r.type] || "bg-gray-100 text-gray-600"}`}>
                        {r.type}
                      </span>
                      <span className="text-sm text-gray-700 group-hover:text-indigo-600 truncate flex-1">{r.title}</span>
                      <span className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                        r.relevance_score >= 0.7 ? "bg-green-100 text-green-700"
                        : r.relevance_score >= 0.4 ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-500"
                      }`}>
                        {Math.round(r.relevance_score * 100)}%
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {!profile.competency_scores?.length && (
              <p className="text-sm text-gray-400 text-center py-6">No competency data yet for this student.</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 text-gray-400 text-sm">Failed to load profile.</div>
        )}
      </div>
    </>
  );
}

// ─── CourseDropdown ──────────────────────────────────────────────────────────

function CourseDropdown({ courses, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = { current: null };

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
    <div ref={r => { ref.current = r; }} className="relative w-full sm:max-w-md">
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
              <p className="text-center text-xs text-gray-400 py-4">No courses match &ldquo;{search}&rdquo;</p>
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
                <span className={`truncate ${c.id === selectedId ? "font-medium text-indigo-700" : "text-gray-700"}`}>
                  {c.title}
                </span>
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

// ─── Attendance helpers ───────────────────────────────────────────────────────

const ATTEND_OPTS = [
  { key: "present", label: "P", title: "Present", bg: "bg-green-500", ring: "ring-green-500", pill: "bg-green-100 text-green-700" },
  { key: "absent",  label: "A", title: "Absent",  bg: "bg-red-500",   ring: "ring-red-500",   pill: "bg-red-100 text-red-700" },
  { key: "late",    label: "L", title: "Late",    bg: "bg-amber-500", ring: "ring-amber-500", pill: "bg-amber-100 text-amber-700" },
  { key: "excused", label: "E", title: "Excused", bg: "bg-blue-500",  ring: "ring-blue-500",  pill: "bg-blue-100 text-blue-700" },
];

function AttendStatusCyclor({ status, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {ATTEND_OPTS.map(opt => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          title={opt.title}
          className={`w-8 h-8 rounded-full text-xs font-bold text-white transition-all shadow-sm
            ${status === opt.key
              ? `${opt.bg} ring-2 ring-offset-1 ${opt.ring} scale-110`
              : "bg-gray-200 text-gray-500 hover:bg-gray-300"}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function AttendanceSection({ courseId }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const { data: studentsRaw, loading: loadingStudents } = useApi(
    `/analytics/courses/${courseId}/students?limit=200`, [courseId]
  );
  const students = useMemo(
    () => studentsRaw?.data ?? (Array.isArray(studentsRaw) ? studentsRaw : []),
    [studentsRaw]
  );

  const { data: existingRecords, refetch: refetchExisting } = useApi(
    `/attendance/${courseId}?date=${date}`, [courseId, date]
  );

  const { data: allRecords, refetch: refetchAll } = useApi(
    `/attendance/${courseId}`, [courseId]
  );

  const history = useMemo(() => {
    if (!allRecords?.length) return [];
    const byDate = {};
    allRecords.forEach(r => {
      const d = (r.date || r.created_at || "").slice(0, 10);
      if (!d) return;
      if (!byDate[d]) byDate[d] = { date: d, present: 0, absent: 0, late: 0, excused: 0 };
      if (r.status === "present")       byDate[d].present++;
      else if (r.status === "absent")   byDate[d].absent++;
      else if (r.status === "late")     byDate[d].late++;
      else if (r.status === "excused")  byDate[d].excused++;
    });
    return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  }, [allRecords]);

  const sortedStudents = useMemo(() => {
    const getLastName = name => {
      if (!name) return "";
      if (name.includes(",")) return name.split(",")[0].trim();
      const parts = name.trim().split(/\s+/);
      return parts[parts.length - 1];
    };
    return [...students].sort((a, b) =>
      getLastName(a.full_name).localeCompare(getLastName(b.full_name))
    );
  }, [students]);

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return sortedStudents;
    const q = search.toLowerCase();
    return sortedStudents.filter(s =>
      s.full_name?.toLowerCase().includes(q) ||
      (s.student_number || "").toLowerCase().includes(q)
    );
  }, [sortedStudents, search]);

  // Seed all-present when students load or course changes
  useEffect(() => {
    if (!students.length) return;
    const base = {};
    students.forEach(s => { base[s.student_id_hash] = "present"; });
    setEntries(base);
  }, [courseId, students.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overlay saved records for the selected date
  useEffect(() => {
    if (!existingRecords?.length) return;
    setEntries(prev => {
      const updated = { ...prev };
      existingRecords.forEach(r => { updated[r.student_id_hash] = r.status; });
      return updated;
    });
  }, [existingRecords]);

  const handleConfirmSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      const records = Object.entries(entries).map(([student_id_hash, status]) => ({ student_id_hash, status }));
      await api.post(`/attendance/${courseId}/bulk`, { date, records });
      setShowModal(false);
      refetchAll();
      refetchExisting();
    } catch (err) {
      setShowModal(false);
      setSaveError(err.response?.data?.detail || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  const counts = ATTEND_OPTS.reduce((acc, opt) => {
    acc[opt.key] = Object.values(entries).filter(s => s === opt.key).length;
    return acc;
  }, {});

  return (
    <>
      {/* ── Confirmation modal ──────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <h3 className="text-base font-bold text-gray-800">Finalize Attendance?</h3>
              <p className="text-sm text-gray-500 mt-1">
                Save attendance for <strong>{date}</strong> as final?
              </p>
            </div>
            <div className="px-6 py-3 flex flex-wrap gap-2">
              {ATTEND_OPTS.map(opt => (
                <span key={opt.key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${opt.pill}`}>
                  <span className={`w-3.5 h-3.5 rounded-full ${opt.bg} text-white flex items-center justify-center text-xs font-bold`}>{opt.label}</span>
                  {opt.title}: <strong>{counts[opt.key]}</strong>
                </span>
              ))}
            </div>
            <p className="px-6 pb-1 text-xs text-gray-400">
              You can still edit this later by clicking the date in Attendance History.
            </p>
            <div className="flex gap-3 px-6 py-5">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {saving ? "Saving…" : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top controls ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-3 shrink-0">
          <label className="text-xs font-semibold text-gray-500">Session Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex flex-wrap gap-2 flex-1">
          {ATTEND_OPTS.map(opt => (
            <span key={opt.key} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${opt.pill}`}>
              <span className={`w-3.5 h-3.5 rounded-full ${opt.bg} text-white flex items-center justify-center text-xs font-bold`}>{opt.label}</span>
              {opt.title}: <strong>{counts[opt.key]}</strong>
            </span>
          ))}
        </div>
        <button
          onClick={() => { setSaveError(null); setShowModal(true); }}
          disabled={!students.length || saving}
          className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
        >
          Save Attendance
        </button>
      </div>
      {saveError && <p className="text-xs text-red-600 px-1">{saveError}</p>}

      {/* ── Two-column body: roster left, history right ──────────────── */}
      <div className="flex gap-4 items-start">

        {/* Left: Roster with internal scroll */}
        <div className="flex-1 min-w-0">
          {loadingStudents ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400 animate-pulse">
              Loading student roster…
            </div>
          ) : !students.length ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl py-10 text-center text-sm text-amber-600">
              No students found. Upload assessment scores first.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex items-center gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search student…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <p className="text-xs text-gray-400 shrink-0">
                  {filteredStudents.length === students.length
                    ? `${students.length} students`
                    : `${filteredStudents.length} / ${students.length}`}
                </p>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                      <th className="px-4 py-2.5 text-left w-8">#</th>
                      <th className="px-4 py-2.5 text-left">Student</th>
                      <th className="px-4 py-2.5 text-left hidden md:table-cell">No.</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-gray-400">No students match &ldquo;{search}&rdquo;</td></tr>
                    ) : filteredStudents.map((s, i) => (
                      <tr key={s.student_id_hash} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{s.full_name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500 hidden md:table-cell">
                          {s.student_number ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <AttendStatusCyclor
                            status={entries[s.student_id_hash] ?? "present"}
                            onChange={status => setEntries(prev => ({ ...prev, [s.student_id_hash]: status }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Attendance History with internal scroll */}
        <div className="w-64 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance History</p>
            </div>
            {history.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-gray-400">
                No sessions recorded yet.
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-center text-green-600">P</th>
                      <th className="px-2 py-2 text-center text-red-500">A</th>
                      <th className="px-2 py-2 text-center text-amber-500">L</th>
                      <th className="px-2 py-2 text-center text-blue-500">E</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map(h => (
                      <tr
                        key={h.date}
                        onClick={() => setDate(h.date)}
                        title="Click to edit this session"
                        className={`cursor-pointer transition-colors ${
                          h.date === date
                            ? "bg-indigo-50 hover:bg-indigo-100"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <td className={`px-3 py-2.5 font-medium ${h.date === date ? "text-indigo-700" : "text-gray-700"}`}>
                          {h.date}
                        </td>
                        <td className="px-2 py-2.5 text-center font-semibold text-green-600">{h.present}</td>
                        <td className="px-2 py-2.5 text-center font-semibold text-red-500">{h.absent}</td>
                        <td className="px-2 py-2.5 text-center font-semibold text-amber-500">{h.late}</td>
                        <td className="px-2 py-2.5 text-center font-semibold text-blue-500">{h.excused}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}

// ─── ClassDetail ─────────────────────────────────────────────────────────────

function ClassDetail({ course }) {
  const T = useThresholds();
  const { data: overview, loading: overviewLoading } = useApi(
    `/analytics/courses/${course.id}/overview`, [course.id]
  );
  const { data: studentsRaw, loading: studentsLoading } = useApi(
    `/analytics/courses/${course.id}/students?limit=1000`, [course.id]
  );
  const students = studentsRaw?.data ?? (Array.isArray(studentsRaw) ? studentsRaw : []);

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [sortCol, setSortCol] = useState("risk");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [profileStudent, setProfileStudent] = useState(null);
  const [flagged, setFlagged] = useState(() => {
    try { return JSON.parse(localStorage.getItem("flagged_students") || "{}"); } catch { return {}; }
  });
  const [selected, setSelected] = useState(new Set());
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [activeCompetency, setActiveCompetency] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  function handleSort(col) {
    if (sortCol === col) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      setSortAsc(col === "score" ? false : true);
    }
  }

  const sorted = [...students].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "risk")  cmp = (RISK_ORDER[a.risk_level] ?? 1) - (RISK_ORDER[b.risk_level] ?? 1);
    else if (sortCol === "name")  cmp = (a.full_name || "").localeCompare(b.full_name || "");
    else if (sortCol === "score") cmp = (a.avg_score ?? -1) - (b.avg_score ?? -1);
    return sortAsc ? cmp : -cmp;
  });

  const filtered = sorted.filter(s => {
    const matchSearch = !search ||
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.student_number || "").includes(search);
    const matchRisk = riskFilter === "All" || s.risk_level === riskFilter;
    const matchComp = !activeCompetency || s.weakest_topic === activeCompetency;
    return matchSearch && matchRisk && matchComp;
  });

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const atRiskStudents = students.filter(s => s.risk_level === "At-Risk");

  useEffect(() => { setPage(1); }, [search, riskFilter, course.id, activeCompetency]);
  useEffect(() => { setSelected(new Set()); setAlertDismissed(false); setActiveCompetency(null); setActiveTab("overview"); }, [course.id]);

  const toggleFlag = useCallback((hash) => {
    setFlagged(prev => {
      const next = { ...prev, [hash]: !prev[hash] };
      localStorage.setItem("flagged_students", JSON.stringify(next));
      return next;
    });
  }, []);

  const exportCSV = useCallback((rows) => {
    const headers = ["Name", "Student No.", "Risk Level", "Avg Score", "Weakest Competency"];
    const lines = [
      headers.join(","),
      ...rows.map(s => [
        `"${(s.full_name || "").replace(/"/g, '""')}"`,
        s.student_number || "",
        s.risk_level || "",
        s.avg_score ?? "",
        `"${(s.weakest_topic || "").replace(/"/g, '""')}"`
      ].join(","))
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course.code}-roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [course.code]);

  function SortTh({ col, label, className = "text-left" }) {
    const active = sortCol === col;
    return (
      <th
        className={`px-5 py-3 ${className} cursor-pointer select-none hover:text-gray-600 transition-colors`}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={`text-xs ${active ? "text-indigo-500" : "text-gray-300"}`}>
            {active ? (sortAsc ? "↑" : "↓") : "↕"}
          </span>
        </span>
      </th>
    );
  }

  const CHIP_BASE = {
    "All":      "text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100",
    "At-Risk":  "text-red-600 bg-red-50 border-red-200 hover:bg-red-100",
    "On-Track": "text-green-700 bg-green-50 border-green-200 hover:bg-green-100",
    "Excelling":"text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100",
  };
  const CHIP_ACTIVE = {
    "All":      "bg-gray-700 text-white border-gray-700",
    "At-Risk":  "bg-red-600 text-white border-red-600",
    "On-Track": "bg-green-600 text-white border-green-600",
    "Excelling":"bg-blue-600 text-white border-blue-600",
  };

  return (
    <div className="space-y-5">
      {/* Profile drawer */}
      {profileStudent && (
        <StudentProfileDrawer
          student={profileStudent}
          courseId={course.id}
          onClose={() => setProfileStudent(null)}
        />
      )}

      {/* Batch floating toolbar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-gray-900 text-white rounded-2xl px-5 py-3 shadow-2xl text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-4 bg-gray-600" />
          <button
            onClick={() => exportCSV(filtered.filter(s => selected.has(s.student_id_hash)))}
            className="hover:text-indigo-300 transition-colors font-medium"
          >
            Export CSV
          </button>
          <div className="w-px h-4 bg-gray-600" />
          <button
            onClick={() => setSelected(new Set())}
            className="hover:text-red-300 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* At-risk alert strip */}
      {!alertDismissed && (
        <AtRiskAlertStrip
          students={atRiskStudents}
          onDismiss={() => setAlertDismissed(true)}
        />
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 -mb-1">
        {[
          { key: "overview",    label: "Overview" },
          { key: "attendance",  label: "Attendance" },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Attendance tab */}
      {activeTab === "attendance" && <AttendanceSection courseId={course.id} />}

      {/* Overview tab */}
      {activeTab === "overview" && <>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {overviewLoading ? (
          [1, 2, 3, 4].map(i => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Total Students" value={overview?.total_students ?? 0} color="gray" />
            <StatCard
              label="At-Risk"
              value={overview?.at_risk ?? 0}
              color="red"
              onClick={() => setRiskFilter(f => f === "At-Risk" ? "All" : "At-Risk")}
            />
            <StatCard
              label="On-Track"
              value={overview?.on_track ?? 0}
              color="green"
              onClick={() => setRiskFilter(f => f === "On-Track" ? "All" : "On-Track")}
            />
            <StatCard
              label="Excelling"
              value={overview?.excelling ?? 0}
              color="blue"
              onClick={() => setRiskFilter(f => f === "Excelling" ? "All" : "Excelling")}
            />
          </>
        )}
      </div>

      {/* Risk distribution bar */}
      {(overview?.total_students ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex items-center gap-3">
          <div className="flex-1">
            <RiskBar
              at_risk={overview.at_risk}
              on_track={overview.on_track}
              excelling={overview.excelling}
            />
          </div>
          <span className="text-xs text-gray-400 shrink-0">
            {Math.round((overview.at_risk / overview.total_students) * 100)}% at risk
          </span>
        </div>
      )}

      {/* Student Roster card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col gap-3">
          {/* Row 1: title + search + export */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-gray-800">Student Roster</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {filtered.length} student{filtered.length !== 1 ? "s" : ""}
                {riskFilter !== "All" ? ` · ${riskFilter}` : ""}
                {activeCompetency ? ` · Competency: ${activeCompetency}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search student…"
                  className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40"
                />
              </div>
              <button
                onClick={() => exportCSV(filtered)}
                className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </div>
          </div>

          {/* Row 2: filter chips */}
          <div className="flex flex-wrap gap-2">
            {["All", "At-Risk", "On-Track", "Excelling"].map(f => {
              const count = f === "All" ? students.length : students.filter(s => s.risk_level === f).length;
              const isActive = riskFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setRiskFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive ? CHIP_ACTIVE[f] : CHIP_BASE[f]
                  }`}
                >
                  {f}{f !== "All" ? ` (${count})` : ""}
                </button>
              );
            })}
            {activeCompetency && (
              <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-indigo-600 text-white border border-indigo-600">
                Competency: {activeCompetency}
                <button
                  onClick={() => setActiveCompetency(null)}
                  className="ml-0.5 hover:bg-indigo-700 rounded-full w-4 h-4 flex items-center justify-center font-bold"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Table body */}
        {studentsLoading ? (
          <table className="w-full text-sm">
            <tbody>{[...Array(5)].map((_, i) => <TableRowSkeleton key={i} cols={8} />)}</tbody>
          </table>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {students.length === 0
              ? "No student data yet. Upload a CSV to populate this class."
              : "No students match the current filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                  <th className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={e => setSelected(
                        e.target.checked
                          ? new Set(filtered.map(s => s.student_id_hash))
                          : new Set()
                      )}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                    />
                  </th>
                  <th className="px-5 py-3 text-left">#</th>
                  <SortTh col="name" label="Student" />
                  <th className="px-5 py-3 text-left">Student No.</th>
                  <SortTh col="risk" label="Risk Level" />
                  <SortTh col="score" label="Avg Score" className="text-right" />
                  <th className="px-5 py-3 text-left">Weakest Competency</th>
                  <th className="px-5 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.map((s, i) => {
                  const isFlagged = !!flagged[s.student_id_hash];
                  const isSelected = selected.has(s.student_id_hash);
                  return (
                    <tr
                      key={s.student_id_hash}
                      className={`group transition-colors ${
                        isSelected ? "bg-indigo-50/50" :
                        s.risk_level === "At-Risk" ? "bg-red-50/30 hover:bg-red-50/60" :
                        "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-5 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => setSelected(prev => {
                            const n = new Set(prev);
                            e.target.checked ? n.add(s.student_id_hash) : n.delete(s.student_id_hash);
                            return n;
                          })}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                        />
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{s.full_name}</span>
                          {isFlagged && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
                              Flagged
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">
                        {s.student_number || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3"><RiskBadge level={s.risk_level} /></td>
                      <td className="px-5 py-3 text-right">
                        {s.avg_score !== null && s.avg_score !== undefined ? (
                          <span className={`font-semibold ${
                            s.avg_score >= T.excelling_avg ? "text-blue-600" :
                            s.avg_score >= T.mastery_threshold ? "text-green-600" :
                            "text-red-600"
                          }`}>
                            {s.avg_score}%
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500">
                        {s.weakest_topic || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleFlag(s.student_id_hash)}
                            className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                              isFlagged
                                ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                                : "border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                            }`}
                          >
                            {isFlagged ? "Unflag" : "Flag"}
                          </button>
                          <button
                            onClick={() => setProfileStudent(s)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200 transition-colors"
                          >
                            Profile
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Competency chart — below roster */}
      <CompetencyChart
        courseId={course.id}
        onFilterByCompetency={setActiveCompetency}
        activeCompetency={activeCompetency}
      />

      </>}
    </div>
  );
}

// ─── MyClassesPage ────────────────────────────────────────────────────────────

export default function MyClassesPage() {
  const { data: courses, loading } = useApi("/courses/");

  const [selectedId, setSelectedId] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("course");
      if (fromUrl) return fromUrl;
      return localStorage.getItem("myclasses_lastCourse") || null;
    } catch {
      return null;
    }
  });

  const [sessionRestored, setSessionRestored] = useState(false);
  const selected = (courses || []).find(c => c.id === selectedId);

  // Auto-select first course when no selection exists
  useEffect(() => {
    if (!selectedId && courses?.length) {
      setSelectedId(courses[0].id);
    }
  }, [courses, selectedId]);

  // Show restore banner once when course comes from storage (not URL)
  useEffect(() => {
    if (!courses?.length || !selectedId) return;
    const stored = localStorage.getItem("myclasses_lastCourse");
    const params = new URLSearchParams(window.location.search);
    if (stored && stored === selectedId && !params.get("course") && courses.some(c => c.id === selectedId)) {
      setSessionRestored(true);
    }
  }, [courses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selectedId → URL + localStorage
  useEffect(() => {
    if (!selectedId) return;
    try {
      localStorage.setItem("myclasses_lastCourse", selectedId);
      const params = new URLSearchParams(window.location.search);
      params.set("course", selectedId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    } catch {
      // ignore storage errors
    }
  }, [selectedId]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-gray-800">My Classes</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading
                ? "Loading…"
                : `${(courses || []).length} assigned course${(courses || []).length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
            Loading classes…
          </div>
        ) : (courses || []).length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
            <p className="text-sm text-gray-500">No classes assigned yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Ask your administrator to assign courses to your account.
            </p>
          </div>
        ) : (
          <>
            {/* Session restore banner */}
            {sessionRestored && selected && (
              <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Restored last viewed class:{" "}
                  <strong>{selected.code} — {selected.title}</strong>
                </span>
                <button
                  onClick={() => setSessionRestored(false)}
                  className="ml-auto text-indigo-400 hover:text-indigo-600 transition-colors font-bold"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}

            {/* Course selector */}
            <CourseDropdown
              courses={courses || []}
              selectedId={selectedId}
              onSelect={id => { setSelectedId(id); setSessionRestored(false); }}
            />

            {/* Class detail */}
            {selected && <ClassDetail course={selected} />}
          </>
        )}
      </div>
    </Layout>
  );
}
