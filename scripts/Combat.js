/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { CoverCalculator } from "./CoverCalculator.js"; // Required to avoid error that Settings cannot be accessed prior to initialization.
import { Settings } from "./settings.js";
import { TokenCover } from "./TokenCover.js";

// Patches for the Combat class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook after combat document is updated. Update the token cover for the new combatant.
 * Cannot use combatTurn hook b/c it fires before the turn changes.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateCombat(document, change, options, userId) {
  if ( !(Object.hasOwn(change, "turn")) ) return;
  const COVER_EFFECTS = Settings.KEYS.COVER_EFFECTS;
  if ( Settings.get(COVER_EFFECTS.USE) === COVER_EFFECTS.CHOICES.COMBATANT ) TokenCover.updateAttackers();
}

/**
 * Hook when combat starts, to trigger update of attackers.
 * @param {Combat} combat           The Combat encounter which is starting
 * @param {object} updateData       An object which contains Combat properties that will be updated. Can be mutated.
 * @param {number} updateData.round      The initial round
 * @param {number} updateData.turn       The initial turn
 */
function combatStart(combat, updateData) {
  combatChange();
}

/**
 * Hook when a combat is deleted, possibly triggering update of attackers.
 * Note that more than one combat may be present.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteCombat(document, options, userId) {
  if ( game.combats ) return; // Other combats present.
  combatChange();
}

PATCHES.BASIC.HOOKS = { updateCombat, combatStart, deleteCombat};

// ----- NOTE: Helper functions ---- //

/**
 * If combat starts/stops, update attackers.
 */
function combatChange() {
  const COVER_EFFECTS = Settings.KEYS.COVER_EFFECTS;
  const COMBAT = COVER_EFFECTS.CHOICES.COMBAT;
  const COMBATANT = COVER_EFFECTS.CHOICES.COMBATANT;
  const useCover = Settings.get(COVER_EFFECTS.USE);
  if ( useCover === COMBAT || useCover === COMBATANT ) return TokenCover.updateAttackers();
}

