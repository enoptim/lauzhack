import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  children: ReactNode;
  /** The part that failed, in words: "3D building", "assistant". */
  what: string;
  /** A new value clears the error, e.g. new plans in the page address. */
  resetKey?: string;
  /** A custom fallback; `reset` tries again. */
  fallback?: (reset: () => void) => ReactNode;
};

/**
 * Keeps a failure in one part of the twin (the 3D view without WebGL, one bad message) inside that part:
 * the top bar, the assistant and the other view keep working.
 */
export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.what} failed`, error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(() => this.setState({ error: null }));
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6 text-sm">
        <p className="font-medium">The {this.props.what} stopped working.</p>
        <p className="max-w-prose text-muted-foreground">
          {this.props.what === '3D building'
            ? 'This browser may have 3D graphics (WebGL) turned off. Results and the assistant still work.'
            : 'The rest of the twin still works.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
