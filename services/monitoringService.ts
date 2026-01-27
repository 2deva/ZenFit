/**
 * Monitoring Service for ZenFit
 * 
 * Provides error tracking, performance monitoring, and analytics.
 * Supports Sentry integration (optional) and console logging fallback.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ErrorContext {
  userId?: string;
  userAgent?: string;
  url?: string;
  timestamp?: number;
  [key: string]: any;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
}

// ============================================================================
// SENTRY INTEGRATION (OPTIONAL)
// ============================================================================

let sentryInitialized = false;

/**
 * Initialize Sentry error tracking (optional)
 * Only initializes if VITE_SENTRY_DSN is provided
 */
export async function initializeMonitoring() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  
  if (!sentryDsn) {
    console.log('📊 Monitoring: Sentry not configured. Using console logging.');
    return;
  }

  try {
    // Dynamic import to avoid breaking if Sentry is not installed
    const Sentry = await import('@sentry/react');
    
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE || 'development',
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Suppress errors if Sentry is blocked by CSP or ad blockers
      beforeSend(event, hint) {
        // Filter out sensitive data
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers?.['Authorization'];
        }
        return event;
      },
      // Handle transport errors gracefully
      transportOptions: {
        // Don't throw errors if Sentry requests fail
      },
    });

    sentryInitialized = true;
    console.log('✅ Monitoring: Sentry initialized');
  } catch (error) {
    // Silently handle Sentry initialization failures (CSP blocks, ad blockers, etc.)
    // The app should continue to work without Sentry
    if (import.meta.env.MODE === 'development') {
      console.warn('⚠️ Monitoring: Failed to initialize Sentry:', error);
    }
    console.log('📊 Monitoring: Using console logging fallback');
  }
}

// ============================================================================
// ERROR TRACKING
// ============================================================================

/**
 * Track an error with optional context
 */
export async function trackError(
  error: Error | string,
  context?: ErrorContext
): Promise<void> {
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  const errorContext: ErrorContext = {
    ...context,
    timestamp: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent,
  };

  // Log to console (always)
  console.error('🚨 Error tracked:', errorObj, errorContext);

  // Send to Sentry if initialized
  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.captureException(errorObj, {
        contexts: {
          custom: errorContext,
        },
        tags: {
          component: context?.component || 'unknown',
        },
      });
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
      // Don't spam console in production
      if (import.meta.env.MODE === 'development') {
        console.warn('Failed to send error to Sentry:', e);
      }
    }
  }

  // Optional: Send to custom analytics endpoint
  // await sendToAnalytics('error', { error: errorObj.message, ...errorContext });
}

/**
 * Track a message/event (non-error)
 */
export async function trackEvent(
  name: string,
  properties?: Record<string, any>
): Promise<void> {
  console.log(`📊 Event: ${name}`, properties);

  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.captureMessage(name, {
        level: 'info',
        extra: properties,
      });
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
    }
  }
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

/**
 * Track a performance metric
 */
export async function trackPerformance(metric: PerformanceMetric): Promise<void> {
  console.log(`⚡ Performance: ${metric.name} = ${metric.value}${metric.unit || ''}`, metric.tags);

  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.metrics.distribution(metric.name, metric.value, {
        unit: metric.unit || 'none',
        tags: metric.tags || {},
      });
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
    }
  }
}

/**
 * Measure and track function execution time
 */
export function measurePerformance<T>(
  name: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const start = performance.now();
  
  return Promise.resolve(fn()).then(
    (result) => {
      const duration = performance.now() - start;
      trackPerformance({
        name: `performance.${name}`,
        value: duration,
        unit: 'millisecond',
      });
      return result;
    },
    (error) => {
      const duration = performance.now() - start;
      trackPerformance({
        name: `performance.${name}.error`,
        value: duration,
        unit: 'millisecond',
        tags: { error: error.message },
      });
      throw error;
    }
  );
}

// ============================================================================
// SECURITY MONITORING
// ============================================================================

/**
 * Track security-related events
 */
export async function trackSecurityEvent(
  event: string,
  details?: Record<string, any>
): Promise<void> {
  console.warn(`🔒 Security Event: ${event}`, details);

  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.captureMessage(`Security: ${event}`, {
        level: 'warning',
        tags: {
          category: 'security',
          event,
        },
        extra: details,
      });
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
    }
  }
}

// ============================================================================
// USER IDENTIFICATION
// ============================================================================

/**
 * Set user context for error tracking
 */
export async function setUserContext(userId: string, email?: string): Promise<void> {
  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.setUser({
        id: userId,
        email,
      });
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
    }
  }
}

/**
 * Clear user context
 */
export async function clearUserContext(): Promise<void> {
  if (sentryInitialized) {
    try {
      const Sentry = await import('@sentry/react');
      Sentry.setUser(null);
    } catch (e) {
      // Silently handle Sentry failures (CSP blocks, network issues, etc.)
    }
  }
}
