import { useState, useEffect, useCallback } from "react";
import Layout from "../components/Layout";
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

const STATUS_COLORS = { active: "bg-green-100 text-green-700", inactive: "bg-gray-100 text-gray-500", archived: "bg-yellow-100 text-yellow-700" };

const EMPTY_CURR = { program_id: "", name: "", ched_cmo_reference: "", effective_year: "", total_units: "", status: "active" };
const EMPTY_SUBJ = { subject_code: "", title: "", units: "", year_level: "", semester: "", prerequisite_subject_id: "" };

export default function CurriculaPage() {
  const [programs, setPrograms] = useState([]);
  const [curricula, setCurricula] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [subjects, setSubjects] = useState({});
  const [loadingSubjects, setLoadingSubjects] = useState({});

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_CURR);
  const [saving, setSaving] = useState(false);

  const [showSubjModal, setShowSubjModal] = useState(false);
  const [subjCurrId, setSubjCurrId] = useState(null);
  const [subjForm, setSubjForm] = useState(EMPTY_SUBJ);
  const [savingSubj, setSavingSubj] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = (message, type = "success") => setToast({ message, type });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([api.get("/programs/"), api.get("/curricula/")]);
      setPrograms(pRes.data);
      setCurricula(cRes.data);
    } catch { showToast("Failed to load data", "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchSubjects = async (currId) => {
    setLoadingSubjects(s => ({ ...s, [currId]: true }));
    try {
      const res = await api.get(`/curricula/${currId}/subjects`);
      setSubjects(s => ({ ...s, [currId]: res.data }));
    } catch { showToast("Failed to load subjects", "error"); }
    finally { setLoadingSubjects(s => ({ ...s, [currId]: false })); }
  };

  const toggleExpand = (currId) => {
    if (expanded === currId) { setExpanded(null); return; }
    setExpanded(currId);
    if (!subjects[currId]) fetchSubjects(currId);
  };

  const programName = (id) => programs.find(p => p.id === id)?.program_name || id;

  const openCreate = () => { setForm(EMPTY_CURR); setEditTarget(null); setShowModal(true); };
  const openEdit = (c) => { setForm({ ...c, effective_year: String(c.effective_year), total_units: String(c.total_units) }); setEditTarget(c); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    const payload = { ...form, effective_year: parseInt(form.effective_year, 10), total_units: parseInt(form.total_units, 10) };
    try {
      if (editTarget) { await api.put(`/curricula/${editTarget.id}`, payload); showToast("Curriculum updated"); }
      else { await api.post("/curricula/", payload); showToast("Curriculum created"); }
      setShowModal(false); fetchAll();
    } catch (err) { showToast(err.response?.data?.detail || "Save failed", "error"); }
    finally { setSaving(false); }
  };

  const openAddSubject = (currId) => { setSubjCurrId(currId); setSubjForm(EMPTY_SUBJ); setShowSubjModal(true); };

  const handleSubjectSubmit = async (e) => {
    e.preventDefault(); setSavingSubj(true);
    const payload = {
      ...subjForm,
      units: parseInt(subjForm.units, 10),
      year_level: parseInt(subjForm.year_level, 10),
      semester: parseInt(subjForm.semester, 10),
      prerequisite_subject_id: subjForm.prerequisite_subject_id || null,
    };
    try {
      await api.post(`/curricula/${subjCurrId}/subjects`, payload);
      showToast("Subject added");
      setShowSubjModal(false);
      fetchSubjects(subjCurrId);
    } catch (err) { showToast(err.response?.data?.detail || "Failed to add subject", "error"); }
    finally { setSavingSubj(false); }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Curricula</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage curriculum versions and their subject offerings.</p>
          </div>
          <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Curriculum
          </button>
        </div>

        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-32" />
              </div>
            ))
          ) : curricula.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400">
              No curricula yet. Click "Add Curriculum" to get started.
            </div>
          ) : curricula.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggleExpand(c.id)} className="text-gray-400 hover:text-indigo-600 transition-colors">
                  <svg className={`w-4 h-4 transition-transform ${expanded === c.id ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div onClick={() => toggleExpand(c.id)} className="flex-1 min-w-0 cursor-pointer">
                  <span className="font-medium text-gray-800 text-sm">{c.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{programName(c.program_id)} · AY {c.effective_year} · {c.total_units} units</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || "bg-gray-100 text-gray-500"}`}>{c.status}</span>
                <button onClick={() => openEdit(c)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
              </div>

              {expanded === c.id && (
                <div className="border-t border-gray-100 bg-gray-50/60">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subjects</span>
                    <button onClick={() => openAddSubject(c.id)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Add Subject
                    </button>
                  </div>
                  {loadingSubjects[c.id] ? (
                    <div className="px-4 pb-3 text-xs text-gray-400 animate-pulse">Loading subjects…</div>
                  ) : !subjects[c.id]?.length ? (
                    <div className="px-4 pb-3 text-xs text-gray-400">No subjects added yet.</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          {["Code", "Title", "Units", "Year", "Sem", "Prerequisite"].map(h => (
                            <th key={h} className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {subjects[c.id].map(s => {
                          const prereq = subjects[c.id].find(x => x.id === s.prerequisite_subject_id);
                          return (
                            <tr key={s.id} className="border-b border-gray-100 hover:bg-white/70 transition-colors">
                              <td className="px-4 py-2 font-mono text-gray-700">{s.subject_code}</td>
                              <td className="px-4 py-2 text-gray-700">{s.title}</td>
                              <td className="px-4 py-2 text-gray-500">{s.units}</td>
                              <td className="px-4 py-2 text-gray-500">{s.year_level}</td>
                              <td className="px-4 py-2 text-gray-500">{s.semester}</td>
                              <td className="px-4 py-2 text-gray-400">{prereq ? prereq.subject_code : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Curriculum modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-800">{editTarget ? "Edit Curriculum" : "Add Curriculum"}</h2>
              </div>
              <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Program <span className="text-red-400">*</span></label>
                  <select required value={form.program_id} onChange={e => setForm(f => ({ ...f, program_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Select program</option>
                    {programs.map(p => <option key={p.id} value={p.id}>{p.program_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Curriculum Name <span className="text-red-400">*</span></label>
                  <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. BSIT Curriculum 2018" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Effective Year <span className="text-red-400">*</span></label>
                    <input required type="number" min={2000} max={2100} value={form.effective_year} onChange={e => setForm(f => ({ ...f, effective_year: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="2018" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Total Units <span className="text-red-400">*</span></label>
                    <input required type="number" min={1} value={form.total_units} onChange={e => setForm(f => ({ ...f, total_units: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="178" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CHED CMO Reference</label>
                  <input value={form.ched_cmo_reference} onChange={e => setForm(f => ({ ...f, ched_cmo_reference: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. CMO No. 25 s. 2015" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {["active", "inactive", "archived"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {saving ? "Saving…" : editTarget ? "Save Changes" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Subject modal */}
        {showSubjModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-800">Add Subject</h2>
              </div>
              <form onSubmit={handleSubjectSubmit} className="px-6 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subject Code <span className="text-red-400">*</span></label>
                    <input required value={subjForm.subject_code} onChange={e => setSubjForm(f => ({ ...f, subject_code: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="IT101" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Units <span className="text-red-400">*</span></label>
                    <input required type="number" min={1} value={subjForm.units} onChange={e => setSubjForm(f => ({ ...f, units: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="3" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title <span className="text-red-400">*</span></label>
                  <input required value={subjForm.title} onChange={e => setSubjForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Introduction to Information Technology" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Year Level <span className="text-red-400">*</span></label>
                    <select required value={subjForm.year_level} onChange={e => setSubjForm(f => ({ ...f, year_level: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select</option>
                      {[1, 2, 3, 4].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Semester <span className="text-red-400">*</span></label>
                    <select required value={subjForm.semester} onChange={e => setSubjForm(f => ({ ...f, semester: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select</option>
                      <option value={1}>1st Semester</option>
                      <option value={2}>2nd Semester</option>
                      <option value={3}>Summer</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Prerequisite Subject</label>
                  <select value={subjForm.prerequisite_subject_id} onChange={e => setSubjForm(f => ({ ...f, prerequisite_subject_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">None</option>
                    {(subjects[subjCurrId] || []).map(s => <option key={s.id} value={s.id}>{s.subject_code} — {s.title}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={() => setShowSubjModal(false)} className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={savingSubj} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {savingSubj ? "Adding…" : "Add Subject"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Layout>
  );
}
