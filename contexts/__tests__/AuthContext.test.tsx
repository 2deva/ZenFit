import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../AuthContext';
import { STORAGE_KEYS } from '../../constants/app';
const firebase = vi.hoisted(() => ({ listener: null as any, unsubscribe: vi.fn(), popup: vi.fn(), signOut: vi.fn(), additional: vi.fn(), credential: vi.fn() }));
vi.mock('../../firebaseConfig', () => ({ auth: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: (_auth: unknown, callback: unknown) => { firebase.listener = callback; return firebase.unsubscribe; }, signInWithPopup: firebase.popup, signOut: firebase.signOut, getAdditionalUserInfo: firebase.additional, GoogleAuthProvider: { credentialFromResult: firebase.credential } }));
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { vi.clearAllMocks(); firebase.additional.mockReturnValue({ isNewUser: true }); firebase.credential.mockReturnValue({ accessToken: 'google-token' }); });

describe('authentication state and token lifecycle', () => {
  it('loads sign-in tokens and clears them on sign-out', async () => {
    const { result, unmount } = renderHook(useAuth, { wrapper });
    expect(result.current.isLoading).toBe(true);
    await act(async () => firebase.listener({ uid: 'alice', getIdToken: async () => 'alice-token' }));
    expect(result.current.accessToken).toBe('alice-token'); expect(result.current.isLoading).toBe(false);
    await act(async () => firebase.listener(null)); expect(result.current.user).toBeNull(); expect(result.current.accessToken).toBeNull();
    unmount(); expect(firebase.unsubscribe).toHaveBeenCalledOnce();
  });
  it('does not let an earlier token request overwrite a later identity', async () => {
    let finish!: (token: string) => void; const oldToken = new Promise<string>(resolve => { finish = resolve; });
    const { result } = renderHook(useAuth, { wrapper });
    let earlier!: Promise<void>;
    act(() => { earlier = firebase.listener({ uid: 'alice', getIdToken: () => oldToken }); });
    await act(async () => firebase.listener({ uid: 'bob', getIdToken: async () => 'bob-token' }));
    await act(async () => { finish('alice-token'); await earlier; });
    expect(result.current.user?.uid).toBe('bob'); expect(result.current.accessToken).toBe('bob-token');
  });
  it('does not retain a previous token when refresh fails', async () => {
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => firebase.listener({ uid: 'alice', getIdToken: async () => 'old-token' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => firebase.listener({ uid: 'alice', getIdToken: async () => { throw new Error('expired'); } }));
    expect(result.current.accessToken).toBeNull();
  });
  it('stores provider consent tokens on sign-in and removes them on sign-out', async () => {
    firebase.popup.mockResolvedValue({ user: {} }); firebase.signOut.mockResolvedValue(undefined);
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => result.current.signInWithGoogle());
    expect(result.current.isNewUser).toBe(true); expect(localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN)).toBe('google-token');
    await act(async () => result.current.signOut()); expect(localStorage.getItem(STORAGE_KEYS.FITNESS_TOKEN)).toBeNull();
  });
  it('reports sign-in failure without leaving the UI loading', async () => {
    firebase.popup.mockRejectedValue({ code: 'auth/unauthorized-domain' }); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => { await expect(result.current.signInWithGoogle()).rejects.toMatchObject({ code: 'auth/unauthorized-domain' }); });
    expect(result.current.isLoading).toBe(false); expect(window.alert).toHaveBeenCalled();
  });
});
