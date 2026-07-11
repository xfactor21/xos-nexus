import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Icon from '../design-system/icons/Icon';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Root error boundary — added after a production bug report: a failed
 * sign-in could (depending on render path) throw during render with no
 * boundary above it, which React handles by unmounting the entire tree,
 * leaving a blank black screen (the body background is var(--void),
 * effectively black) with only a minified error code in the console.
 *
 * This won't fix a bug's root cause, but it guarantees the failure mode is
 * always a recoverable, on-brand message instead of a silent blank screen —
 * "should just show a normal message, not crash the tree" holds for
 * whatever throws next, not just the one bug we found and fixed this pass.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div id="authGate">
          <div className="logo">
            xOS <em>//</em> neXus
          </div>
          <div className="tag">
            <Icon name="xai" size={13} glow="magenta" /> SOMETHING GLITCHED
          </div>
          <div className="authcard">
            <div className="autherr">
              The Core hit an unexpected error and had to stop. This has been logged — reloading should recover cleanly.
            </div>
            <button className="bigbtn" onClick={() => window.location.reload()}>
              RELOAD <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
