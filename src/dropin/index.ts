export {
  autoMount,
  configFromScript,
  mount,
  unmount,
} from './mount.js'
export type { MountOptions, PixelProvenanceApi } from './mount.js'
export { createSelectionPackage } from './package.js'
export { deliverPackage, PACKAGE_EVENT } from './transport.js'
export type { DeliveryResult, SelectionPackage, SelectionRect } from './types.js'
export { collectCodebook, parseSource, resolveIdentity, resolveTarget } from './identity.js'

import { autoMount } from './mount.js'

if (typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement) {
  autoMount(document.currentScript)
}
