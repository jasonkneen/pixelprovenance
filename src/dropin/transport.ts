import type { DeliveryResult, SelectionPackage } from './types.js'

export const PACKAGE_EVENT = 'pixelprovenance:package'

type PackageListener = (pkg: SelectionPackage) => void

const listeners = new Set<PackageListener>()

export interface DeliverOptions {
  endpoint?: string
  fetch?: typeof fetch
}

async function deliverPackage(
  pkg: SelectionPackage,
  options: DeliverOptions = {},
): Promise<DeliveryResult> {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PACKAGE_EVENT, { detail: pkg }))
  }
  for (const listener of listeners) listener(pkg)

  if (!options.endpoint) return { ok: true }

  const fetchImpl = options.fetch ?? globalThis.fetch
  try {
    const response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pkg),
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

deliverPackage.subscribe = (listener: PackageListener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export { deliverPackage }
