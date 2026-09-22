import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LayoutDashboard, RotateCcw, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { actions } from '@/lib/store'

interface Props {
  children: ReactNode
  /** Page-level boundaries keep the sidebar usable and offer to go back to the dashboard. */
  scope: 'app' | 'page'
}

interface State {
  error: Error | null
}

/** Shows a recoverable error screen instead of a blank window, and records the error. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      api().reportError(`${error.name}: ${error.message}\n${info.componentStack ?? ''}`)
    } catch {
      // The bridge may be unavailable; nothing else to do.
    }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={this.props.scope === 'app' ? 'splash' : 'page'}>
        <div className="card" style={{ maxWidth: 520, margin: '40px auto', padding: 24 }}>
          <div className="row" style={{ gap: 12, marginBottom: 10 }}>
            <div className="modal-icon danger">
              <TriangleAlert size={19} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>Something went wrong</h2>
              <div className="faint" style={{ fontSize: 12.5 }}>
                The automation keeps running in the background. The error was saved to the log.
              </div>
            </div>
          </div>
          <pre className="mono selectable" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--danger-text)', margin: '12px 0 16px' }}>
            {error.message}
          </pre>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {this.props.scope === 'page' && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  actions.navigate('dashboard')
                  this.setState({ error: null })
                }}
              >
                <LayoutDashboard size={15} /> Back to dashboard
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} /> Reload interface
            </button>
          </div>
        </div>
      </div>
    )
  }
}
