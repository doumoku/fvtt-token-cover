/* globals
canvas,
CONFIG,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, IGNORES_COVER_HANDLER } from "./const.js";
import { CoverCalculator } from "./CoverCalculator.js";
import { Settings } from "./settings.js";
import { log } from "./util.js";


// Class to use to handle added methods and getters for token
// Encapsulated inside Token.prototype.tokencover

/* Token Cover

Track cover types and cover effects for each token behind the scenes.
Token properties:
- coverCalculator. For calculating whether other tokens have cover from this token.
- coverFromMap. Map of cover types and percents for every other token on the scene.


Attackers are always the selected token(s) unless Combatant is chosen.
Settings control whether attackers are tracked and how types and effects are assigned.
Effects require types, so greater number of attackers will be used.
()

- Never: Not tracked.
- Attack: Not tracked. Handled at the moment of attack.
- Combat: Only track during combat.
- Combatant: Only the current user; combatant is the attacker.
- Targeting boolean: Only assign cover types, effects to targeted tokens.


CoverType icon display:
- Only if visible.
- Only if 1+ attackers
- Only if token is not attacker.
- Only if use setting met. combat/target/combatant

CoverEffect application:
- During attack workflow. Otherwise...
- Only if 1+ attackers
- Only if token is not attacker.
- Only if use setting met. combat/target/combatant

Triggers:
- Cover calc. setting changed. Wipe all cover calculations. Refresh all tokens.
- CoverType use setting changed.
- Attacker changed
- Token selected/unselected. Potentially refresh display
- Token targeted/untargeted
- Token moves/updates.
- Attacker moves/updates.


Use Settings triggers:
- Token controlled/uncontrolled. Potentially add/remove attackers.
- Token targeted/untargeted. Possibly update cover type and effect application
- Combat started/ended
- Combatant changed
- Attack workflow



Token getters:
- coverCalculator: Instantiation of CoverCalculator where this token is the attacker.
- coverTypes: Set of CoverTypes currently assigned to this token.
- coverEffects: Set of CoverEffects currently assigned to this token.
- coverFromMap: Percentage and CoverTypes for this token relative to every other token (attackers)
- ignoresCover: Instantiation fo IgnoresCover class to determine if this token ignores cover for attacks

Token methods:
- coverPercentFromAttacker: Calculated/cached percent cover for this token from an attacker. Uses coverFromMap
- coverTypeFromAttacker: Calculated/cached cover type for this token from an attacker. Uses coverFromMap
- updateCoverTypes: Updates the cover types for this token given updated attackers
- updateCoverEffects: Updates the cover effects for this token given updated attackers
- refreshCoverTypes: Sets icons representing cover types on this token, given token.coverTypes and current display settings.
                     Setting icons can be forced, e.g. during attack roll.
- refreshCoverEffects: Sets effects representing cover effects on this token, given token.coverEffects and current display settings.
                       Setting effects can be forced, e.g. during attack roll.

The refresh methods can be triggered by renderFlags. Render flags affect the token for all users.


Helper functions:
- RefreshAllCover: When changing a setting, refresh all the cover for all users. Requires sockets.
                   Loops through tokens and calls refresh on each.


Triggers:
- Token is targeted or untargeted. If targeting option is set.
- Token is controlled or uncontrolled. If controlled option is set
- Token is moved. Wipe existing cover calculations. Refresh based on control or target.
- Combat.
-
*/

export class TokenCover {
  /** @type {Token} */
  token;

  /** @type {IgnoresCover} */
  ignoresCover;

  /** @type {CoverCalculator} */
  coverCalculator;

  /**
   * Map of token ids. Object is:
   *  - @prop {number} percentCover
   *  - @prop {Set<CoverType>} coverTypes
   * @type {Map<string|object>}
   */
  coverFromMap = new Map();

  constructor(token) {
    this.token = token;
    this.ignoresCover = new IGNORES_COVER_HANDLER(token);
    this.coverCalculator = new CoverCalculator(token);
  }

  // ----- NOTE: Methods ----- //

  /**
   * Destroy this object, clearing its subobjects from memory.
   */
  destroy() { this.coverCalculator.destroy(); }

  /**
   * Returns the stored cover percent or calculates it, as necessary.
   * @param {Token} attackingToken   Other token from which this token may have cover
   * @returns {number}
   */
  coverPercentFromAttacker(attackingToken) {
    const { coverFromMap, token } = this;
    if ( !coverFromMap.has(attackingToken.id) ) this.constructor.updateCoverFromToken(token, attackingToken);
    return coverFromMap.get(attackingToken.id).percentCover;
  }

