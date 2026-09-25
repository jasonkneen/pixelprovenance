import { registerWithCluso, type ClusoPluginOptions } from './index.js'

// IIFE entry: <script src="pixelprovenance-cluso.js" data-pp-page="pricing"></script>
// works before or after cluso-inspector.js.
const script = typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement
  ? document.currentScript
  : null
const data = script?.dataset ?? {}
const options: ClusoPluginOptions = {
  ...(data.ppPage ? { pageId: data.ppPage } : {}),
  ...(data.ppSignals ? { signals: data.ppSignals !== 'false' } : {}),
  ...(data.ppIntensity ? { intensity: Number(data.ppIntensity) } : {}),
  ...(data.ppPatternSize ? { patternSize: Number(data.ppPatternSize) } : {}),
  ...(data.ppRegistry ? { registry: data.ppRegistry !== 'false' } : {}),
}
if (typeof window !== 'undefined') registerWithCluso(options)

export { pixelprovenancePlugin, registerWithCluso } from './index.js'
