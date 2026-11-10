import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('pos_token')) return setLoading(false);
    api
      .get('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem('pos_token'))
      .finally(() => setLoading(false));
  }, []);

  const saveSession = ({ token, user }) => {
    localStorage.setItem('pos_token', token);
    setUser(user);
  };

  const login = async (email, password) => saveSession((await api.post('/auth/login', { email, password })).data);
  const setup = async (data) => saveSession((await api.post('/auth/setup', data)).data);
  const loginWithGoogle = async (credential) => saveSession((await api.post('/auth/oauth/google', { credential })).data);
  const logout = () => {
    localStorage.removeItem('pos_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, setup, loginWithGoogle, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
