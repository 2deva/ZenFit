
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { trackError } from '../services/monitoringService';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  scope?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught error in ${this.props.scope || 'UI'}:`, error, errorInfo);
    
    // Track error with monitoring service
    trackError(error, {
      component: this.props.scope || 'ErrorBoundary',
      errorInfo: errorInfo.componentStack,
      errorBoundary: true,
    });
  }

  public resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300 max-w-sm mx-auto my-2">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mb-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <h3 className="text-sm font-bold text-red-900 mb-1">Component Error</h3>
          <p className="text-xs text-red-600 mb-3">
             {this.props.scope ? `Couldn't render ${this.props.scope}.` : "Something went wrong with this element."}
          </p>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={this.resetError}
            className="h-8 text-xs bg-white border border-red-100 text-red-600 hover:bg-red-50"
          >
            <RefreshCcw className="w-3 h-3 mr-1.5" />
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
