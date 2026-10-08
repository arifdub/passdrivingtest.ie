/*
  ===========================================================================
  THE PHOTO, AND CHANGING IT

  One component for both sides. An instructor's photo is on a public
  marketplace card; a learner's is shown to the instructor they book with.
  The difference is what the screen SAYS, not what it does, so the behaviour
  lives here once and the wording is passed in.

  TAP THE PICTURE. THAT IS THE WHOLE INTERACTION.

  No "Upload" button beside a preview. The circle is the control — which is
  what everyone tries first, and what the request asked for — with a small
  camera badge on it so it reads as something you can press rather than
  decoration.
  ===========================================================================
*/

import React, { useRef, useState } from "react";
import { Camera, Loader2, AlertCircle, Trash2, UserCircle } from "lucide-react";
import {
  ACCEPT, uploadAvatar, removeAvatar, initialsFor,
} from "./avatars";

export default function AvatarPicker({
  url,
  userId,
  name,
  /* Writes the new URL wherever this side keeps it, and is also what tells
     the rest of the app to re-read. Returns { ok, error }. */
  onSave,
  size = 72,
  note,
  disabled,
}) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /* Shown the instant a file is chosen, so the circle changes before the
     upload finishes. On a slow connection the alternative is tapping a photo
     and watching nothing happen for ten seconds. */
  const [preview, setPreview] = useState(null);

  const shown = preview || url;

  async function choose(file) {
    if (!file) return;
    setError(null);
    setBusy(true);

    const local = URL.createObjectURL(file);
    setPreview(local);

    const up = await uploadAvatar(userId, file);
    if (!up.ok) {
      setPreview(null);
      URL.revokeObjectURL(local);
      setError(up.error);
      setBusy(false);
      return;
    }

    const saved = await onSave(up.url);
    if (!saved?.ok) {
      /* The file is in the bucket but nothing points at it. Take it back out
         rather than leave an orphan nobody can see or delete. */
      await removeAvatar(up.url);
      setPreview(null);
      URL.revokeObjectURL(local);
      setError(saved?.error || "Couldn't save your photo.");
      setBusy(false);
      return;
    }

    const old = url;
    setPreview(null);
    URL.revokeObjectURL(local);
    setBusy(false);
    /* Only once the new one is safely recorded. */
    if (old) removeAvatar(old);
  }

  async function clear() {
    setError(null);
    setBusy(true);
    const saved = await onSave(null);
    if (!saved?.ok) {
      setError(saved?.error || "Couldn't remove your photo.");
      setBusy(false);
      return;
    }
    if (url) removeAvatar(url);
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          aria-label={shown ? "Change your photo" : "Add a photo"}
          className="relative shrink-0 rounded-full group disabled:opacity-60"
          style={{ width: size, height: size }}
        >
          <span
            className="block w-full h-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700 ring-2 ring-white dark:ring-slate-800 shadow"
          >
            {shown ? (
              <img
                src={shown}
                alt=""
                className="w-full h-full object-cover"
                /* A photo that 404s — a deleted file, a stale URL — must not
                   leave a broken-image icon where a face should be. */
                onError={() => setPreview(null)}
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center">
                {name ? (
                  <span
                    className="font-black text-slate-400"
                    style={{ fontSize: size * 0.32 }}
                  >
                    {initialsFor(name)}
                  </span>
                ) : (
                  <UserCircle size={size * 0.55} className="text-slate-400" />
                )}
              </span>
            )}
          </span>

          <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-emerald-500 text-slate-900 flex items-center justify-center ring-2 ring-white dark:ring-slate-800">
            {busy
              ? <Loader2 size={14} className="animate-spin" />
              : <Camera size={14} />}
          </span>
        </button>

        <div className="min-w-0">
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
            className="text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-60"
          >
            {busy ? "Saving…" : shown ? "Change photo" : "Add a photo"}
          </button>

          {shown && !busy && (
            <button
              type="button"
              onClick={clear}
              className="ml-3 inline-flex items-center gap-1 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-red-500"
            >
              <Trash2 size={13} /> Remove
            </button>
          )}

          {note && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {note}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2.5 text-sm text-red-500 flex items-start gap-1.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          /* Cleared so choosing the same file twice in a row still fires. */
          e.target.value = "";
          choose(f);
        }}
      />
    </div>
  );
}
