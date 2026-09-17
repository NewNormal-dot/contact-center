import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * There was no error boundary anywhere in the tree, so a single render-time
 * exception in any dashboard unmounted the whole application and left the
 * user staring at a blank white page with no message and nothing to click.
 *
 * This catches the render, shows what happened and offers the two things
 * that actually help: reload, or go back to the login screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // There is no client-side error sink, so at minimum make it findable in
    // the browser console with its component stack attached.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-gray-900/80 border border-red-500/30 rounded-2xl p-8 space-y-4">
          <h1 className="text-xl font-black uppercase tracking-tight text-red-400">
            Алдаа гарлаа
          </h1>
          <p className="text-sm text-gray-300">
            Хуудсыг харуулахад алдаа гарлаа. Дахин ачаална уу. Хэрэв давтагдвал
            админд хандаж, доорх мессежийг дамжуулна уу.
          </p>
          <pre className="text-[11px] text-gray-500 bg-black/50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 font-bold transition-colors"
            >
              Дахин ачаалах
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="flex-1 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 font-bold transition-colors"
            >
              Нүүр хуудас
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
