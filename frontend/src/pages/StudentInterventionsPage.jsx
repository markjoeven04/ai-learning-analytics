import { useState } from "react";
import Layout from "../components/Layout";
import RiskBadge from "../components/RiskBadge";
import { useApi } from "../hooks/useApi";
import api from "../services/api";
import { useThresholds } from "../hooks/useThresholds";
import { openResourceFile } from "../utils/resourceFile";

const INTERVENTION_TYPE_CONFIG = {
  academic_counseling:        { label: "Academic Counseling",         bg: "bg-blue-100",   text: "text-blue-700" },
  tutoring_referral:          { label: "Tutoring Referral",           bg: "bg-indigo-100", text: "text-indigo-700" },
  study_skills_workshop:      { label: "Study Skills Workshop",       bg: "bg-purple-100", text: "text-purple-700" },
  peer_mentoring:             { label: "Peer Mentoring",              bg: "bg-teal-100",   text: "text-teal-700" },
  modified_learning_strategy: { label: "Modified Learning Strategy",  bg: "bg-cyan-100",   text: "text-cyan-700" },
  time_management_coaching:   { label: "Time Management Coaching",    bg: "bg-amber-100",  text: "text-amber-700" },
  wellness_support_referral:  { label: "Wellness Support Referral",   bg: "bg-green-100",  text: "text-green-700" },
  general_note:               { label: "General Note",                bg: "bg-gray-100",   text: "text-gray-600" },
};

const RESOURCE_ICONS = {
  video:    "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  reading:  "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  exercise: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
};

