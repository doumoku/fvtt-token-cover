/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID, MODULES_ACTIVE, COVER, IGNORES_COVER_HANDLER } from "./const.js";
import { CoverCalculator } from "./CoverCalculator.js";
import { SETTINGS, Settings } from "./Settings.js";
import { isFirstGM } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.sfrpg = {};
PATCHES.NO_PF2E = {};

// ----- NOTE: Hooks ----- //

/**
 * If a token is targeted, determine its cover status.
 *
 * A hook event that fires when a token is targeted or un-targeted.
 * @function targetToken
 * @memberof hookEvents
 * @param {User} user        The User doing the targeting
 * @param {Token} token      The targeted Token
 * @param {boolean} targeted Whether the Token has been targeted or untargeted
 */
async function targetToken(user, target, targeted) {
  if ( !isFirstGM()
    || !Settings.get(SETTINGS.COVER.COMBAT_AUTO)
    || !game.combat?.started // If not in combat, do nothing because it is unclear who is targeting what...
    || !isUserCombatTurn(user)  // Ignore targeting by other users
  ) return;

  if ( !targeted ) return await CoverCalculator.disableAllCover(target.id);

  // Target from the current combatant to the target token
  const c = game.combats.active;
  const combatToken = c.combatant.token.object;
  const coverCalc = new CoverCalculator(combatToken, target);
  return await coverCalc.setTargetCoverEffect();
}

/**
 * For Starfinder, hook apply token status effect to add the cover item as needed.
 * @param {Token} token           The token the status is being applied to
 * @param {string} statusId       The status effect ID being applied, from CONFIG.specialStatusEffects
 * @param {boolean} active        Is the special status effect now active?
 */
function applyTokenStatusEffect(token, statusId, active) {
  if ( game.system.id !== "sfrpg" ) return;

  // Is this a cover status?
  // statusId is all lowercase, at least in sfrpg.
  const cover = COVER.TYPES_FOR_ID[MODULE_ID][statusId];
  if ( !cover ) return;
  return active ? CoverCalculator.enableCover(token, COVER.TYPES_FOR_ID[MODULE_ID][statusId])
    : CoverCalculator.disableAllCover(token);
}

/**
 * Hook controlToken
 * If the token is controlled or uncontrolled, clear debug drawings.
 */
function controlToken(_token, _controlled) {
  Settings.clearDebugGraphics();
}

/**
 * Hook: updateToken
 * If the token width/height changes, invalidate the tokenShape.
 * If the token moves, clear all debug drawings.
 * @param {Document} tokenD                         The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow

 */
function updateToken(tokenD, change, _options, _userId) {
  // Token shape changed; invalidate cached shape.
  const token = tokenD.object;
  if ( (Object.hasOwn(change, "width") || Object.hasOwn(change, "height")) && token ) token._tokenShape = undefined;

  // Token moved; clear drawings.
  if ( Object.hasOwn(change, "x")
    || Object.hasOwn(change, "y")
    || Object.hasOwn(change, "elevation") ) Settings.clearDebugGraphics();
}

PATCHES.BASIC.HOOKS = { controlToken, updateToken };
PATCHES.sfrpg.HOOKS = { applyTokenStatusEffect };
PATCHES.NO_PF2E.HOOKS = { targetToken };

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype.updateSource
 * Reset the debugging drawings.
 */
function updateSource(wrapper, ...args) {
  Settings.clearDebugGraphics();
  return wrapper(...args);
}

PATCHES.BASIC.WRAPS = {
  updateSource
};

// ----- NOTE: Getters ----- //

/**
 * New getter: Token.prototype.coverType
 * Determine what type of cover the token has, if any.
 * @type {COVER_TYPES}
 */
function coverType() {
  const statuses = this.actor?.statuses;
  if ( !statuses ) return COVER.TYPES.NONE;
  const coverModule = MODULES_ACTIVE.DFREDS_CE ? "dfreds-convenient-effects" : "tokenvisibility";
  return statuses.has(COVER.CATEGORIES.HIGH[coverModule]) ? COVER.TYPES.HIGH
    : statuses.has(COVER.CATEGORIES.MEDIUM[coverModule]) ? COVER.TYPES.MEDIUM
      : statuses.has(COVER.CATEGORIES.LOW[coverModule]) ? COVER.TYPES.LOW
        : COVER.TYPES.NONE;
}

/**
 * New getter: Token.prototype.ignoresCoverType
 * Instantiate a IgnoresCover class to determine if cover can be ignored for different attack types.
 * @type {boolean}
 */
function ignoresCoverType() {
  return this._ignoresCoverType || (this._ignoresCoverType = new IGNORES_COVER_HANDLER(this));
}

PATCHES.BASIC.GETTERS = {
  coverType,
  ignoresCoverType
};

// ----- NOTE: Helper functions ----- //

/**
 * Determine if the user's token is the current combatant in the active tracker.
 * @param {User} user
 * @returns {boolean}
 */
function isUserCombatTurn(user) {
  if ( !game.combat?.started ) return false;

  // If no players, than it must be a GM token
  const c = game.combats.active;
  if ( !c.combatant.players.length ) return user.isGM;
  return c.combatant.players.some(player => user.name === player.name);
}
