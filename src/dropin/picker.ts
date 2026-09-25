import { resolveTarget } from './identity.js'

export function startPicker(options: {
  onPick: (element: HTMLElement) => void
  onCancel?: () => void
}): () => void {
  const highlight = document.createElement('div')
  highlight.setAttribute('data-pp-toolbar', '')
  highlight.setAttribute('data-pp-highlight', '')
  document.documentElement.append(highlight)

  function place(element: HTMLElement | null) {
    if (!element) {
      highlight.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    highlight.style.display = 'block'
    highlight.style.left = `${rect.left}px`
    highlight.style.top = `${rect.top}px`
    highlight.style.width = `${rect.width}px`
    highlight.style.height = `${rect.height}px`
  }

  function onMove(event: MouseEvent) {
    place(resolveTarget(event.target))
  }

  function onClick(event: MouseEvent) {
    const target = resolveTarget(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    stop()
    options.onPick(target)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    stop()
    options.onCancel?.()
  }

  function stop() {
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey)
    highlight.remove()
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey)
  return stop
}