const RESOURCE_COLORS = {
  video:    { bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  reading:  { bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-200" },
  exercise: { bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200" },
};

function ResourceCard({ rec, index }) {
  const cfg = RESOURCE_COLORS[rec.type] || { bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };
  const icon = RESOURCE_ICONS[rec.type];
  return (
    <a
      href={rec.url || "#"}
      onClick={rec.has_file ? (e) => { e.preventDefault(); openResourceFile(rec); } : undefined}
      target={rec.url ? "_blank" : "_self"}
      rel="noreferrer"
      className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors group"
    >
      <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
        <span className={`text-xs font-bold ${cfg.text}`}>{index + 1}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 group-hover:text-indigo-700 truncate">{rec.title}</p>
        {rec.description && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{rec.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {rec.type && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
              {icon && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
              )}
              {rec.type}
            </span>
          )}
          {rec.relevance_score !== undefined && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
              rec.relevance_score >= 0.7 ? "bg-green-100 text-green-700"
              : rec.relevance_score >= 0.4 ? "bg-amber-100 text-amber-700"
              : "bg-gray-100 text-gray-500"
            }`}>
              {Math.round(rec.relevance_score * 100)}% match
            </span>
          )}
        </div>
      </div>
      {rec.url && (
        <svg className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      )}
    </a>
  );
}

function InterventionCard({ iv }) {
  const cfg = INTERVENTION_TYPE_CONFIG[iv.intervention_type] ?? INTERVENTION_TYPE_CONFIG.general_note;
  const [accepted, setAccepted] = useState(iv.plan_accepted_by_student ?? false);
  const [accepting, setAccepting] = useState(false);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await api.put(`/analytics/interventions/${iv.id}/student-accept`);
      setAccepted(true);
    } catch {
      // silent
    } finally {
      setAccepting(false);
    }
  };

  const hasPlan = !!(iv.goal_description);
  const today = new Date().toISOString().slice(0, 10);
  const followUpPastDue = iv.follow_up_date && iv.follow_up_date < today;

  return (
    <div className={`bg-gray-50 border rounded-lg px-4 py-3 space-y-2 ${hasPlan && !accepted ? "border-indigo-200 bg-indigo-50/40" : "border-gray-100"}`}>
      <div className="flex items-start gap-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          {iv.note && <p className="text-sm text-gray-700">{iv.note}</p>}
          <p className="text-xs text-gray-400 mt-0.5">{new Date(iv.created_at).toLocaleDateString()}</p>
        </div>
      </div>
      {hasPlan && (
        <div className="bg-white border border-indigo-100 rounded-lg px-3 py-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-indigo-700">Improvement Plan</p>
          <p className="text-sm text-gray-700">{iv.goal_description}</p>
          <div className="flex flex-wrap gap-3">
            {iv.target_score != null && (
              <span className="text-xs text-gray-500">Target: <strong>{iv.target_score}%</strong></span>
            )}
            {iv.target_period && (
              <span className="text-xs text-gray-500">Period: <strong>{iv.target_period.replace("_", " ").replace(/\b\w/g, s => s.toUpperCase())}</strong></span>
            )}
            {iv.follow_up_date && (
              <span className={`text-xs font-medium ${followUpPastDue ? "text-red-600" : "text-amber-600"}`}>
                Follow-up: {iv.follow_up_date}{followUpPastDue ? " (OVERDUE)" : ""}
              </span>
            )}
          </div>
          {accepted ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Plan acknowledged
            </span>
          ) : (
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="mt-1 px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {accepting ? "Acknowledging…" : "Acknowledge Plan"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CourseIntervention({ course }) {
  const T = useThresholds();
  const cid = course.id;
  const { data: risk }          = useApi(`/analytics/me/risk?course_id=${cid}`, [cid]);
  const { data: scores }        = useApi(`/analytics/me/competency-scores?course_id=${cid}`, [cid]);
  const { data: recs }          = useApi(`/analytics/me/recommendations?course_id=${cid}`, [cid]);
  const { data: interventions } = useApi(`/analytics/me/interventions?course_id=${cid}`, [cid]);

  const weakAreas = (scores || []).filter(s => s.is_weak).sort((a, b) => a.average_score - b.average_score);
  const isAtRisk = risk?.risk_level === "At-Risk";
  const isExcelling = risk?.risk_level === "Excelling";

  if (!risk && !scores) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{course.code}</span>
          <p className="text-sm font-semibold text-gray-700">{course.title}</p>
        </div>
        <p className="text-sm text-gray-400 py-4 text-center">No data yet for this course.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      isAtRisk ? "border-red-200" : isExcelling ? "border-blue-200" : "border-gray-200"
    }`}>
      {/* Course header */}
      <div className={`px-5 py-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        isAtRisk ? "bg-red-50 border-red-100" : isExcelling ? "bg-blue-50 border-blue-100" : "bg-gray-50 border-gray-100"
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs font-bold text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-100">
            {course.code}
          </span>
          <p className="text-sm font-semibold text-gray-800">{course.title}</p>
          {course.academic_period && (
            <span className="text-xs text-gray-400">{course.academic_period}</span>
          )}
        </div>
        {risk && <RiskBadge level={risk.risk_level} size="sm" />}
      </div>

      <div className="p-5 space-y-5">
        {/* Priority message */}
        {isAtRisk && weakAreas.length > 0 && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-sm text-red-700">
              You are <strong>At-Risk</strong> in this course. Focus on the {weakAreas.length} weak competenc{weakAreas.length !== 1 ? "ies" : "y"} listed below before the next grading period.
            </p>
          </div>
        )}

        {isExcelling && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <p className="text-sm text-blue-700">
              You are <strong>Excelling</strong> in this course. Keep up the great work!
            </p>
          </div>
        )}

        {!isAtRisk && !isExcelling && weakAreas.length === 0 && (
          <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-green-700">You are passing all competencies. Continue reviewing to maintain your standing.</p>
          </div>
        )}

        {/* Weak competencies action list */}
        {weakAreas.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Action Plan — Competencies to Improve
            </p>
            <div className="space-y-2">
              {weakAreas.map((s, i) => {
                const gap = T.mastery_threshold - s.average_score;
                return (
                  <div key={s.competency_code} className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                    <span className="w-5 h-5 rounded-full bg-red-200 text-red-700 text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-red-600">{s.competency_code}</span>
                        <span className="text-sm text-gray-700 truncate">{s.topic_name}</span>
                      </div>
                      <div className="h-1.5 bg-red-100 rounded-full mt-1.5">
                        <div
                          className="h-full bg-red-400 rounded-full"
                          style={{ width: `${Math.min(s.average_score, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-red-600">{s.average_score.toFixed(1)}%</p>
                      <p className="text-xs text-red-400">+{gap.toFixed(1)}% needed</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommended resources */}
        {recs?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Recommended Resources
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recs.slice(0, 6).map((r, i) => (
                <ResourceCard key={r.id ?? i} rec={r} index={i} />
              ))}
            </div>
          </div>
        )}

        {weakAreas.length === 0 && !recs?.length && (
          <p className="text-sm text-gray-400 text-center py-2">
            No intervention actions needed for this course right now.
          </p>
        )}

        {/* Instructor Interventions */}
        {interventions?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Instructor Notes
            </p>
            <div className="space-y-2">
              {interventions.map(iv => (
                <InterventionCard key={iv.id} iv={iv} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudentInterventionsPage() {
  const { data: courses, loading } = useApi("/analytics/me/courses");

  const atRiskFirst = [...(courses || [])];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-800">Interventions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-generated action plans to help you improve across your enrolled courses
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
            Loading…
          </div>
        ) : !atRiskFirst.length ? (
          <div className="bg-white border border-gray-200 rounded-xl py-20 text-center">
            <p className="text-sm text-gray-500">No course data yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Your instructor needs to upload assessment scores first.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {atRiskFirst.map(c => (
              <CourseIntervention key={c.id} course={c} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
