/* globals
CONFIG,
fromUuid,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, SOCKETS } from "./const.js";
import { CoverEffect } from "./CoverEffect.js";
import { log } from "./util.js";

/**
 * Cover Effect for systems like sfrpg that use items to signify effects.
 */
export class CoverItem extends CoverEffect {

  // ----- NOTE: Getters, setters, and related properties ----- //

  /**
   * Retrieve the cover effect icon for use in the list of cover effects.
   * @return {string}
   */
  get icon() { return this.document?.img; }

  /**
   * Data used when dragging a cover effect to an actor sheet.
   */
  get dragData() {
    const data = super.dragData;
    data.type = "Item";
    data.uuid = this.document?.uuid;
    return data;
  }

  // ----- NOTE: Methods ----- //

  /**
   * Find an existing local document to use for the storage.
   * @returns {Item|undefined}
   */
  _findStorageDocument() {
    return game.items.find(item => item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.ID) === this.id
      && item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.LOCAL));
  }

  /**
   * Load an async document to use for storage from the compendium.
   * @returns {Document|object|undefined}
   */
  async _loadStorageDocument() {
    const pack = game.packs.get(`${MODULE_ID}.${MODULE_ID}_items_${game.system.id}`);
    if ( !pack ) return;

    const compendiumId = this.constructor.defaultCoverObjectData.get(this.id)?.compendiumId;
    if ( !compendiumId ) return;
    const data = await pack.getDocument(compendiumId); // Async
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FLAGS.COVER_EFFECT.ID] ??= this.id;
    let doc;
    if ( !game.user.isGM ) {
      try {
        const uuid = await SOCKETS.socket.executeAsGM("createCoverEffectItem", data);
        doc = await fromUuid(uuid);
      } catch(e) {
        console.error(`${MODULE_ID}|CoverItem#_loadStorageDocument GM socket failure.`, e);
      }
    } else doc = await CONFIG.Item.documentClass.create(data);
    return doc;
  }

  /**
   * Create a storage document from scratch.
   * @returns {Item|object}
   */
  async _createStorageDocument() {
    // Add necessary settings for the active effect.
    const data = this.defaultCoverObjectData ?? this.constructor.newCoverObjectData;
    let doc;
    if ( !game.user.isGM ) {
      try {
        const uuid = await SOCKETS.socket.executeAsGM("createCoverEffectItem", data);
        doc = await fromUuid(uuid);
      } catch(e) {
        console.error(`${MODULE_ID}|CoverItem#_createStorageDocument GM socket failure.`, e);
      }
    } else doc = await CONFIG.Item.documentClass.create(data);
    return doc;

  }

  /**
   * Locate this cover effect item
   * @return {CoverEffect}
   */
  _findCoverEffect() {
    return game.items.find(item => item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.ID) === this.id
      && item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.LOCAL));
  }

  /**
   * Delete the stored item associated with this cover effect.
   */
  async _deleteStorageDocument() {
    if ( !this.document ) return;
    if ( !game.user.isGM ) {
      try {
        await SOCKETS.socket.executeAsGM("deleteDocument", this.document.id);
      } catch(e) {
        console.error(`${MODULE_ID}|CoverItem#_deleteStorageDocument GM socket failure.`, e);
      }
    } else await this.document.delete();
  }

  // ----- NOTE: Methods specific to cover effects ----- //

  /**
   * Internal method to add this cover effect to the token locally.
   * @param {Token} token
   * @returns {boolean} True if change was made.
   */
  _addToToken(token) {
    const actor = token.actor;
    if ( !actor ) return false;
    const item = actor.items.createDocument(this.localDocumentData);
    log(`CoverItem#_addToActorLocally|${actor.name} adding ${item.id} ${this.name}`);
    actor.items.set(item.id, item);
    return true;
  }

  /**
   * Internal method to remove this cover effect from the token.
   * @param {Token} token
   * @returns {boolean} True if change was made.
   */
  _removeFromToken(token) {
    const actor = token.actor;
    if ( !actor ) return false;

    // Remove the first instance found. (Should only be one present.)
    for ( const [key, item] of actor.items.entries() ) {
      if ( item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.ID) === this.id ) {
        log(`CoverItem#_removeFromToken|${actor.name} removing ${key} ${this.name}`);
        actor.items.delete(key);
        return true;
      }
    }
    return false;
  }

  // ----- NOTE: Static getters, setters, other properties ----- //

  /**
   * Data used to construct a new blank cover effect.
   * @type {object}
   */
  static get newCoverObjectData() {
    const data = CoverEffect.newCoverObjectData;
    data.type = "Item";
    return data;
  }


  // ----- NOTE: Static token methods ----- //

  /**
   * Get all documents for a give token/actor that could contain a cover effect.
   * Each document should be an object that has a "flags" property.
   * @param {Token} token
   * @returns {EmbeddedCollection|DocumentCollection|Map}
   */
  static _effectDocumentsOnToken(token) {
    const actor = token.actor;
    if ( !actor ) return new Map();
    return actor.items;
  }

  /**
   * Transition all cover documents in a scene, when updating versions.
   */
  static async transitionDocuments() {
    // Transition each cover item.
    const promises = [];
    for ( const coverEffect of this.coverObjectsMap.values() ) this._transitionDocument(coverEffect.document, promises)

    // Same for all tokens with cover effects.
    for ( const token of canvas.tokens.placeables ) {
      if ( !token.actor?.items ) continue;
      for ( const item of token.actor.items.values() ) this._transitionDocument(item, promises);
    }
    return Promise.allSettled(promises);

  }

  /**
   * Transition a single cover document.
   * @param {ActiveEffect} ae         The active effect document to update
   * @param {Promise<>[]} promises    Array to store promises to update the document
   */
  static _transitionDocument(item, promises = []) {
    const moduleVersion = game.modules.get(MODULE_ID).version;
    const id = item.getFlag(MODULE_ID, FLAGS.COVER_EFFECT.ID);
    if ( !id ) return;
    const coverEffect = this.coverObjectsMap.get(id);
    if ( !coverEffect ) return;

    // Only update if the saved version is older than current module version.
    const savedVersion = item.getFlag(MODULE_ID, FLAGS.VERSION);
    if ( savedVersion && !isNewerVersion(moduleVersion, savedVersion) ) return;

    // Update the default document data fields.
    const updateData = foundry.utils.mergeObject(
      coverEffect.defaultDocumentData,
      coverEffect.documentData,
      { insertKeys: false, insertValues: false, inplace: false });
    promises.push(item.update(updateData));
  }
}

/**
 * Specialized handling for cover effects (cover items) in pf2e.
 */
export class CoverItemPF2E extends CoverItem {}

/**
 * Specialized handling for cover effects (cover items) in sfrpg.
 */
export class CoverItemSFRPG extends CoverItem {

   /** @type {object|undefined} */
  static get newCoverObjectData() {
    const data = CoverItem.newCoverObjectData;
    data.type = "effect";
    return data;
  }
}