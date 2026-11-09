import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-sm glass rounded-2xl p-6 text-center">
          <h1 className="font-display text-xl font-semibold">This screen stopped working</h1>
          <p className="mt-2 text-muted">Your chats and credits are saved. Reload the page to continue.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full btn-primary px-5 py-2.5 font-semibold text-white"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
