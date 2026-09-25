export interface ToolbarHandles {
  root: HTMLElement
  setStatus: (message: string) => void
  setMode: (mode: 'idle' | 'select' | 'crop') => void
}

const STYLE_ID = 'pixelprovenance-dropin-style'

const CSS_TEXT = `
[data-pp-toolbar][data-pp-toolbar-root] {
  position: fixed;
  z-index: 2147483646;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  color: #171927;
  background: #fffdf9;
  border: 1px solid #d7d2c8;
  box-shadow: 0 8px 24px rgba(23, 25, 39, 0.12);
  font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;
}
[data-pp-toolbar][data-pp-toolbar-root] button {
  appearance: none;
  margin: 0;
  padding: 7px 10px;
  color: #171927;
  background: #f5f2eb;
  border: 1px solid #d7d2c8;
  cursor: pointer;
  font: inherit;
}
[data-pp-toolbar][data-pp-toolbar-root] button[data-pp-active="true"] {
  color: #fffdf9;
  background: #5265ff;
  border-color: #5265ff;
}
[data-pp-toolbar][data-pp-toolbar-root] [data-pp-status] {
  max-width: 220px;
  color: #77766f;
  font-size: 11px;
}
[data-pp-highlight] {
  position: fixed;
  z-index: 2147483001;
  pointer-events: none;
  border: 1px solid #5265ff;
  background: rgba(82, 101, 255, 0.08);
  box-sizing: border-box;
}
`

export function ensureToolbarStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS_TEXT
  document.head.append(style)
}

export function renderToolbar(options: {
  onSelect: () => void
  onCrop: () => void
  onCancel: () => void
}): ToolbarHandles {
  ensureToolbarStyles()
  const root = document.createElement('div')
  root.setAttribute('data-pp-toolbar', '')
  root.setAttribute('data-pp-toolbar-root', '')
  root.innerHTML = `
    <button type="button" data-pp-action="select">Select</button>
    <button type="button" data-pp-action="crop">Crop</button>
    <button type="button" data-pp-action="cancel">Cancel</button>
    <span data-pp-status>Ready</span>
  `
  const select = root.querySelector('[data-pp-action="select"]')
  const crop = root.querySelector('[data-pp-action="crop"]')
  const cancel = root.querySelector('[data-pp-action="cancel"]')
  const status = root.querySelector('[data-pp-status]')
  select?.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onSelect()
  })
  crop?.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onCrop()
  })
  cancel?.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onCancel()
  })

  function setMode(mode: 'idle' | 'select' | 'crop') {
    select?.setAttribute('data-pp-active', String(mode === 'select'))
    crop?.setAttribute('data-pp-active', String(mode === 'crop'))
  }

  function setStatus(message: string) {
    if (status) status.textContent = message
  }

  setMode('idle')
  document.documentElement.append(root)
  return { root, setStatus, setMode }
}

export function removeToolbarStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