  /**
   * Returns the stored cover type or calculates it, as necessary.
   * @param {Token} attackingToken   Other token from which this token may have cover
   * @returns {CoverType[]}
   */
  coverTypesFromAttacker(attackingToken) {
    const { coverFromMap, token } = this;
    if ( !coverFromMap.has(attackingToken.id) ) this.constructor.updateCoverFromToken(token, attackingToken);
    return coverFromMap.get(attackingToken.id).coverTypes;
  }

  /**
   * Calculates the cover types for multiple attackers. Least cover wins.
   * @param {Token[]} attackingTokens
   * @returns {Set<CoverType>}
   */
  coverTypesFromAttackers(attackingTokens) {
    return CONFIG[MODULE_ID].CoverType.minimumCoverFromAttackers(this.token, attackingTokens);
  }

  /**
   * Get the cover types for the current attacker set.
   * @returns {Set<CoverType>}
   */
  _coverTypesFromCurrentAttackers() {
    return CONFIG[MODULE_ID].CoverType.minimumCoverFromAttackers(this.token, this.constructor.attackers["COVER_TYPES"]);
  }

  /**
   * Get the cover effects for the current attacker set.
   * @returns {Set<CoverEffect>}
   */
  _coverEffectsFromCurrentAttackers() {
    const coverTypes = CONFIG[MODULE_ID].CoverType.minimumCoverFromAttackers(this.token, this.constructor.attackers["COVER_EFFECTS"]);
    const allCoverEffects = [...CONFIG[MODULE_ID].CoverEffect.coverObjectsMap.values()];
    return new Set(allCoverEffects.filter(ce => coverTypes.intersects(ce.coverTypes)));
  }

  /**
   * Should the cover type/effect be applied to this token?
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   * @returns {boolean}
   */
  useCoverObject(type = "COVER_TYPES") {
    const token = this.token;
    if ( type === "COVER_TYPES" && !token.isVisible ) return false;
    if ( this.isAttacker(type) ) return false;
    const { TARGETING, USE, CHOICES } = Settings.KEYS[type];
    const targetsOnly = Settings.get(TARGETING);
    if ( targetsOnly && !token.isTargeted ) return false;
    switch ( Settings.get(USE) ) {
      case CHOICES.NEVER: return false;
      case CHOICES.ATTACK: return false; // Handled by forcing application in the workflow.
      case CHOICES.ALWAYS: return true;
      case CHOICES.COMBAT: return Boolean(game.combat?.started);
      case CHOICES.COMBATANT: return game.combat?.started
        && token.combatant
        && game.combat.combatants.has(token.combatant.id);
      default: return false;
    }
  }

  /**
   * Is this token an attacker for purposes of types and effects? Checks settings.
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   * @return {boolean}
   */
  isAttacker(type = "COVER_TYPES") {
    const CHOICES = Settings.KEYS[type].CHOICES
    const token = this.token;
    switch ( Settings.get(Settings.KEYS[type].USE) ) {
      case CHOICES.NEVER: return false;
      case CHOICES.COMBATANT: {
        return game.combat?.started
          && token.combatant
          && game.combat.combatants.has(token.combatant.id)
      }
      case CHOICES.COMBAT: if ( !game.combat?.started ) return false;
      case CHOICES.ATTACK:  // eslint-disable-line no-fallthrough
      case CHOICES.ALWAYS: return token.controlled;
    }
  }

  /**
   * Attacker set changed.
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   */
  attackersChanged(type = "COVER_TYPES") {
    if ( this.constructor.attackers[type].has(this.token) ) {
      if ( type === "COVER_TYPES" ) this.clearCoverTypes();
      else if ( type === "COVER_EFFECTS" ) this.clearCoverEffects();
      return;
    }
    if ( type === "COVER_TYPES" ) this.updateCoverTypes();
    else if ( type === "COVER_EFFECTS" ) this.updateCoverEffects();
  }

  /**
   * Something about an attacker position was updated.
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   */
  attackerMoved(type = "COVER_TYPES") {
    if ( this.constructor.attackers[type].has(this.token) ) return;

    log(`TokenCover#attackerMoved|${type}|defender: ${this.token.name}`);
    if ( type === "COVER_TYPES" ) this.updateCoverTypes();
    else if ( type === "COVER_EFFECTS" ) this.updateCoverEffects();
  }

  /**
   * Something about this token position was updated.
   */
  tokenMoved() {
    this.coverFromMap.clear();
    this.updateCoverTypes();
    this.updateCoverEffects();
  }

