import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, LogOut, User, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

interface AuthButtonProps {
    variant?: 'full' | 'compact';
}

export const AuthButton: React.FC<AuthButtonProps> = ({ variant = 'full' }) => {
    const { user, isLoading, signInWithGoogle, signOut } = useAuth();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };

        if (showMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10">
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-ink-400 animate-spin" />
            </div>
        );
    }

    if (user) {
        // Signed in state with dropdown menu
        return (
            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="flex items-center space-x-1.5 sm:space-x-2 h-9 sm:h-10 px-2 sm:px-3 rounded-full bg-sand-100 hover:bg-sand-200 transition-colors border border-sand-200"
                    title={`Signed in as ${user.displayName}`}
                >
                    {user.photoURL ? (
                        <img
                            src={user.photoURL}
                            alt={user.displayName || 'User'}
                            className="w-5 h-5 sm:w-6 sm:h-6 rounded-full"
                        />
                    ) : (
                        <User className="w-4 h-4 sm:w-5 sm:h-5 text-ink-600" />
                    )}
                    {variant === 'full' && (
                        <span className="text-xs sm:text-sm font-medium text-ink-700 hidden sm:block">
                            {user.displayName?.split(' ')[0]}
                        </span>
                    )}
                </button>

                {/* Dropdown Menu */}
                {showMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-lg border border-sand-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="px-4 py-2 border-b border-sand-100">
                            <p className="text-sm font-medium text-ink-800 truncate">{user.displayName}</p>
                            <p className="text-xs text-ink-400 truncate">{user.email}</p>
                        </div>
                        <button
                            onClick={() => {
                                signOut();
                                setShowMenu(false);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-red-50 transition-colors group"
                        >
                            <LogOut className="w-4 h-4 text-ink-400 group-hover:text-red-500" />
                            <span className="text-sm text-ink-600 group-hover:text-red-600">Sign out</span>
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Signed out state
    return (
        <Button
            onClick={signInWithGoogle}
            variant="secondary"
            className="rounded-full h-9 sm:h-10 px-3 sm:px-4 bg-white border border-sand-200 hover:bg-sand-50 shadow-sm"
        >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" viewBox="0 0 24 24">
                <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
            </svg>
            <span className="text-xs sm:text-sm font-medium text-ink-700">Sign in</span>
        </Button>
    );
};
