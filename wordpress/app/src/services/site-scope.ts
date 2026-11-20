import type { Db } from '../db/client'
import { findSelection } from '../db/queries/selections'
import type { SiteRef } from '../qinto/sites'

/** `onError` turns it into a 409. */
export class SiteLockedError extends Error {
  constructor() {
    super('this install is locked to its selected site')
    this.name = 'SiteLockedError'
  }
}

/** Once a site is selected, the install may act only on it: a grant covers every team its user approved. */
export const assertInScope = async (db: Db, registrationId: string, ref?: SiteRef): Promise<void> => {
  const selection = await findSelection(db, registrationId)
  if (selection === undefined) {
    return
  }

  if (ref === undefined || ref.teamId !== selection.teamId || ref.domainId !== selection.domainId) {
    throw new SiteLockedError()
  }
}
