import React, { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error!} resetError={this.resetError} />;
      }

      return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-zinc-50" role="alert">
          <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border-4 border-zinc-50 text-center">
            <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-rose-600" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-black text-zinc-900 mb-2">Something went wrong</h2>
            <p className="text-zinc-500 mb-6">
              We're sorry, but an unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <details className="text-left mb-6 p-4 bg-zinc-100 rounded-xl text-xs">
                <summary className="font-bold text-zinc-700 cursor-pointer mb-2">Error Details</summary>
                <pre className="text-rose-600 overflow-auto max-h-40">{this.state.error.toString()}</pre>
              </details>
            )}
            <button
              onClick={this.resetError}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl font-black hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 mx-auto"
              aria-label="Reset the error and try again"
            >
              <RefreshCw className="w-5 h-5" aria-hidden="true" /> Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;