  /**
   * This token's target status changed.
   */
  targetStatusChanged() {
    const { COVER_TYPES, COVER_EFFECTS } = Settings.KEYS;
    if ( Settings.get(COVER_TYPES.TARGETING) ) {
      if ( this.useCoverObject("COVER_TYPES") ) this.updateCoverTypes();
      else this.clearCoverTypes();
    }
    if ( Settings.get(COVER_EFFECTS.TARGETING) ) {
      if ( this.useCoverObject("COVER_EFFECTS") ) this.updateCoverEffects();
      else this.clearEffects();
    }
  }

  /**
   * Remove all cover icons from this token.
   * @returns {boolean} True if a change occurred
   */
  clearCoverTypes() {
    // Trigger token icons update if there was a change.
    const token = this.token;
    const changed = CONFIG[MODULE_ID].CoverType.replaceCoverTypes(token); // Null set.
    if ( changed ) {
      token.renderFlags.set({ redrawEffects: true });
      log(`TokenCover#updateCoverTypes|${this.token.name}|clearing cover icons`);
    }
    return changed;
  }

  /**
   * Remove all cover effects from this token.
   * @returns {boolean} True if a change occurred
   */
  clearCoverEffects() {
    // Trigger local effects update for actor; return changed state.
    const changed = CONFIG[MODULE_ID].CoverEffect.replaceLocalEffectsOnActor(this.token); // Null set.
    if ( changed ) log(`TokenCover#clearCoverEffects|${this.token.name}|clearing cover effects`);
    return changed;
  }

  /**
   * Add applicable cover types to this token.
   * @returns {boolean} True if a change occurred
   */
  updateCoverTypes() {
    if ( !this.useCoverObject("COVER_TYPES") ) return this.clearCoverTypes();
    log(`TokenCover#updateCoverTypes|${[...this.constructor.attackers.COVER_TYPES.values().map(a => a.name + ": " + a.x + "," + a.y)].join("\t")}`);
    const coverTypes = this._coverTypesFromCurrentAttackers();
    const changed = CONFIG[MODULE_ID].CoverType.replaceCoverTypes(this.token, coverTypes);
    if ( changed ) {
      log(`TokenCover#updateCoverTypes|${this.token.name}|changing cover icons to: ${[...coverTypes.values().map(ct => ct.name)].join(", ")}`);
      this.token.renderFlags.set({ redrawEffects: true });
    }
    return changed;
  }

  /**
   * Add applicable cover effects to this token.
   * @returns {boolean} True if a change occurred
   */
  updateCoverEffects() {
    if ( !this.useCoverObject("COVER_EFFECTS") ) return this.clearCoverEffects();
    const coverTypes = this._coverTypesFromCurrentAttackers();
    const allCoverEffects = [...CONFIG[MODULE_ID].CoverEffect.coverObjectsMap.values()];
    const newCoverEffects = new Set(allCoverEffects.filter(ce => coverTypes.intersects(ce.coverTypes)));
    const changed = CONFIG[MODULE_ID].CoverEffect.replaceLocalEffectsOnActor(this.token, newCoverEffects);
    if ( changed ) log(`TokenCover#updateCoverEffects|${this.token.name}|changing cover effects to: ${[...newCoverEffects.values().map(ct => ct.name)].join(", ")}`);
    return changed;
  }


  // ----- NOTE: Static getters/setters/properties ----- //

  /**
   * Track attackers for this user.
   * @type {object}
   *   - @prop {Set<Token>} COVER_TYPES
   *   - @prop {Set<Token>} COVER_EFFECTS
   */
  static attackers = {
    COVER_TYPES: new Set(),
    COVER_EFFECTS: new Set()
  };

  // ----- NOTE: Static methods ----- //

  /**
   * A token position was updated.
   * @param {Token} token
   */
  static tokenMoved(token) {
    // Clear cover calculations from other tokens.
    const id = token.id;
    canvas.tokens.placeables.forEach(t => t.tokencover.coverFromMap.delete(id));

    // Update this token's cover data.
    token.tokencover.tokenMoved();

    // If this token is an attacker, tell all other tokens that their cover status may have changed.
    if ( this.attackers.COVER_TYPES.has(token) ) canvas.tokens.placeables.forEach(t => t.tokencover.attackerMoved("COVER_TYPES"));
    if ( this.attackers.COVER_EFFECTS.has(token) ) canvas.tokens.placeables.forEach(t => t.tokencover.attackerMoved("COVER_EFFECTS"));
  }


