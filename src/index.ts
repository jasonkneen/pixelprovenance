export { DevTag, DevTagRoot } from './DevTag.js'
export type { DevTagProps, DevTagRootProps } from './DevTag.js'

export {
  DEFAULT_INTENSITY,
  DEFAULT_PATTERN_SIZE,
  HIERARCHY_SCORE_MARGIN,
  clampIntensity,
  clampPatternSize,
  comparePatterns,
  createPatternPayload,
  generatePattern,
  generatePatternRgba,
  hashString,
  isPathAncestor,
  pathDepth,
  rankByHierarchy,
  resolvePatternSize,
} from './pattern.js'
export type {
  ComponentDescriptor,
  PatternMatrix,
  RankableMatch,
  SourceLocation,
} from './pattern.js'
