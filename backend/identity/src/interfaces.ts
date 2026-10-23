/**
 * The identity module's public business interface, split by domain.
 *
 * Users, groups, uploads and delivery coordination deliberately share one
 * SQLite file, one synchronous connection and one migration ladder (see
 * `store.ts`): for a personal deployment that single writer and single
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
import type {
  DeliveryInput,
  DeliveryReceipt,
  GroupMemberRequest,
  GroupRequest,
  IdentityStore,
  UploadChanges,
  UploadInput,
} from './store.js'

/**
 * Build the domain faces over one business store.
 * @param store - the package's `IdentityStore`.
 * @returns the `users`, `groups`, `uploads` and `deliveries` faces.
 */
export function identityInterfaces(store: IdentityStore) {
  return {
    users: {
      byShortId: (shortId: number) => store.userByShortId(shortId),
    },
    groups: {
      forMember: (shortId: number) => store.groupsForMember(shortId),
      create: (callerShortId: number, request: GroupRequest) => store.createGroup(callerShortId, request),
      changeMember: (callerShortId: number, request: GroupMemberRequest) => store.changeGroupMember(callerShortId, request),
      owns: (shortId: number) => store.ownsGroup(shortId),
    },
    uploads: {
      read: (uploadId: string) => store.readUpload(uploadId),
      insert: (row: UploadInput) => store.insertUpload(row),
      update: (uploadId: string, changes: UploadChanges) => store.updateUpload(uploadId, changes),
    },
    deliveries: {
      prepare: (row: DeliveryInput) => store.prepareDelivery(row),
      prepareFile: (deliveryId: string, index: number, prepared: unknown) => store.prepareDeliveryFile(deliveryId, index, prepared),
      pending: () => store.pendingDeliveries(),
      complete: (deliveryId: string, receipt: DeliveryReceipt) => store.completeDelivery(deliveryId, receipt),
    },
  }
}

/** The faces this package publishes to the rest of the product. */
export type IdentityFaces = ReturnType<typeof identityInterfaces>
