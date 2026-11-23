import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { staffSignedIn, setStaffSignedIn } from '../api';

const AuthContext = createContext(null);

// started when this file loads (in parallel with the rest of the app), used by the first check below
let earlyMe = null;
try {
  if (staffSignedIn() || localStorage.getItem('pos_token')) {
    earlyMe = api.get('/auth/me');
    earlyMe.catch(() => {}); // handled in AuthProvider
  }
} catch {
  /* private mode */
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!earlyMe && !staffSignedIn()) return setLoading(false);
    (earlyMe || api.get('/auth/me'))
      .then((response) => {
        setStaffSignedIn(true);
        setUser(response.data);
      })
      .catch(() => setStaffSignedIn(false))
      .finally(() => setLoading(false));
  }, []);

  // the server set the session cookie; the token in the answer is for API clients and isn't kept here
  const saveSession = ({ user }) => {
    setStaffSignedIn(true);
    setUser(user);
  };

  const login = async (email, password) => saveSession((await api.post('/auth/login', { email, password })).data);
  const setup = async (data) => saveSession((await api.post('/auth/setup', data)).data);
  const loginWithGoogle = async (credential) => saveSession((await api.post('/auth/oauth/google', { credential })).data);
  const logout = () => {
    api.post('/auth/logout', {}).catch(() => {}); // ends the session on the server too
    setStaffSignedIn(false);
    setUser(null);
  };
  // POST /auth/password: also signs out my other devices, so a fresh token comes back
  const changePassword = async (current, next) => {
    const response = await api.post('/auth/password', { current, next });
    saveSession(response.data);
    return response.data.message;
  };
  const refresh = useCallback(() => api.get('/auth/me').then((response) => setUser(response.data)).catch(() => {}), []);
  useEffect(() => {
    window.addEventListener('staff:change-password', refresh);
    return () => window.removeEventListener('staff:change-password', refresh);
  }, [refresh]);
  // owner: everything, incl. admins and money settings · admin: everything else · moderator: the areas they were given
  const isOwner = user?.role === 'owner';
  const isAdmin = isOwner || user?.role === 'admin'; // the whole panel (team, settings, security log)
  const can = (area) => isAdmin || !!user?.perms?.includes(area);

  return (
    <AuthContext.Provider value={{ user, loading, login, setup, loginWithGoogle, logout, changePassword, can, isAdmin, isOwner }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
