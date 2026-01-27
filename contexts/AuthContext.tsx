import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
    User,
    signInWithPopup,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    getAdditionalUserInfo
} from 'firebase/auth';
import { auth, googleProvider } from '../firebaseConfig';

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isNewUser: boolean;
    accessToken: string | null;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isNewUser, setIsNewUser] = useState(false);
    const [accessToken, setAccessToken] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                // Get the access token for Google APIs (Calendar, Fit)
                try {
                    const token = await firebaseUser.getIdToken();
                    setAccessToken(token);
                } catch (e) {
                    console.warn('Failed to get access token', e);
                }
            } else {
                setAccessToken(null);
            }

            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signInWithGoogle = async () => {
        try {
            setIsLoading(true);
            const result = await signInWithPopup(auth, googleProvider);

            // Check if this is a new user
            const additionalInfo = getAdditionalUserInfo(result);
            setIsNewUser(additionalInfo?.isNewUser ?? false);

            // Get OAuth access token for Google APIs
            // @ts-ignore - credential type includes accessToken
            const credential = result.credential;
            if (credential) {
                // Store the OAuth access token for Calendar/Fit APIs
                // Note: This is different from Firebase ID token
                localStorage.setItem('google_oauth_token', (credential as any).accessToken || '');
            }

        } catch (error: any) {
            console.error('Sign in failed:', error);
            
            // Provide helpful error message for unauthorized domain
            if (error?.code === 'auth/unauthorized-domain') {
                const currentDomain = window.location.hostname;
                const errorMessage = `Authentication Error: This domain (${currentDomain}) is not authorized in Firebase. Please add it to Firebase Console → Authentication → Settings → Authorized domains.`;
                console.error(errorMessage);
                alert(errorMessage);
            } else {
                // For other errors, show a generic message
                const errorMessage = error?.message || 'Failed to sign in. Please try again.';
                console.error('Sign in error:', errorMessage);
                alert(errorMessage);
            }
            
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const signOut = async () => {
        try {
            await firebaseSignOut(auth);
            localStorage.removeItem('google_oauth_token');
            setIsNewUser(false);
        } catch (error) {
            console.error('Sign out failed:', error);
            throw error;
        }
    };

    const value: AuthContextType = {
        user,
        isLoading,
        isNewUser,
        accessToken,
        signInWithGoogle,
        signOut
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
