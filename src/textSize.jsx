/*
  ===========================================================================
  READING SIZE

  Lets a learner make the question and answer text bigger without changing the
  rest of the app.

  WHY NOT JUST SCALE THE ROOT FONT SIZE

  The obvious approach is to set font-size on <html>. Tailwind's spacing scale
  is in rem, so that would scale every padding, gap and button height too — the
  whole interface would zoom. That breaks things we deliberately fixed: the
  flashcard screen fits one viewport exactly, and the quiz's bottom bar is
  positioned to clear the home indicator. Zooming the lot puts both back out.

  So this scales one thing: the text a learner actually reads at length.
  Questions, answer options, explanations and flashcard faces. Headers, tab
  bars, buttons and progress figures stay where they are, which is what keeps
  the layout intact at the largest setting.

  HOW IT WORKS

  A CSS custom property on <html>, and a handful of classes that multiply their
  own base size by it. The classes are injected once as a <style> tag, so this
  file needs no build-step changes and nothing in index.css.

      <p className="rd-body">    0.875rem × scale
      <h2 className="rd-lead">   1.125rem × scale

  Changing the setting updates one property and every element using those
  classes reflows. No re-render, no prop threading through five components.
  ===========================================================================
*/

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

/* Four steps, deliberately narrow.

   The top of the range is 1.25×, not 2×. Past about 1.3 the longer questions
   stop fitting a phone screen and the learner is scrolling mid-question, which
   is worse for reading than small text. This is an adjustment, not an
   accessibility zoom — someone who needs much larger text is better served by
   the system-wide setting in iOS or Android, which this respects anyway. */
export const TEXT_SIZES = [
  { id: "sm", label: "Small",   sample: "Aa", scale: 0.92 },
  { id: "md", label: "Default", sample: "Aa", scale: 1 },
  { id: "lg", label: "Large",   sample: "Aa", scale: 1.12 },
  { id: "xl", label: "Largest", sample: "Aa", scale: 1.25 },
];

export const DEFAULT_TEXT_SIZE = "md";

const STORAGE_KEY = "pdt-text-size";
const STYLE_ID = "pdt-readable-styles";

const TextSizeContext = createContext(null);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return TEXT_SIZES.some(s => s.id === v) ? v : DEFAULT_TEXT_SIZE;
  } catch {
    /* private mode, or storage disabled */
    return DEFAULT_TEXT_SIZE;
  }
}

/* The stylesheet. Injected once.

   line-height stays unitless so it scales with the font rather than being
   pinned — a fixed line-height at 1.25× scale gives cramped, overlapping text.

   text-wrap: pretty asks the browser to avoid leaving one word alone on the
   last line, which happens far more often once text is enlarged. Ignored by
   browsers that don't support it. */
const CSS = `
:root { --rd-scale: 1; }

.rd-body   { font-size: calc(0.875rem * var(--rd-scale)); line-height: 1.55; }
.rd-option { font-size: calc(0.875rem * var(--rd-scale)); line-height: 1.45; }
.rd-lead   { font-size: calc(1.125rem * var(--rd-scale)); line-height: 1.35; text-wrap: pretty; }
.rd-card   { font-size: calc(1.125rem * var(--rd-scale)); line-height: 1.4;  text-wrap: pretty; }
.rd-card-lg{ font-size: calc(1.25rem  * var(--rd-scale)); line-height: 1.35; text-wrap: pretty; }
`;

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function TextSizeProvider({ children }) {
  const [sizeId, setSizeId] = useState(readStored);

  useEffect(() => { ensureStyles(); }, []);

  useEffect(() => {
    const entry = TEXT_SIZES.find(s => s.id === sizeId) || TEXT_SIZES[1];
    document.documentElement.style.setProperty("--rd-scale", String(entry.scale));
    /* Handy for styling anything that needs to know, and for debugging. */
    document.documentElement.setAttribute("data-text-size", entry.id);
    try { localStorage.setItem(STORAGE_KEY, entry.id); } catch { /* ignore */ }
  }, [sizeId]);

  const value = useMemo(() => ({
    sizeId,
    setSizeId,
    sizes: TEXT_SIZES,
    scale: (TEXT_SIZES.find(s => s.id === sizeId) || TEXT_SIZES[1]).scale,
  }), [sizeId]);

  return (
    <TextSizeContext.Provider value={value}>{children}</TextSizeContext.Provider>
  );
}

/* Degrades to the default rather than throwing if the provider is missing —
   a reading preference is not worth taking the whole app down over. */
export function useTextSize() {
  return useContext(TextSizeContext) || {
    sizeId: DEFAULT_TEXT_SIZE,
    setSizeId: () => {},
    sizes: TEXT_SIZES,
    scale: 1,
  };
}
