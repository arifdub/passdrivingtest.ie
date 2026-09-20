/*
  ===========================================================================
  FLASHCARD PLAYER

  Works for all three decks — Rules of the Road, Road Signs, ADI — because the
  only difference between them is whether the front of the card is text or a
  sign image. That comes from `deck.imageCards`.

  Gestures
    swipe left   → next card
    swipe right  → previous card
    tap          → flip
    ← → keys     → previous / next   (desktop)
    space        → flip              (desktop)

  The card follows your finger while you drag, then either flies off screen
  and the next one slides in from the opposite side, or springs back to centre
  if you didn't drag far enough. Same animation the original deck had.

  "Known" marks are stored per module in the progress store, so they sync with
  everything else and follow the learner to another device.
  ===========================================================================
*/

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Shuffle, Check, RotateCcw, ListFilter, X,
} from "lucide-react";
import { ScreenHeader, Screen, FullScreen } from "./ui";
import { useProgress } from "./progressStore";

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* How far you have to drag before it counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 55;
const ANIM_MS = 260;

export default function FlashcardPlayer({ module, deck, onExit }) {
  const { getModule, toggleCardKnown } = useProgress();
  const progress = getModule(module.id);
  const known = progress.completedIds || [];

  const [catFilter, setCatFilter] = useState("all"); // all | <catId> | known | unknown
  const [showFilters, setShowFilters] = useState(false);
  const [order, setOrder] = useState(null); // null = natural order
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  /* The deck currently on screen, after filtering and any shuffle. */
  const cards = useMemo(() => {
    let list = deck.cards;
    if (catFilter === "known") {
      list = list.filter(c => known.includes(c.id));
    } else if (catFilter === "unknown") {
      list = list.filter(c => !known.includes(c.id));
    } else if (catFilter !== "all") {
      list = list.filter(c => c.c === catFilter);
    }
    if (!order) return list;
    const byId = Object.fromEntries(list.map(c => [c.id, c]));
    return order.map(id => byId[id]).filter(Boolean);
  }, [deck.cards, catFilter, order, known]);

  const total = cards.length;                       // cards in the current view
  const card = cards[index] || null;
  const knownInView = cards.filter(c => known.includes(c.id)).length;

  /* Whole-deck figures. These drive the progress bar, so it always means the
     same thing — "how much of this deck do I know" — whatever filter is on.
     The filtered count is reported separately rather than replacing it. */
  const deckTotal = deck.cards.length;
  const deckKnown = deck.cards.filter(c => known.includes(c.id)).length;
  const pct = deckTotal ? Math.round((deckKnown / deckTotal) * 100) : 0;
  const filtered = catFilter !== "all";
  const remaining = deckTotal - deckKnown;

  /* -----------------------------------------------------------------------
     ANIMATION

     Three phases. "out" slides the current card off screen, then the index
     changes, then "in" drops the new card off screen on the opposite side
     with no transition and releases it back to centre on the next paint.
     ----------------------------------------------------------------------- */
  const [animPhase, setAnimPhase] = useState("idle"); // idle | out | in
  const [animDir, setAnimDir] = useState(1);          // 1 = forward, -1 = back
  const animTimer = useRef(null);
  const animFrame = useRef(null);

  const step = useCallback((delta) => {
    setFlipped(false);
    setIndex(p => {
      if (total === 0) return 0;
      const next = p + delta;
      if (next < 0) return total - 1;
      if (next >= total) return 0;
      return next;
    });
  }, [total]);

  const triggerChange = useCallback((delta) => {
    if (animPhase !== "idle" || total < 2) return;
    setAnimDir(delta);
    setAnimPhase("out");
  }, [animPhase, total]);

  useEffect(() => {
    if (animPhase === "out") {
      animTimer.current = setTimeout(() => {
        step(animDir);
        setAnimPhase("in");
      }, ANIM_MS);
    } else if (animPhase === "in") {
      animFrame.current = requestAnimationFrame(() => {
        animFrame.current = requestAnimationFrame(() => setAnimPhase("idle"));
      });
    }
    return () => {
      clearTimeout(animTimer.current);
      cancelAnimationFrame(animFrame.current);
    };
  }, [animPhase, animDir, step]);

  /* -----------------------------------------------------------------------
     DRAG

     Two things matter here and both were wrong in the first version:

     1. setPointerCapture. Without it the element stops receiving move events
        the moment your finger leaves its bounds, which on a phone is almost
        immediately. The swipe would start and then silently die.

     2. Axis locking has to wait. A real horizontal swipe often starts with a
        few pixels of downward drift, so checking "is dy bigger than dx" on
        the very first move event cancels legitimate swipes. Instead we hold
        off until the finger has travelled far enough to know, then commit to
        one axis for the rest of the gesture.
     ----------------------------------------------------------------------- */
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);
  const axis = useRef(null);   // null = undecided, "x" = swiping, "y" = scrolling
  const moved = useRef(false);

  const DECIDE_AFTER = 10;     // px of travel before we pick an axis

  function onPointerDown(e) {
    if (animPhase !== "idle") return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = null;
    moved.current = false;
    // Keeps every move and up event coming to this element even once the
    // finger has moved well outside it.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    setDragging(true);
  }

  function onPointerMove(e) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (axis.current === null) {
      if (Math.hypot(dx, dy) < DECIDE_AFTER) return;  // too early to tell
      axis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (axis.current === "y") {
        // They're scrolling the page. Let go entirely.
        start.current = null;
        setDragging(false);
        setDragX(0);
        return;
      }
    }

    if (axis.current === "x") {
      moved.current = true;
      setDragX(dx);
    }
  }

  function onPointerUp(e) {
    if (!start.current) return;
    const dx = dragX;
    start.current = null;
    axis.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    if (Math.abs(dx) > SWIPE_THRESHOLD && total > 1) {
      // The fly-away animation carries on from wherever the finger let go.
      triggerChange(dx < 0 ? 1 : -1);
      setDragX(0);
      return;
    }
    // Not far enough — spring back, and treat it as a tap if it barely moved.
    setDragX(0);
    if (!moved.current) setFlipped(f => !f);
  }

  /* Keyboard, for anyone on a laptop. */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowRight") { e.preventDefault(); triggerChange(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); triggerChange(-1); }
      else if (e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerChange]);

  /* -----------------------------------------------------------------------
     The card's transform, derived from drag position and animation phase.
     ----------------------------------------------------------------------- */
  const cardStyle = useMemo(() => {
    const base = { touchAction: "pan-y" };
    if (dragging) {
      return {
        ...base,
        transform: `translateX(${dragX}px) rotate(${dragX / 22}deg)`,
        opacity: 1 - Math.min(Math.abs(dragX) / 500, 0.35),
        transition: "none",
      };
    }
    if (animPhase === "out") {
      return {
        ...base,
        transform: `translateX(${animDir === 1 ? "-130%" : "130%"}) rotate(${animDir === 1 ? "-8deg" : "8deg"})`,
        opacity: 0,
        transition: `transform ${ANIM_MS}ms ease-in, opacity ${ANIM_MS}ms ease-in`,
      };
    }
    if (animPhase === "in") {
      return {
        ...base,
        transform: `translateX(${animDir === 1 ? "130%" : "-130%"}) rotate(${animDir === 1 ? "8deg" : "-8deg"})`,
        opacity: 0,
        transition: "none",
      };
    }
    return {
      ...base,
      transform: "translateX(0) rotate(0deg)",
      opacity: 1,
      transition: `transform ${ANIM_MS}ms ease-out, opacity ${ANIM_MS}ms ease-out`,
    };
  }, [dragging, dragX, animPhase, animDir]);

  /* ----------------------------------------------------------------------- */
  function doShuffle() {
    setOrder(shuffle(cards).map(c => c.id));
    setIndex(0);
    setFlipped(false);
  }

  function reset() {
    setOrder(null);
    setIndex(0);
    setFlipped(false);
  }

  function applyFilter(value) {
    setCatFilter(value);
    setOrder(null);
    setIndex(0);
    setFlipped(false);
    setShowFilters(false);
  }

  async function markKnown() {
    if (!card) return;
    const wasKnown = known.includes(card.id);
    await toggleCardKnown(module.id, card.id);
    // Marking something known should move you on — that's the point of it.
    if (!wasKnown && total > 1) triggerChange(1);
  }

  const isKnown = card ? known.includes(card.id) : false;

  return (
    <FullScreen>
      <ScreenHeader
        compact
        title={deck.title}
        subtitle={`${deck.categories.length} topics`}
        onBack={onExit}
        backLabel={module.sectionLabel}
        below={
          /* Progress lives in the header rather than in a card below it. On a
             phone that card cost about 110px, which was the difference between
             this screen fitting and needing a scroll. */
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-sm font-bold text-white">
                {deckKnown}
                <span className="text-slate-400 font-semibold"> / {deckTotal} known</span>
              </span>
              <span className={`text-sm font-black ${
                pct === 100 ? "text-emerald-400" : "text-slate-400"
              }`}>
                {pct}%
              </span>
            </div>
            <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  pct === 100 ? "bg-emerald-400" : deckKnown ? "bg-amber-400" : "bg-white/30"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {filtered && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Showing {knownInView}/{total} in this filter
              </p>
            )}
          </div>
        }
      />

      <Screen fill>
        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200"
          >
            <ListFilter size={15} />
            {catFilter === "all" ? "All topics"
              : catFilter === "known" ? "Known"
              : catFilter === "unknown" ? "Still learning"
              : deck.cat[catFilter]?.label || "Filter"}
          </button>
          <button
            onClick={doShuffle}
            className="flex items-center gap-1.5 text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200"
          >
            <Shuffle size={15} /> Shuffle
          </button>
          {order && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 px-2 py-2"
            >
              <RotateCcw size={15} />
            </button>
          )}
        </div>

        {showFilters && (
          /* shrink-0 with its own scroll: a 20-topic list would otherwise
             squeeze the card down to nothing when the filters are open. */
          <div className="mt-2.5 shrink-0 max-h-[34vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip label="All topics" active={catFilter === "all"} onClick={() => applyFilter("all")} />
              <FilterChip label="Still learning" active={catFilter === "unknown"} onClick={() => applyFilter("unknown")} />
              <FilterChip label="Known" active={catFilter === "known"} onClick={() => applyFilter("known")} />
              {deck.categories.map(c => (
                <FilterChip
                  key={c.id}
                  label={c.label}
                  active={catFilter === c.id}
                  onClick={() => applyFilter(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Card */}
        {!card ? (
          /* Grows too, so an empty deck doesn't leave the same dead space the
             card screen used to. */
          <div className="mt-3.5 flex-1 flex flex-col items-center justify-center text-center px-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl">
            <p className="font-bold text-slate-900 dark:text-white">Nothing here</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {catFilter === "unknown"
                ? "You've marked every card in this filter as known."
                : "No cards match this filter yet."}
            </p>
          </div>
        ) : (
          <>
            {/* The swipe transform and the flip live on two separate
                elements. Trying to combine translateX and rotateY on one
                element makes them fight each other — the flip axis moves with
                the card. Outer handles the swipe, inner handles the flip. */}
            {/* flex-1 rather than a fixed 240px. The card is the one thing on
                this screen worth making bigger, so it takes whatever height is
                left after the controls, the nav row and the button — which is
                what closes the gap at the bottom on a tall phone. min-h keeps
                it sane on a small one, where flex-1 has little to give. */}
            <div
              className="mt-3.5 flex-1 min-h-[200px] relative overflow-hidden rounded-3xl"
              style={{ perspective: "1400px" }}
            >
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={cardStyle}
                className="absolute inset-0 cursor-grab active:cursor-grabbing select-none"
              >
                <div
                  className="relative w-full h-full"
                  style={{
                    transformStyle: "preserve-3d",
                    transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                    transition: "transform 480ms cubic-bezier(0.4, 0.0, 0.2, 1)",
                  }}
                >
                  {/* FRONT */}
                  <CardFace>
                    {deck.cat[card.c] && (
                      <CategoryPill cat={deck.cat[card.c]} />
                    )}
                    {deck.imageCards ? (
                      <img
                        src={card.img}
                        alt=""
                        draggable={false}
                        /* Proportional, so the sign grows with the card on a
                           big phone instead of floating in a sea of white. */
                        className="max-h-[55%] max-w-[80%] w-auto object-contain pointer-events-none"
                        loading="lazy"
                      />
                    ) : (
                      <p className="rd-card font-bold text-slate-900 dark:text-white">
                        {card.q}
                      </p>
                    )}
                    <FaceHint>Tap to reveal</FaceHint>
                  </CardFace>

                  {/* BACK — pre-rotated so it faces outward once the card turns */}
                  <CardFace back>
                    {deck.cat[card.c] && (
                      <CategoryPill cat={deck.cat[card.c]} back />
                    )}
                    <p className={`text-white ${
                      deck.imageCards ? "rd-card-lg font-bold" : "rd-card"
                    }`}>
                      {deck.imageCards ? card.name : card.a}
                    </p>
                    <FaceHint back>Tap to go back</FaceHint>
                  </CardFace>
                </div>
              </div>
            </div>

            {/* Nav */}
            <div className="mt-3 shrink-0 flex items-center justify-between gap-3">
              <button
                onClick={() => triggerChange(-1)}
                className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="text-center">
                <span className="block text-sm font-mono font-bold text-slate-400">
                  {index + 1} / {total}
                </span>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600 mt-0.5">
                  Swipe to move
                </span>
              </div>

              <button
                onClick={() => triggerChange(1)}
                className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="mt-3 shrink-0">
              <button
                onClick={markKnown}
                className={`w-full font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 ${
                  isKnown
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                    : "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
                }`}
              >
                {isKnown ? <><X size={16} /> Study this again</> : <><Check size={16} /> I know this</>}
              </button>
            </div>
          </>
        )}
      </Screen>
    </FullScreen>
  );
}

/* One side of the card. backfaceVisibility hides whichever face is turned
   away — without it you'd see the answer mirrored through the front.

   The back is red so there's never any doubt which side you're looking at,
   even mid-flip or when glancing at it quickly. */
function CardFace({ children, back }) {
  return (
    <div
      /* overflow-y-auto matters once Reading size is turned up: the card is a
         fixed height, so a long answer at the largest setting would spill past
         its edges. It scrolls inside the card instead. overscroll-contain stops
         that scroll from dragging the page behind it.

         justify-center with overflow is a known trap — content taller than the
         box gets centred and the top is then unreachable. py-6 plus auto
         margins on the child does the centring without that failure. */
      className={`absolute inset-0 rounded-3xl px-6 py-6 flex flex-col text-center border overflow-y-auto overscroll-contain ${
        back
          ? "bg-red-600 dark:bg-red-700 border-red-700 dark:border-red-800"
          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
      }`}
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : "rotateY(0deg)",
      }}
    >
      <div className="m-auto w-full flex flex-col items-center">
        {children}
      </div>
    </div>
  );
}

/* On the red back face the category's own colour would clash, so it becomes a
   translucent white pill instead. */
function CategoryPill({ cat, back }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white mb-4 ${
        back ? "bg-white/25" : cat.swatch
      }`}
    >
      {cat.label}
    </span>
  );
}

function FaceHint({ children, back }) {
  return (
    <span className={`mt-6 text-[11px] font-bold uppercase tracking-widest ${
      back ? "text-white/60" : "text-slate-300 dark:text-slate-600"
    }`}>
      {children}
    </span>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${
        active
          ? "bg-emerald-500 text-slate-900"
          : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}
