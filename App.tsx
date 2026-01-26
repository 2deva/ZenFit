import React from 'react';
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
            </LiveSessionContextProvider>
        </AppContextProvider>
    );
}

export default App;
