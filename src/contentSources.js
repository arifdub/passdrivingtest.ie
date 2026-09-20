/*
  ===========================================================================
  CONTENT SOURCES

  Flashcard decks only. Questions are filed into the study sections in
  theorySections.js, which is where the app reads them from.
  ===========================================================================
*/

import { RULES_CARDS, RULES_CATEGORIES, RULES_CAT } from "./rulesFlashcardsData";
import { ROAD_SIGNS, ROAD_SIGN_CATEGORIES, ROAD_SIGN_CAT } from "./roadSignsData";

const DECKS = {
  "deck.rules": {
    cards: RULES_CARDS,
    categories: RULES_CATEGORIES,
    cat: RULES_CAT,
    imageCards: false,
    title: "Rules of the Road",
    subtitle: `${RULES_CARDS.length} cards across ${RULES_CATEGORIES.length} topics`,
  },
  "deck.signs": {
    cards: ROAD_SIGNS,
    categories: ROAD_SIGN_CATEGORIES,
    cat: ROAD_SIGN_CAT,
    imageCards: true,
    title: "Road Signs",
    subtitle: `${ROAD_SIGNS.length} official signs across ${ROAD_SIGN_CATEGORIES.length} categories`,
  },
};

export const getDeck = (deckId) => DECKS[deckId] || null;

export default DECKS;
