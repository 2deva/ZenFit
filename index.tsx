import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { initializeMonitoring } from './services/monitoringService';
import { flushOpik } from './services/opikGemini';

// Initialize monitoring (Sentry if configured, otherwise console logging)
initializeMonitoring().catch(console.error);

// Flush Opik traces on page unload so they are sent before exit
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushOpik().catch(() => {});
  });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOpik().catch(() => {});
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);