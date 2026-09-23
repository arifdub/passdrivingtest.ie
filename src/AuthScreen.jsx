/*
  ===========================================================================
  WELCOME / SIGN IN

  The first screen anyone sees. It does three jobs in order:

    1. Says what the app is — someone arriving from a search result needs to
       know this is ADI Stage 1 preparation before they're asked for an email.
    2. Offers an account, for progress that follows them between devices.
    3. Offers a way in without one, because a sign-up wall before anyone has
       seen the app costs more users than it gains.

  The welcome panel collapses once the form is open, so the screen doesn't
  become a scroll on a small phone.
  ===========================================================================
*/

import React, { useState } from "react";
import {
  Loader2, Mail, Lock, User as UserIcon, AlertCircle, ArrowRight,
  ListChecks, Timer, Layers, TrendingUp, Eye, EyeOff, Check,
} from "lucide-react";
import { Logo } from "./ui";
import { useAuth } from "./appAuth";
import { TOTAL_QUESTIONS } from "./theorySections";
import InstallPopup from "./InstallPopup";

export default function AuthScreen() {
  const { signIn, signUp, resetPassword, continueAsGuest, mode } = useAuth();

  const [view, setView] = useState("welcome");   // welcome | login | signup
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const isSignup = view === "signup";
  const isWelcome = view === "welcome";

  async function handleSubmit() {
    setMessage(null);

    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Enter your email and password." });
      return;
    }
    if (isSignup && password.length < 6) {
      setMessage({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (isSignup && password !== confirm) {
      setMessage({ type: "error", text: "The two passwords don't match." });
      return;
    }

    setBusy(true);
    const result = isSignup
      ? await signUp({ email, password, fullName })
      : await signIn({ email, password });
    setBusy(false);

    if (!result.ok) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    if (result.needsConfirmation) {
      setMessage({
        type: "info",
        text: "Account created. Check your email for the confirmation link, then sign in.",
      });
      setView("login");
    }
  }

  async function handleForgot() {
    if (!email.trim()) {
      setMessage({ type: "error", text: "Enter your email first, then tap Forgot." });
      return;
    }
    setBusy(true);
    const result = await resetPassword(email);
    setBusy(false);
    setMessage(
      result.ok
        ? { type: "info", text: "Reset link sent — check your email." }
        : { type: "error", text: result.error }
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-900 flex flex-col items-center px-5"
      style={{
        paddingTop: "max(2rem, calc(env(safe-area-inset-top) + 1.25rem))",
        paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1.25rem))",
      }}
    >
      <div className="w-full max-w-sm flex flex-col items-center">

        {/* Logo — large on the welcome view, smaller once the form is open
            so the fields stay above the keyboard. */}
        <Logo size={isWelcome ? "xl" : "md"} className="transition-all duration-300" />

        {isWelcome ? (
          <>
            <h1 className="mt-6 text-2xl font-black tracking-tight text-white text-center">
              Welcome
            </h1>
            <p className="mt-2 text-sm text-slate-300 text-center leading-relaxed">
              Preparation for the <span className="text-white font-semibold">Driver
              Theory Test</span> — the written test you pass before you can apply for a
              learner permit and start driving lessons.
            </p>

            <div className="mt-6 w-full grid grid-cols-2 gap-2.5">
              <Feature icon={ListChecks} title={`${TOTAL_QUESTIONS}+ questions`}
                       body="Across six topics, signs included" />
              <Feature icon={Timer} title="Mock tests"
                       body="40 questions in 45 minutes, like the real test" />
              <Feature icon={Layers} title="Flashcards"
                       body="Rules of the Road and every official sign" />
              <Feature icon={TrendingUp} title="Progress tracking"
                       body="See which topics still need work" />
            </div>

            <div className="mt-7 w-full space-y-2.5">
              <button
                onClick={() => { setView("signup"); setMessage(null); }}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-3.5 rounded-xl transition"
              >
                Create an account
              </button>
              <button
                onClick={() => { setView("login"); setMessage(null); }}
                className="w-full border border-slate-600 hover:border-slate-500 text-white font-bold py-3.5 rounded-xl transition"
              >
                I already have an account
              </button>
              <button
                onClick={continueAsGuest}
                className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-emerald-400 font-bold py-3 transition"
              >
                Continue as guest <ArrowRight size={16} />
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-500 text-center leading-relaxed">
              As a guest your progress saves on this device only. You can create
              an account later and keep everything you've done.
            </p>

            <InstallPopup />
          </>
        ) : (
          <>
            <div className="mt-6 w-full bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
              <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
                {isSignup ? "Create your account" : "Welcome back"}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {isSignup
                  ? "Your progress is saved and follows you to any device."
                  : "Sign in to pick up where you left off."}
              </p>

              <div className="mt-5 space-y-3">
                {isSignup && (
                  <Field icon={UserIcon} label="Full name" value={fullName}
                         onChange={setFullName} placeholder="Alex Smith" autoComplete="name" />
                )}

                <Field icon={Mail} label="Email" type="email" value={email}
                       onChange={setEmail} placeholder="you@email.com" autoComplete="email" />

                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  show={showPassword}
                  onToggleShow={() => setShowPassword(v => !v)}
                  placeholder={isSignup ? "At least 6 characters" : "Enter your password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  onEnter={handleSubmit}
                  action={!isSignup && (
                    <button type="button" onClick={handleForgot}
                            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
                      Forgot?
                    </button>
                  )}
                />

                {/* Confirming the password only matters when setting a new
                    one. Asking for it at sign-in would be noise. */}
                {isSignup && (
                  <PasswordField
                    label="Confirm password"
                    value={confirm}
                    onChange={setConfirm}
                    show={showPassword}
                    onToggleShow={() => setShowPassword(v => !v)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                    onEnter={handleSubmit}
                    match={
                      confirm.length === 0 ? null : password === confirm
                    }
                  />
                )}

                {message && (
                  <div className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2.5 ${
                    message.type === "error"
                      ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
                      : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                  }`}>
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{message.text}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-900 font-bold py-3 rounded-xl transition"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {isSignup ? "Create account" : "Login"}
                </button>
              </div>

              <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
                {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setView(isSignup ? "login" : "signup");
                    setMessage(null);
                    setConfirm("");
                  }}
                  className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {isSignup ? "Sign in" : "Sign up"}
                </button>
              </p>
            </div>

            <div className="mt-5 w-full space-y-1">
              <button
                onClick={continueAsGuest}
                className="w-full flex items-center justify-center gap-2 border border-slate-600 hover:border-slate-500 text-white font-bold py-3 rounded-xl transition"
              >
                Continue as guest <ArrowRight size={16} />
              </button>
              <button
                onClick={() => { setView("welcome"); setMessage(null); }}
                className="w-full text-sm font-semibold text-slate-400 hover:text-emerald-400 py-2.5"
              >
                Back
              </button>
            </div>
          </>
        )}

        <p className="mt-6 text-xs text-slate-500 text-center">
          Full access to all study material — no payment required.
        </p>

        {mode === "local" && (
          <p className="mt-3 text-[11px] text-amber-400/80 text-center leading-relaxed">
            Running without a database connection — accounts are stored on this
            device only.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
function Feature({ icon: Icon, title, body }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3">
      <Icon size={18} className="text-emerald-400" />
      <p className="mt-2 text-sm font-bold text-white leading-tight">{title}</p>
      <p className="mt-0.5 text-xs text-slate-400 leading-snug">{body}</p>
    </div>
  );
}

/* A password input with a show/hide toggle. The eye sits inside the field so
   it doesn't take a row of its own, and both password fields on the sign-up
   form share one toggle — revealing one and not the other would defeat the
   point of asking twice. */
function PasswordField({
  label, value, onChange, show, onToggleShow, placeholder,
  autoComplete, onEnter, action, match,
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full pl-9 pr-20 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />

        {/* Tick once the two entries agree, so it's obvious before submitting. */}
        {match === true && (
          <Check size={16} className="absolute right-11 top-1/2 -translate-y-1/2 text-emerald-500" />
        )}

        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>

      {match === false && (
        <p className="mt-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          The passwords don't match yet.
        </p>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, value, onChange, placeholder, type = "text", autoComplete }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>
    </div>
  );
}
