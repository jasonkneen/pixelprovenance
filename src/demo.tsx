import { createRoot } from 'react-dom/client'
import { DevTagRoot, DevTag } from './DevTag'

function Demo() {
  return (
    <DevTagRoot pageId="BILLING_PAGE" intensity={0.15}>
      <div className="container">
        <h1>DevTag PoC</h1>
        <p className="subtitle">
          Component identification from screenshots
        </p>

        <DevTag id="metadata-panel" type="panel" intensity={0.15}>
          <div className="card">
            <h2>Component Tagging</h2>
            <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px' }}>
              Each component has invisible identification markers. Screenshots can be
              decoded to show exact component paths and source locations.
            </p>
            <dl className="meta">
              <dt>Page</dt>
              <dd>BILLING_PAGE</dd>
              <dt>Panel</dt>
              <dd>metadata-panel</dd>
            </dl>
          </div>
        </DevTag>

        <DevTag id="actions-panel" type="panel" intensity={0.15}>
          <div className="card">
            <h2>Nested Components</h2>
            <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px' }}>
              Each button has its own identification marker with full path.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <DevTag id="save-btn" type="button" intensity={0.15}>
                <button className="btn">Save Changes</button>
              </DevTag>

              <DevTag id="cancel-btn" type="button" intensity={0.15}>
                <button className="btn btn-secondary">Cancel</button>
              </DevTag>

              <DevTag id="delete-btn" type="button" intensity={0.15}>
                <button className="btn btn-danger">Delete</button>
              </DevTag>
            </div>
          </div>
        </DevTag>

        <DevTag id="decode-panel" type="panel" intensity={0.15}>
          <div className="card">
            <h2>How It Works</h2>
            <div className="instructions">
              <p>Screenshot → Decode:</p>
              <pre>{`npm run decode screenshot.png

Output:
- Component paths
- Source file locations
- Line numbers`}</pre>
              <p>Works with Retina displays and any screenshot tool.</p>
            </div>
          </div>
        </DevTag>
      </div>
    </DevTagRoot>
  )
}

createRoot(document.getElementById('root')!).render(<Demo />)
