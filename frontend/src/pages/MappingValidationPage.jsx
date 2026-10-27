import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const pct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const MANAGER_ROLES = ["admin", "program_director"];

function Card({ children, className = "" }) {
  return <section className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`}>{children}</section>;
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`px-4 py-2.5 rounded-lg text-sm border ${toast.type === "error" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
      {toast.text}
    </div>
  );
}

// ── Create a set (administrators and Program Directors) ─────────────────────
function NewSetForm({ onCreated, notify }) {
  const [opts, setOpts] = useState(null);
  const [name, setName] = useState("");
  const [courseIds, setCourseIds] = useState([]);
  const [size, setSize] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/mapping-validation/options").then(r => { setOpts(r.data); setSize(r.data.default_sample_size); }).catch(() => {});
  }, []);
  if (!opts) return null;

  const eligible = opts.courses.filter(c => courseIds.includes(c.id)).reduce((s, c) => s + c.eligible_items, 0);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post("/mapping-validation/", { name, course_ids: courseIds, sample_size: Number(size) });
      notify({ type: "ok", text: `Created "${res.data.name}" with ${res.data.items} sampled items. Assign the second validator for each course.` });
      setName(""); setCourseIds([]);
      onCreated(res.data);
    } catch (err) {
      notify({ type: "error", text: err.response?.data?.detail || "Could not create the validation set." });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">New validation set</h2>
          <p className="text-xs text-gray-500">A stratified random sample of AI-mapped items (by course and by confidence band). The capstone protocol uses 50 items, each labeled by three faculty experts; the result is reported with its 95% confidence interval.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. 1st Sem pilot validation"
            className="sm:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Sample size
            <input type="number" min={10} max={5000} value={size} onChange={e => setSize(e.target.value)}
              className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Courses</p>
          {opts.courses.length === 0 ? <p className="text-sm text-gray-400">No courses in your scope.</p> : (
            <div className="grid sm:grid-cols-2 gap-1.5">
              {opts.courses.map(c => (
                <label key={c.id} className={`flex items-center gap-2 text-sm px-2 py-1 rounded ${c.eligible_items ? "" : "opacity-50"}`}>
                  <input type="checkbox" disabled={!c.eligible_items} checked={courseIds.includes(c.id)}
                    onChange={e => setCourseIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(x => x !== c.id))} />
                  <span className="truncate">{c.label}</span>
                  <span className="text-xs text-gray-400 shrink-0">{c.eligible_items} AI-mapped</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button disabled={busy || name.trim().length < 3 || courseIds.length === 0}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Sampling…" : "Create set"}
          </button>
          {courseIds.length > 0 && <span className="text-xs text-gray-500">{eligible} AI-mapped items available · {Math.min(eligible, Number(size) || 0)} will be sampled</span>}
        </div>
      </form>
    </Card>
  );
}

function AssignRow({ set, course, people, onSaved, notify }) {
  const [form, setForm] = useState({
    validator_a_id: course.validator_a.id || "", validator_b_id: course.validator_b.id || "",
    validator_c_id: course.validator_c?.id || "", adjudicator_id: course.adjudicator.id || "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]));
      const res = await api.put(`/mapping-validation/${set.id}/assignments/${course.course_id}`, body);
      onSaved(res.data);
      notify({ type: "ok", text: "Assignments saved; the people assigned were notified." });
    } catch (err) {
      notify({ type: "error", text: err.response?.data?.detail || "Could not save the assignments." });
    } finally { setBusy(false); }
  };
  const sel = (key, list) => (
    <select value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      className="border border-gray-300 rounded-lg px-2 py-1 text-xs max-w-44">
      <option value="">— none —</option>
      {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  return (
    <div className="flex items-center gap-2 flex-wrap mt-2">
      <span className="text-xs text-gray-500">A</span>{sel("validator_a_id", people.validators)}
      <span className="text-xs text-gray-500">B</span>{sel("validator_b_id", people.validators)}
      <span className="text-xs text-gray-500">C</span>{sel("validator_c_id", people.validators)}
      <span className="text-xs text-gray-500">Program Chair (tie-breaker)</span>{sel("adjudicator_id", people.adjudicators)}
      <button onClick={save} disabled={busy} className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function SetCard({ set, people, onOpen, onChanged, notify, canDelete }) {
  const [editing, setEditing] = useState(false);
  const remove = async () => {
    if (!window.confirm(`Delete "${set.name}" and all its labels?`)) return;
    try { await api.delete(`/mapping-validation/${set.id}`); onChanged(null, set.id); }
    catch (err) { notify({ type: "error", text: err.response?.data?.detail || "Could not delete the set." }); }
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{set.name}</h3>
          <p className="text-xs text-gray-500">{set.items} items · seed {set.seed} · created {set.created_at ? new Date(set.created_at).toLocaleDateString() : ""}{set.created_by ? ` by ${set.created_by}` : ""}</p>
        </div>
        <div className="flex gap-2">
          {set.can_view_results && <button onClick={() => onOpen("results", set)} className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50">Results</button>}
          {set.can_manage && <button onClick={() => setEditing(v => !v)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">{editing ? "Done" : "Assign people"}</button>}
          {set.can_manage && canDelete && <button onClick={remove} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Delete</button>}
        </div>
      </div>
      <div className="mt-3 divide-y divide-gray-100">
        {set.courses.map(c => (
          <div key={c.course_id} className="py-2">
            <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
              <span className="font-medium text-gray-700">{c.course} <span className="text-xs text-gray-400">· {c.items} items</span></span>
              <div className="flex items-center gap-2">
                {c.my_role === "validator" && <button onClick={() => onOpen("label", set, c)} className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white">Label items</button>}
                {(c.my_role === "adjudicator" || (set.can_manage && c.awaiting_adjudication > 0)) && c.awaiting_adjudication > 0 &&
                  <button onClick={() => onOpen("adjudicate", set)} className="text-xs px-3 py-1 rounded-lg bg-amber-500 text-white">Break ties ({c.awaiting_adjudication})</button>}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Validator A: {c.validator_a.name || <em className="text-red-500">unassigned</em>} ({c.validator_a.labeled}/{c.items}) ·
              Validator B: {c.validator_b.name || <em className="text-red-500">unassigned</em>} ({c.validator_b.labeled}/{c.items}) ·
              Validator C: {c.validator_c?.name || <em className="text-red-500">unassigned</em>} ({c.validator_c?.labeled ?? 0}/{c.items}) ·
              Program Chair: {c.adjudicator.name || <em className="text-red-500">unassigned</em>}
            </p>
            {editing && people && <AssignRow set={set} course={c} people={people} notify={notify} onSaved={s => onChanged(s)} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Blind labeling ──────────────────────────────────────────────────────────
function LabelView({ set, course, onBack }) {
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/mapping-validation/${set.id}/label/${course.course_id}`).then(r => {
      setData(r.data);
      const first = r.data.items.findIndex(i => !i.my_label);
      const start = first === -1 ? 0 : first;
      setIndex(start);
      setChoice(r.data.items[start]?.my_label ?? null);
    }).catch(err => setError(err.response?.data?.detail || "Could not load your items."));
  }, [set.id, course.course_id]);

  if (error) return <Card><p className="text-sm text-red-600">{error}</p><button onClick={onBack} className="mt-2 text-sm text-indigo-600">← Back</button></Card>;
  if (!data) return <Card><p className="text-sm text-gray-400">Loading…</p></Card>;
  const item = data.items[index];
  const goTo = (i) => { setIndex(i); setChoice(data.items[i]?.my_label ?? null); setError(""); };

  const save = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      await api.put(`/mapping-validation/${set.id}/label/items/${item.id}`,
        choice === "none" ? { none_fits: true } : { competency_id: choice });
      const items = data.items.map((it, i) => i === index ? { ...it, my_label: choice } : it);
      setData({ ...data, items, done: items.filter(i => i.my_label).length });
      const next = items.findIndex((it, i) => i > index && !it.my_label);
      const fallback = items.findIndex(it => !it.my_label);
      const target = next !== -1 ? next : fallback;
      if (target !== -1) { setIndex(target); setChoice(items[target].my_label ?? null); }
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save the label.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">← Back to validation sets</button>
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">{data.course}</h2>
            <p className="text-xs text-gray-500">{data.set_name} · Choose the one competency each question assesses. The AI's answer is hidden so your judgement is independent.</p>
          </div>
          <span className="text-sm font-medium text-gray-700">{data.done} / {data.total} labeled</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full mt-3 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${data.total ? data.done / data.total * 100 : 0}%` }} /></div>
      </Card>

      {data.done === data.total && data.total > 0 && (
        <div className="px-4 py-2.5 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">All items are labeled. Thank you — you can still review and change answers that have not been adjudicated.</div>
      )}

      {item && (
        <Card>
          <p className="text-xs text-gray-400 mb-1">Item {index + 1} of {data.total}{item.locked ? " · adjudicated (final)" : ""}</p>
          <p className="text-base text-gray-800 leading-relaxed">{item.question_text}</p>
          <fieldset disabled={item.locked} className="mt-4 space-y-1.5">
            {data.competencies.map(c => (
              <label key={c.id} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${choice === c.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"}`}>
                <input type="radio" name="competency" className="mt-1" checked={choice === c.id} onChange={() => setChoice(c.id)} />
                <span className="text-sm">
                  <span className="font-mono text-xs text-indigo-600">{c.competency_code}</span> {c.topic_name}
                  {c.learning_outcomes?.length > 0 && <span className="block text-xs text-gray-500">{c.learning_outcomes.slice(0, 2).join(" · ")}</span>}
                </span>
              </label>
            ))}
            <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${choice === "none" ? "border-amber-400 bg-amber-50" : "border-gray-200 hover:bg-gray-50"}`}>
              <input type="radio" name="competency" checked={choice === "none"} onChange={() => setChoice("none")} />
              <span className="text-sm text-gray-700">No matching competency in this syllabus</span>
            </label>
          </fieldset>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <div className="flex items-center gap-2 mt-4">
            <button onClick={() => goTo(Math.max(0, index - 1))} disabled={index === 0} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">← Previous</button>
            <button onClick={save} disabled={busy || !choice || item.locked} className="px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg disabled:opacity-50">
              {busy ? "Saving…" : "Save & next"}
            </button>
            <button onClick={() => goTo(Math.min(data.total - 1, index + 1))} disabled={index >= data.total - 1} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">Skip →</button>
          </div>
        </Card>
      )}

      <Card>
        <p className="text-xs font-medium text-gray-600 mb-2">Jump to an item</p>
        <div className="flex flex-wrap gap-1">
          {data.items.map((it, i) => (
            <button key={it.id} onClick={() => goTo(i)}
              className={`w-8 h-8 text-xs rounded ${i === index ? "ring-2 ring-indigo-500" : ""} ${it.my_label ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"}`}>
              {i + 1}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Adjudication ────────────────────────────────────────────────────────────
function AdjudicateView({ set, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const load = useCallback(() => {
    api.get(`/mapping-validation/${set.id}/adjudication`).then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.detail || "Could not load the disagreements."));
  }, [set.id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (item) => {
    const d = drafts[item.id] || {};
    if (!d.choice) return;
    try {
      await api.put(`/mapping-validation/${set.id}/adjudication/items/${item.id}`,
        d.choice === "none" ? { none_fits: true, note: d.note } : { competency_id: d.choice, note: d.note });
      load();
    } catch (err) { setError(err.response?.data?.detail || "Could not save the decision."); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">← Back to validation sets</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data?.courses.map(c => (
        <Card key={c.course_id}>
          <h2 className="text-sm font-semibold text-gray-800">{c.course}</h2>
          <p className="text-xs text-gray-500 mb-3">Items where the validators reached no majority. As Program Chair, break the tie; the AI's answer stays hidden, so decide from the question and the syllabus.</p>
          {c.items.length === 0 ? <p className="text-sm text-gray-400">No ties to break.</p> : c.items.map(it => {
            const d = drafts[it.id] || { choice: it.decision ? (it.decision.none_fits ? "none" : it.decision.competency_id) : "", note: it.note || "" };
            return (
              <div key={it.id} className="border border-gray-200 rounded-lg p-3 mb-2">
                <p className="text-sm text-gray-800">{it.question_text}</p>
                <p className="text-xs text-gray-500 mt-1">{it.labels.map((l, k) => <span key={k}>{k > 0 && " · "}Validator {"ABC"[k]}: <strong>{l.label}</strong></span>)}</p>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <select value={d.choice} onChange={e => setDrafts(x => ({ ...x, [it.id]: { ...d, choice: e.target.value } }))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm max-w-md">
                    <option value="">Choose the correct competency…</option>
                    {c.competencies.map(comp => <option key={comp.id} value={comp.id}>{comp.competency_code} · {comp.topic_name}</option>)}
                    <option value="none">No matching competency</option>
                  </select>
                  <input value={d.note} onChange={e => setDrafts(x => ({ ...x, [it.id]: { ...d, note: e.target.value } }))}
                    placeholder="Reason (optional)" className="border border-gray-300 rounded-lg px-2 py-1 text-sm flex-1 min-w-40" />
                  <button onClick={() => decide(it)} disabled={!d.choice} className="px-3 py-1 text-sm rounded-lg bg-amber-500 text-white disabled:opacity-50">
                    {it.decision ? "Update" : "Decide"}
                  </button>
                  {it.decision && <span className="text-xs text-green-700">Decided: {it.decision.label}</span>}
                </div>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────
function ResultsView({ set, onBack }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/mapping-validation/${set.id}`).then(r => setData(r.data)).catch(() => {}); }, [set.id]);
  const exportXlsx = async () => {
    const res = await api.get(`/mapping-validation/${set.id}/export`, { responseType: "blob" });
    const href = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = href; a.download = `AILAS_Mapping_Validation_${set.seed}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  };
  if (!data?.metrics) return <Card><p className="text-sm text-gray-400">Loading…</p></Card>;
  const m = data.metrics;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">← Back to validation sets</button>
        <button onClick={exportXlsx} className="px-3 py-1.5 text-sm border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50">⬇ Export Excel</button>
      </div>
      <Card>
        <h2 className="text-sm font-semibold text-gray-800">{data.name}</h2>
        <p className="text-xs text-gray-500">{m.ground_truth_items} of {m.items} items have ground truth{m.complete ? " (complete)" : ""} · {m.awaiting_adjudication} awaiting the Program Chair
          {m.decisions && <> · ground truth: {m.decisions.unanimous} unanimous, {m.decisions.majority} majority, {m.decisions.program_chair} Program Chair</>}</p>
        <div className="grid sm:grid-cols-4 gap-3 mt-4 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className={`text-2xl font-bold ${m.accuracy_pct == null ? "text-gray-400" : m.meets_target ? "text-emerald-600" : "text-amber-600"}`}>{pct(m.accuracy_pct)}</p>
            <p className="text-xs text-gray-500">mapping accuracy (target ≥ {m.target_pct}%)</p>
            {m.ci_low != null && <p className="text-[11px] text-gray-400">95% CI {m.ci_low}–{m.ci_high}%</p>}
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-800">{m.kappa == null ? "—" : m.kappa.toFixed(2)}</p>
            <p className="text-xs text-gray-500">{m.kappa_method === "Fleiss" ? "Fleiss'" : "Cohen's"} κ between validators (target ≥ 0.61)</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-800">{pct(m.agreement_pct)}</p>
            <p className="text-xs text-gray-500">validators unanimous before tie-breaks</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-800">{m.correct}/{m.ground_truth_items}</p>
            <p className="text-xs text-gray-500">AI answers matching the ground truth</p>
          </div>
        </div>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Does the AI's confidence mean anything?</h3>
        <p className="text-xs text-gray-500 mb-3">Accuracy by the AI's self-reported confidence (boundary {Math.round(data.review_threshold * 100)}% at sampling time). Auto-acceptance is only justified if the high-confidence band meets the target.</p>
        <table className="text-sm w-full max-w-lg">
          <thead><tr className="text-xs text-gray-500 text-left"><th className="py-1">Band</th><th className="py-1 text-right">Items</th><th className="py-1 text-right">Accuracy</th><th className="py-1 text-right">95% CI</th></tr></thead>
          <tbody>
            {[["high", "≥ boundary"], ["low", "< boundary"]].map(([k, label]) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="py-1.5">{k === "high" ? "High" : "Low"} confidence ({label})</td>
                <td className="py-1.5 text-right">{m.by_band[k].items}</td>
                <td className="py-1.5 text-right">{pct(m.by_band[k].accuracy_pct)}</td>
                <td className="py-1.5 text-right text-gray-500">{m.by_band[k].ci_low == null ? "—" : `${m.by_band[k].ci_low}–${m.by_band[k].ci_high}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Accuracy by competency (ground truth)</h3>
        {m.by_competency.length === 0 ? <p className="text-sm text-gray-400">No ground truth yet.</p> : (
          <table className="text-sm w-full">
            <thead><tr className="text-xs text-gray-500 text-left"><th className="py-1">Competency</th><th className="py-1 text-right">Items</th><th className="py-1 text-right">Correct</th><th className="py-1 text-right">Accuracy</th></tr></thead>
            <tbody>
              {m.by_competency.map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1.5"><span className="font-mono text-xs text-indigo-600">{r.competency_code}</span> {r.topic_name}</td>
                  <td className="py-1.5 text-right">{r.items}</td>
                  <td className="py-1.5 text-right">{r.correct}</td>
                  <td className={`py-1.5 text-right ${r.accuracy_pct < m.target_pct ? "text-amber-600" : "text-emerald-700"}`}>{pct(r.accuracy_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export default function MappingValidationPage() {
  const { user } = useAuth();
  const [sets, setSets] = useState(null);
  const [people, setPeople] = useState(null);
  const [view, setView] = useState({ name: "list" });
  const [toast, setToast] = useState(null);
  const isManager = MANAGER_ROLES.includes(user?.role);

  const notify = (t) => { setToast(t); setTimeout(() => setToast(null), 5000); };
  const load = useCallback(() => { api.get("/mapping-validation/").then(r => setSets(r.data)).catch(() => setSets([])); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isManager) api.get("/mapping-validation/options").then(r => setPeople(r.data)).catch(() => {});
  }, [isManager]);

  const open = (name, set, course) => setView({ name, set, course });
  const back = () => { setView({ name: "list" }); load(); };
  const changed = (updated, removedId) => {
    if (removedId) setSets(s => s.filter(x => x.id !== removedId));
    else if (updated) setSets(s => s.some(x => x.id === updated.id) ? s.map(x => x.id === updated.id ? updated : x) : [updated, ...s]);
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Mapping Validation</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Faculty-validated ground truth for the AI's question-to-competency mapping. Three faculty experts per course label a random sample blind; the majority label is the ground truth and the Program Chair breaks ties. The AI is scored against it, never against its own confidence, and items it got wrong go back to the faculty review queue.
          </p>
        </div>
        <Toast toast={toast} />
        {view.name === "label" && <LabelView set={view.set} course={view.course} onBack={back} />}
        {view.name === "adjudicate" && <AdjudicateView set={view.set} onBack={back} />}
        {view.name === "results" && <ResultsView set={view.set} onBack={back} />}
        {view.name === "list" && (
          <>
            {isManager && <NewSetForm notify={notify} onCreated={s => { changed(s); }} />}
            {sets == null ? <p className="text-sm text-gray-400">Loading…</p> : sets.length === 0 ? (
              <Card><p className="text-sm text-gray-500">{isManager ? "No validation sets yet. Create one above." : "You have no validation assignments."}</p></Card>
            ) : sets.map(s => (
              <SetCard key={s.id} set={s} people={people} onOpen={open} onChanged={changed} notify={notify} canDelete={isManager} />
            ))}
          </>
        )}
      </div>
    </Layout>
  );
}
