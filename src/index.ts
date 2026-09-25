export { DevTag, DevTagRoot } from './DevTag.js'
export type { DevTagProps, DevTagRootProps } from './DevTag.js'

export {
  DEFAULT_INTENSITY,
  DEFAULT_PATTERN_SIZE,
  HIERARCHY_SCORE_MARGIN,
  PATTERN_VERSION,
  clampIntensity,
  clampPatternSize,
  comparePatterns,
  createPatternPayload,
  generatePattern,
  generatePatternRgba,
  hashString,
  intensityToAlpha,
  isPathAncestor,
  pathDepth,
  rankByHierarchy,
  resolvePatternSize,
} from './pattern.js'
export type {
  ComponentDescriptor,
  PatternMatrix,
  PatternVersion,
  RankableMatch,
  SourceLocation,
} from './pattern.js'
