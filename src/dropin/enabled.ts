const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isDropinEnabled(options: {
  hostname: string
  flag?: string
}): boolean {
  if (options.flag === 'true') return true
  if (options.flag === 'false') return false
  return LOOPBACK.has(options.hostname)
}
