import { useState } from "react";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center py-3 border-b border-gray-100 last:border-0 gap-1">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-700">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handlePassword = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(false);
    if (form.new_password !== form.confirm_password) {
      setError("New passwords do not match.");
      return;
    }
    if (form.new_password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/users/me/password", {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setSuccess(true);
      setForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to update password.");
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = { student: "Student", instructor: "Faculty / Instructor", admin: "Administrator",
    program_director: "Program Director", dean: "Dean", vp_academic_affairs: "VP for Academic Affairs" };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">

        <div>
          <h1 className="text-xl font-bold text-gray-800">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your profile and account security</p>
        </div>

        {/* Profile info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Profile Information</h2>
          <InfoRow label="Full Name" value={user?.full_name} />
          <InfoRow label="Email" value={user?.email} />
          <InfoRow label="Role" value={roleLabel[user?.role] || user?.role} />
          {user?.student_number && <InfoRow label="Student No." value={user.student_number} />}
          {user?.program && <InfoRow label="Program" value={user.program} />}
          {user?.year_level && <InfoRow label="Year Level" value={user.year_level} />}
          {user?.section && <InfoRow label="Section" value={user.section} />}
        </div>

        {/* Change password */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Change Password</h2>
          <form onSubmit={handlePassword} className="space-y-4">
            {[
              { key: "current_password", label: "Current Password", auto: "current-password" },
              { key: "new_password",     label: "New Password",     auto: "new-password" },
              { key: "confirm_password", label: "Confirm New Password", auto: "new-password" },
            ].map(({ key, label, auto }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  type="password"
                  required
                  autoComplete={auto}
                  value={form[key]}
                  onChange={e => { setForm({ ...form, [key]: e.target.value }); setError(""); setSuccess(false); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Password updated successfully.
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>

        <p className="text-xs text-center text-gray-400">
          BTECH · <a href="/privacy" className="underline hover:text-gray-600">Privacy Policy</a>
        </p>
      </div>
    </Layout>
  );
}