  /**
   * Add an attacker to the user's set.
   * @param {Token} token
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   * @param {boolean} [force=false]                   Should the attacker be added even if it fails "isAttacker"?
   * @return {boolean} True if results in addition.
   */
  static addAttacker(token, type = "COVER_TYPES", force = false, update = true) {
    if ( this.attackers[type].has(token) ) return false;
    if ( !force && !token.tokencover.isAttacker(type) ) return false;
    this.attackers[type].add(token);
    log(`TokenCover#addAttacker|Adding attacker ${token.name} for ${type}.`)

    // Update each token's display.
    if ( update ) canvas.tokens.placeables.forEach(t => t.tokencover.attackersChanged(type));
  }

  /**
   * Remove an attacker from the user's set.
   * @param {Token} token
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   * @param {boolean} [force=false]                   Should the attacker be added even if it fails "isAttacker"?
   * @return {boolean} True if results in addition.
   */
  static removeAttacker(token, type = "COVER_TYPES", update = true) {
    if ( !this.attackers[type].has(token) ) return false;
    this.attackers[type].delete(token);
    log(`TokenCover#removeAttacker|Removing attacker ${token.name} for ${type}.`)

    // Update each token's display.
    if ( update ) canvas.tokens.placeables.forEach(t => t.tokencover.attackersChanged(type));
  }

  /**
   * Determine the current attackers and update the attacker set accordingly.
   * @param {"COVER_TYPES"|"COVER_EFFECTS"} [type]    What setting type applies?
   * @return {boolean} True if results in change.
   */
  static updateAttackers(type = "COVER_TYPES") {
    const newAttackers = new Set(canvas.tokens.placeables.filter(t => t.tokencover.isAttacker(type)));
    let change = false;
    for ( const oldAttacker in this.attackers[type] ) {
      if ( newAttackers.has(oldAttacker) ) continue;
      const res = this.removeAttacker(oldAttacker, type, false);
      change ||= res;
    }
    for ( const newAttacker in newAttackers ) {
      const res = this.addAttacker(newAttacker, type, false, false);
      change ||= res;
    }
    if ( change ) canvas.tokens.placeables.forEach(t => t.tokencover.attackersChanged(type));
    return change;
  }

  // ----- NOTE: Static helper functions ----- //


  /**
   * Helper to update whether this token has cover from another token.
   * @param {Token} tokenToUpdate   Token whose cover should be calculated
   * @param {Token} attackingToken  Other token from which this token may have cover
   * @returns {CoverTypes[]} Array of cover types, for convenience.
   */
  static updateCoverFromToken(tokenToUpdate, attackingToken) {
    const percentCover = attackingToken.tokencover.coverCalculator.percentCover(tokenToUpdate);
    const coverTypes = attackingToken.tokencover.coverCalculator.coverTypes(tokenToUpdate);
    log(`updateCoverFromToken|${attackingToken.name} ⚔️ ${tokenToUpdate.name}: ${percentCover}
    \t${attackingToken.name} ${attackingToken.document.x},${attackingToken.document.y} Center ${attackingToken.center.x},${attackingToken.center.y}
    \t${tokenToUpdate.name} ${tokenToUpdate.document.x},${tokenToUpdate.document.y} Center ${tokenToUpdate.center.x},${tokenToUpdate.center.y}`);
    tokenToUpdate.tokencover.coverFromMap.set(attackingToken.id, { coverTypes, percentCover});
  }


  /**
   * Helper to force update cover types and effects for all tokens for the current user on the canvas.
   * Used when changing settings related to cover types or effects.
   */
  static _forceUpdateAllTokenCover() {
    canvas.tokens.placeables.forEach(t => {
      log(`updateAllTokenCover|updating cover for ${t.name}.`);
      t.tokencover.updateCoverTypes()
      t.tokencover.updateCoverEffects()
      t.tokencover.refreshCoverTypes();
      t.tokencover.refreshCoverEffects();
    });
  }

  /**
   * Reset all cover maps.
   */
  static _resetAllCover() {
    canvas.tokens.placeables.forEach(t =>  t.tokencover.coverFromMap.clear());
  }

  /**
   * Helper to remove cover calculations for a given attacker.
   * The presumption here is that the attacker changed position or some other property meaning
   * that the previous cover calculation is no longer valid.
   * @param {Token} attacker
   */
  static resetTokenCoverFromAttacker(attacker) {
    // Clear all other token's cover calculations for this token.
    const id = attacker.id;
    canvas.tokens.placeables.forEach(t => {
      if ( t === attacker ) return;
      t.tokencover.coverFromMap.delete(id);
    });
  }
}
