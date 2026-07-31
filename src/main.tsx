import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './demo.js'
import './demo.css'

const root = document.getElementById('root')
if (!root) throw new Error('Demo root element was not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
