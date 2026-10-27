import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ROLE_REDIRECTS = {
  student: "/student",
  instructor: "/instructor",
  admin: "/admin",
  program_director: "/program-director",
  dean: "/dean",
  vp_academic_affairs: "/vp",
};

// Maps HTTP status + attempt count → friendly error config
function buildError(status, attempts) {
  if (status === 429) {
    return {
      type: "rate_limit",
      title: "Too many attempts",
      message: "You've tried too many times in a short period. Please wait a minute, then try again.",
      fields: [],
    };
  }
  if (status === 422) {
    return {
      type: "credentials",
      title: "Enter a full email address",
      message: "Use the complete email, e.g. pd.ics@btech.edu.",
      fields: ["email"],
    };
  }
  if (status === 403) {
    return {
      type: "credentials",
      title: "Account inactive",
      message: "This account has been deactivated. Contact the administrator.",
      fields: [],
    };
  }
  if (status === 401) {
    const extra =
      attempts >= 3
        ? " Also make sure Caps Lock is off."
        : "";
    return {
      type: "credentials",
      title: "Incorrect email or password",
      message: `Please double-check your email and password, then try again.${extra}`,
      fields: ["email", "password"],
    };
  }
  return {
    type: "network",
    title: "Connection problem",
    message: "We couldn't reach the server. Check your internet connection and try again.",
    fields: [],
  };
}

const BANNER_STYLES = {
  credentials: {
    wrap: "bg-red-50 border-red-200",
    icon: "text-red-500",
    title: "text-red-800",
    body: "text-red-700",
  },
  rate_limit: {
    wrap: "bg-amber-50 border-amber-200",
    icon: "text-amber-500",
    title: "text-amber-800",
    body: "text-amber-700",
  },
  network: {
    wrap: "bg-gray-50 border-gray-200",
    icon: "text-gray-500",
    title: "text-gray-700",
    body: "text-gray-600",
  },
};

function BannerIcon({ type }) {
  if (type === "rate_limit") {
    return (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type === "network") {
    return (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
        clipRule="evenodd" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm]               = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr]                 = useState(null);   // buildError() object | null
  const [errFields, setErrFields]     = useState([]);     // ["email","password"] | []
  const [loading, setLoading]         = useState(false);
  const [attempts, setAttempts]       = useState(0);
  const [shake, setShake]             = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  // When the user edits a field, lift its red border — banner stays until next submit
  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrFields((prev) => prev.filter((f) => f !== field));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Do NOT clear err here — keep previous message visible while loading
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      // Success — wipe error state then navigate
      setErr(null);
      setErrFields([]);
      setAttempts(0);
      navigate(ROLE_REDIRECTS[user.role] || "/");
    } catch (caught) {
      const next = attempts + 1;
      setAttempts(next);
      const config = buildError(caught?.response?.status, next);
      setErr(config);
      setErrFields(config.fields);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const hasFieldErr = (field) => errFields.includes(field);

  const fieldClass = (field) =>
    `w-full rounded-lg px-3 py-2.5 text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:border-transparent ${
      hasFieldErr(field)
        ? "border-2 border-red-400 bg-red-50 focus:ring-red-300 placeholder-red-300"
        : "border border-gray-300 bg-white focus:ring-indigo-500 placeholder-gray-400"
    }`;

  return (
    <>
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          18%     { transform: translateX(-7px); }
          36%     { transform: translateX(7px); }
          54%     { transform: translateX(-4px); }
          72%     { transform: translateX(4px); }
        }
        .login-shake { animation: shake 0.42s cubic-bezier(.36,.07,.19,.97) both; }
      `}</style>

      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 px-4">
        <div className={`w-full max-w-md bg-white rounded-2xl shadow-lg p-8 ${shake ? "login-shake" : ""}`}>

          {/* ── Header ── */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-3">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.346A3.001 3.001 0 0012 15a3 3 0 00-2.971 2.589l-.347-.346z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">AILAS</h1>
            <p className="text-sm text-gray-500 mt-1">AI-Assisted Learning Analytics System</p>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className={`block text-sm font-medium mb-1 transition-colors ${
                  hasFieldErr("email") ? "text-red-600" : "text-gray-700"
                }`}
              >
                Email address
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={handleChange("email")}
                  aria-invalid={hasFieldErr("email")}
                  aria-describedby={hasFieldErr("email") ? "email-err" : undefined}
                  className={`${fieldClass("email")} pr-9`}
                  placeholder="you@institution.edu"
                />
                {hasFieldErr("email") && (
                  <span className="absolute inset-y-0 right-3 flex items-center pointer-events-none" aria-hidden>
                    <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
              {hasFieldErr("email") && (
                <p id="email-err" role="alert" className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Check that your email address is correct.
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className={`block text-sm font-medium mb-1 transition-colors ${
                  hasFieldErr("password") ? "text-red-600" : "text-gray-700"
                }`}
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={handleChange("password")}
                  aria-invalid={hasFieldErr("password")}
                  aria-describedby={hasFieldErr("password") ? "password-err" : undefined}
                  className={`${fieldClass("password")} pr-9`}
                  placeholder="••••••••"
                />
                {/* Show/hide toggle — positioned left of the error icon when both present */}
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className={`absolute inset-y-0 flex items-center transition-colors
                    ${hasFieldErr("password") ? "right-8 text-red-300 hover:text-red-500" : "right-3 text-gray-400 hover:text-gray-600"}`}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
                {hasFieldErr("password") && (
                  <span className="absolute inset-y-0 right-3 flex items-center pointer-events-none" aria-hidden>
                    <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
              {hasFieldErr("password") && (
                <p id="password-err" role="alert" className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Check that your password is correct.
                </p>
              )}
            </div>

            {/* ── Error banner ── persists across retries, never flashes away */}
            {err && (
              <div
                role="alert"
                aria-live="assertive"
                className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${BANNER_STYLES[err.type].wrap}`}
              >
                <span className={`shrink-0 mt-0.5 ${BANNER_STYLES[err.type].icon}`}>
                  <BannerIcon type={err.type} />
                </span>
                <div>
                  <p className={`text-sm font-semibold leading-snug ${BANNER_STYLES[err.type].title}`}>
                    {err.title}
                  </p>
                  <p className={`text-xs mt-0.5 leading-relaxed ${BANNER_STYLES[err.type].body}`}>
                    {err.message}
                  </p>
                </div>
              </div>
            )}

            {/* ── Submit ── */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-semibold
                         hover:bg-indigo-700 active:bg-indigo-800
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-colors duration-150 mt-1"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            <a href="/privacy" className="underline hover:text-gray-600 transition-colors">Privacy Policy</a>
          </p>
        </div>
      </div>
    </>
  );
}
