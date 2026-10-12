/*
  "Email and password" — change either, confirmed by a code sent by email.
  Shared by the learner's Profile and the instructor's Account screens.
  The sequence itself is in accountSecurity.js.
*/

import React, { useState } from "react";
import { KeyRound, Mail, Lock, ChevronDown, Loader2, Check, AlertCircle } from "lucide-react";
import { useAuth } from "./appAuth";
import { supabase, HAS_SUPABASE } from "./supabaseClient";
import {
  sendPasswordCode, changePassword, requestEmailChange, confirmEmailChange,
} from "./accountSecurity";

/* `bare` drops the card, for use inside a SettingsGroup that already draws one. */
export default function AccountSecurity({ bare = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(null);   // "password" | "email" | null
  if (!user || !HAS_SUPABASE) return null;

  return (
    <div className={bare ? "divide-y divide-slate-100 dark:divide-slate-700"
      : "rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700"}>
      <Section icon={Lock} title="Change password" open={open === "password"}
               onToggle={() => setOpen(open === "password" ? null : "password")}>
        <PasswordFlow email={user.email} onDone={() => setOpen(null)} />
      </Section>
      <Section icon={Mail} title="Change email" subtitle={user.email} open={open === "email"}
               onToggle={() => setOpen(open === "email" ? null : "email")}>
        <EmailFlow currentEmail={user.email} />
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, open, onToggle, children }) {
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3">
        <Icon size={17} className="text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-slate-900 dark:text-white">{title}</span>
          {subtitle && <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</span>}
        </span>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ---- password ---------------------------------------------------------- */

function PasswordFlow({ email, onDone }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true); setMsg(null);
    const r = await sendPasswordCode(supabase.auth);
    setBusy(false);
    if (!r.ok) return setMsg({ type: "error", text: r.error });
    setSent(true);
    setMsg({ type: "info", text: `We've emailed a code to ${email}. It can take a minute — check spam too.` });
  }

  async function save() {
    setBusy(true); setMsg(null);
    const r = await changePassword(supabase.auth, { password, confirm, code });
    setBusy(false);
    if (!r.ok) return setMsg({ type: "error", text: r.error });
    setDone(true);
    setMsg({ type: "info", text: "Password changed. Use the new one next time you sign in." });
    setTimeout(onDone, 2500);
  }

  if (done) return <Message msg={msg} />;

  return (
    <div className="space-y-3">
      {!sent ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            To keep your account safe, we'll email a code to <strong>{email}</strong> first.
          </p>
          <Message msg={msg} />
          <Button busy={busy} onClick={send}>Email me a code</Button>
        </>
      ) : (
        <>
          <Message msg={msg} />
          <Input icon={KeyRound} label="Code from the email" value={code} inputMode="numeric"
                 autoComplete="one-time-code" placeholder="123456"
                 onChange={v => setCode(v.replace(/\D/g, "").slice(0, 10))} />
          <Input icon={Lock} label="New password" type="password" value={password}
                 autoComplete="new-password" placeholder="At least 6 characters" onChange={setPassword} />
          <Input icon={Lock} label="Confirm new password" type="password" value={confirm}
                 autoComplete="new-password" placeholder="Type it again" onChange={setConfirm} />
          <Button busy={busy} onClick={save}>Save new password</Button>
          <LinkButton disabled={busy} onClick={send}>Send a new code</LinkButton>
        </>
      )}
    </div>
  );
}

/* ---- email ------------------------------------------------------------- */

function EmailFlow({ currentEmail }) {
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [codeNew, setCodeNew] = useState("");
  const [codeCurrent, setCodeCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true); setMsg(null);
    const r = await requestEmailChange(supabase.auth, { newEmail, currentEmail });
    setBusy(false);
    if (!r.ok) return setMsg({ type: "error", text: r.error });
    setSentTo(r.newEmail);
    setMsg({
      type: "info",
      text: `We've emailed a code to ${r.newEmail}. If one also arrives at ${currentEmail}, enter that too.`,
    });
  }

  async function save() {
    setBusy(true); setMsg(null);
    const r = await confirmEmailChange(supabase.auth, {
      newEmail: sentTo, currentEmail, codeNew, codeCurrent,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.pending) setCodeNew("");
      return setMsg({ type: r.pending ? "info" : "error", text: r.error });
    }
    setDone(true);
    setMsg({ type: "info", text: `Done. You now sign in with ${sentTo}.` });
  }

  if (done) return <Message msg={msg} />;

  return (
    <div className="space-y-3">
      {!sentTo ? (
        <>
          <Input icon={Mail} label="New email address" type="email" value={newEmail}
                 autoComplete="email" placeholder="you@email.com" onChange={setNewEmail} />
          <Message msg={msg} />
          <Button busy={busy} onClick={send}>Email me a code</Button>
        </>
      ) : (
        <>
          <Message msg={msg} />
          <Input icon={KeyRound} label={`Code sent to ${sentTo}`} value={codeNew} inputMode="numeric"
                 autoComplete="one-time-code" placeholder="123456"
                 onChange={v => setCodeNew(v.replace(/\D/g, "").slice(0, 10))} />
          <Input icon={KeyRound} label={`Code sent to ${currentEmail} (if you got one)`} value={codeCurrent}
                 inputMode="numeric" placeholder="123456"
                 onChange={v => setCodeCurrent(v.replace(/\D/g, "").slice(0, 10))} />
          <Button busy={busy} onClick={save}>Change my email</Button>
          <LinkButton disabled={busy} onClick={() => { setSentTo(null); setMsg(null); setCodeNew(""); setCodeCurrent(""); }}>
            Use a different address
          </LinkButton>
        </>
      )}
    </div>
  );
}

/* ---- bits -------------------------------------------------------------- */

function Message({ msg }) {
  if (!msg) return null;
  const err = msg.type === "error";
  return (
    <div className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2.5 ${
      err ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
          : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"}`}>
      {err ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0" />}
      <span>{msg.text}</span>
    </div>
  );
}

function Button({ busy, onClick, children }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-900 font-bold py-3 rounded-xl text-sm transition">
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

function LinkButton({ onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full text-sm font-semibold text-emerald-600 dark:text-emerald-400 py-1">
      {children}
    </button>
  );
}

function Input({ icon: Icon, label, value, onChange, ...rest }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={value} onChange={e => onChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm outline-none focus:border-emerald-500"
          {...rest} />
      </div>
    </div>
  );
}
