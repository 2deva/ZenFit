import React from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AppContextProvider } from './contexts/AppContext';
import { LiveSessionContextProvider } from './contexts/LiveSessionContext';
import { GlobalEffects } from './components/GlobalEffects';
import { AppLayout } from './components/AppLayout';

function App() {
    return (
        <AppContextProvider>
            <LiveSessionContextProvider>
                <GlobalEffects />
                <AppLayout />
                <Analytics />
            </LiveSessionContextProvider>
        </AppContextProvider>
    );
}

export default App;
