/**
 * The identity module's public business interface, split by domain.
 *
 * Users, groups, uploads and delivery coordination deliberately share one
 * SQLite file, one synchronous connection and one migration ladder (see
 * `store.mjs`): for a personal deployment that single writer and single
 * `BEGIN IMMEDIATE` transaction are the leverage worth keeping, and splitting
 * the tables back into four stores would move the complexity rather than
 * remove it. What the rest of the product sees does not inherit that width.
 * Each face below publishes only the operations its consumers call today:
 *
 * | face         | consumer |
 * | ---          | --- |
 * | `users`      | chat delivery, spaces groups, attachments, search |
 * | `groups`     | spaces group tools |
 * | `uploads`    | attachments upload lifecycle |
 * | `deliveries` | chat delivery coordination |
 *
 * The store itself stays inside this package; a consumer that needs a new
 * operation adds it to the face that owns the domain, never by reaching for
 * the store.
 *
 * @module @ourfairy/dsh-identity/src/interfaces
 */

/**
 * Build the domain faces over one business store.
 * @param store - the package's `IdentityStore`.
 * @returns the `users`, `groups`, `uploads` and `deliveries` faces.
 */
export function identityInterfaces(store) {
  return {
    users: {
      byShortId: shortId => store.userByShortId(shortId),
    },
    groups: {
      forMember: shortId => store.groupsForMember(shortId),
      create: (callerShortId, request) => store.createGroup(callerShortId, request),
      changeMember: (callerShortId, request) => store.changeGroupMember(callerShortId, request),
      owns: shortId => store.ownsGroup(shortId),
    },
    uploads: {
      read: uploadId => store.readUpload(uploadId),
      insert: row => store.insertUpload(row),
      update: (uploadId, changes) => store.updateUpload(uploadId, changes),
    },
    deliveries: {
      prepare: row => store.prepareDelivery(row),
      prepareFile: (deliveryId, index, prepared) => store.prepareDeliveryFile(deliveryId, index, prepared),
      pending: () => store.pendingDeliveries(),
      complete: (deliveryId, receipt) => store.completeDelivery(deliveryId, receipt),
    },
  }
}
