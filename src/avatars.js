/*
  ===========================================================================
  PROFILE PHOTOS

  Picking one, shrinking it, putting it in the bucket, and remembering where
  it went.

  WHY THE BROWSER RESIZES IT FIRST

  A photo straight off a phone is three to eight megabytes. An avatar is
  shown at about forty pixels. Uploading the original means an instructor
  standing at a kerb on one bar of signal waits thirty seconds to change
  their picture, and every learner who opens the directory downloads eight
  megabytes to draw a circle.

  So it is drawn into a canvas at 512px first — square, centre-cropped, as
  JPEG — which lands around 60KB. The original never leaves the device.

  WHY THE FILE NAME CHANGES EVERY TIME

  The old file is deleted and the new one gets a fresh name. Overwriting at a
  fixed path would be tidier, but the URL would not change, and every browser
  and CDN that has already cached the old picture would keep showing it —
  the classic "I changed my photo and it didn't change" bug. A new name is a
  new URL, so the new photo appears immediately.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

const BUCKET = "avatars";
const SIZE = 512;
const QUALITY = 0.85;

/* What a file input should offer. Matches the bucket's allowed types in
   sql/15 — a type the bucket refuses should never reach the upload. */
export const ACCEPT = "image/jpeg,image/png,image/webp";

/* The bucket's ceiling is 5MB and this is the same number, so an oversized
   file is refused here, with a sentence, instead of by storage with a 413. */
export const MAX_BYTES = 5 * 1024 * 1024;

export function describeAvatarError(error) {
  if (!error) return null;
  const msg = error.message || String(error);

  if (/Bucket not found/i.test(msg)) {
    return "Photos aren't set up on this site yet (sql/15 hasn't been run).";
  }
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(msg)) {
    return "That image is too large, even after shrinking. Try another.";
  }
  if (/mime type|not supported/i.test(msg)) {
    return "That file isn't an image we can use. JPEG, PNG or WebP.";
  }
  if (/new row violates row-level security|Unauthorized|403/i.test(msg)) {
    return "You can only change your own photo. Try signing out and back in.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}

/* ------------------------------------------------------------------------- */
/* Shrinking                                                                  */
/* ------------------------------------------------------------------------- */

/* Square, centre-cropped, 512px, JPEG. Exported because the cropping maths
   is the part worth pinning down: an off-centre crop takes the top-left of a
   landscape photo, which is usually somebody's shoulder. */
export function cropBox(width, height) {
  const side = Math.min(width, height);
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) / 2),
    side,
  };
}

export async function shrink(file, { size = SIZE, quality = QUALITY } = {}) {
  const bitmap = await createImageBitmap(file);
  const { sx, sy, side } = cropBox(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("Could not read that image.");
  return blob;
}

/* ------------------------------------------------------------------------- */
/* The bucket                                                                 */
/* ------------------------------------------------------------------------- */

/* The path carries the permission: sql/15's policies check that the first
   folder is the caller's own id, so a file can only ever be written inside
   the writer's own folder. */
export function pathFor(userId) {
  return `${userId}/${Date.now()}.jpg`;
}

export async function uploadAvatar(userId, file) {
  if (!HAS_SUPABASE || !userId) return { ok: false, error: "Not signed in." };
  if (!file) return { ok: false, error: "No image chosen." };

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That image is too large. Pick one under 5MB." };
  }
  if (!/^image\//.test(file.type)) {
    return { ok: false, error: "That file isn't an image." };
  }

  let blob;
  try {
    blob = await shrink(file);
  } catch (e) {
    /* A HEIC from an iPhone, a corrupt file, a browser without
       createImageBitmap. Uploading the original instead would work but
       could be eight megabytes, so it is refused with a reason. */
    console.warn("Could not process the image:", e);
    return { ok: false, error: "Couldn't read that image. Try a JPEG or PNG." };
  }

  const path = pathFor(userId);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) return { ok: false, error: describeAvatarError(error) };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data?.publicUrl || null, path, error: null };
}

/* Best effort. A photo that was replaced leaves a file behind if this fails,
   which costs a few kilobytes and nothing else — so it never blocks the
   change the person actually asked for. */
export async function removeAvatar(url) {
  if (!HAS_SUPABASE || !url) return;
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;
  const path = url.slice(at + marker.length).split("?")[0];
  try {
    await supabase.storage.from(BUCKET).remove([decodeURIComponent(path)]);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------- */
/* Writing it down                                                            */
/* ------------------------------------------------------------------------- */

export async function setInstructorPhoto(userId, url) {
  if (!HAS_SUPABASE || !userId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("instructor_profiles")
    .update({ photo_url: url })
    .eq("user_id", userId);
  return error
    ? { ok: false, error: describeAvatarError(error) }
    : { ok: true, error: null };
}

export async function setLearnerPhoto(userId, url) {
  if (!HAS_SUPABASE || !userId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", userId);

  if (error && /avatar_url/.test(error.message || "")) {
    return { ok: false, error: "Photos aren't set up on this site yet (sql/15 hasn't been run)." };
  }
  return error
    ? { ok: false, error: describeAvatarError(error) }
    : { ok: true, error: null };
}

/* Initials, for before there is a photo and for when one fails to load. */
export function initialsFor(nameOrEmail) {
  const base = (nameOrEmail || "").includes("@")
    ? nameOrEmail.split("@")[0]
    : nameOrEmail || "";
  const letters = base
    .replace(/[^a-zA-Z]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join("");
  return (letters || "?").toUpperCase();
}
