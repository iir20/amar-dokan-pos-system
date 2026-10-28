
import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100">
             <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                 <AlertTriangle size={32} />
             </div>
             <h1 className="text-2xl font-bold text-gray-800 mb-2">Something went wrong</h1>
             <p className="text-gray-500 mb-6 text-sm">
               The application encountered an unexpected error. Please try reloading.
             </p>
             
             {this.state.error && (
                 <div className="bg-red-50 p-3 rounded-lg text-left mb-6 overflow-auto max-h-32 border border-red-100">
                     <p className="text-xs font-bold text-red-800 mb-1">Error Details:</p>
                     <code className="text-xs text-red-600 font-mono break-all">
                         {this.state.error.message}
                     </code>
                 </div>
             )}

             <div className="space-y-3">
                 <button
                   onClick={() => window.location.reload()}
                   className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                 >
                   <RefreshCw size={20} /> Reload Application
                 </button>
                 <button
                   onClick={() => {
                       // Keep session and guest-order references intact; reloading must not erase user data.
                       window.location.reload();
                   }}
                   className="w-full bg-white text-gray-500 py-3 rounded-xl font-medium hover:bg-gray-50 border border-gray-200 transition flex items-center justify-center gap-2"
                 >
                   <Home size={18} /> Clear Cache & Reset
                 </button>
             </div>
          </div>
          <p className="mt-8 text-xs text-gray-400">Amar Dokan POS System v1.0.0</p>
        </div>
      );
    }

    // Fix: Explicitly cast this to any to access props due to TS inheritance issue in some environments
    return (this as any).props.children;
  }
}
