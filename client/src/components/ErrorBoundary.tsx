import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: String(error?.message || error) };
  }

  componentDidCatch(error: any, info: any) {
    try { console.error('[ErrorBoundary]', error, info); } catch {};
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-900/5 border border-red-900/10 rounded-md">
          <div className="text-sm text-red-400 font-semibold">Something went wrong rendering this section.</div>
          {this.state.message && <div className="text-xs text-red-300 mt-2">{this.state.message}</div>}
        </div>
      );
    }
    return this.props.children as any;
  }
}
