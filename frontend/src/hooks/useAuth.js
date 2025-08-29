import { useState, useEffect, useCallback, useContext, createContext } from 'react';
import { toast } from 'react-toastify';
import api from '../services/api';
import { STORAGE_KEYS, USER_TYPES } from '../utils/constants';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);

  const clearAuthData = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    setPermissions([]);
    setSessionInfo(null);
    setError(null);
    
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
    
    delete api.defaults.headers.common['Authorization'];
  }, []);

  const setAuthData = useCallback((authResponse) => {
    const { user: userData, tokens, sessionId } = authResponse;
    
    setUser(userData);
    setIsAuthenticated(true);
    setPermissions(userData.permissions || []);
    setSessionInfo({
      sessionId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      loginTime: new Date()
    });
    
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(userData));
    
    api.defaults.headers.common['Authorization'] = `Bearer ${tokens.accessToken}`;
    
    if (sessionId) {
      api.defaults.headers.common['X-Session-ID'] = sessionId;
    }
  }, []);

  const refreshToken = useCallback(async () => {
    try {
      const refreshTokenValue = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      
      if (!refreshTokenValue) {
        throw new Error('No refresh token available');
      }

      const response = await api.post('/auth/refresh', {
        refreshToken: refreshTokenValue
      });

      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      
      localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, newRefreshToken);
      
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
      
      setSessionInfo(prev => ({
        ...prev,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }));

      return accessToken;
    } catch (error) {
      console.error('Token refresh failed:', error);
      await logout();
      throw error;
    }
  }, []);

  const login = useCallback(async (credentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.post('/auth/login', credentials);
      
      if (response.data.success) {
        setAuthData(response.data.data);
        toast.success('Login successful');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Login failed';
      setError(errorMessage);
      toast.error(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [setAuthData]);

  const walletLogin = useCallback(async (walletData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.post('/auth/wallet-login', walletData);
      
      if (response.data.success) {
        setAuthData(response.data.data);
        toast.success('Wallet login successful');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Wallet login failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Wallet login failed';
      setError(errorMessage);
      toast.error(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [setAuthData]);

  const register = useCallback(async (registrationData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.post('/auth/register', registrationData);
      
      if (response.data.success) {
        toast.success('Registration successful. Please check your email to verify your account.');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Registration failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Registration failed';
      setError(errorMessage);
      toast.error(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
      toast.success('Logout successful');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuthData();
    }
  }, [clearAuthData]);

  const updateProfile = useCallback(async (profileData) => {
    try {
      const response = await api.put('/auth/profile', profileData);
      
      if (response.data.success) {
        const updatedUser = { ...user, ...response.data.data.personalInfo };
        setUser(updatedUser);
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(updatedUser));
        toast.success('Profile updated successfully');
        return updatedUser;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to update profile';
      toast.error(errorMessage);
      throw error;
    }
  }, [user]);

  const changePassword = useCallback(async (passwordData) => {
    try {
      const response = await api.post('/auth/change-password', passwordData);
      
      if (response.data.success) {
        toast.success('Password changed successfully');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to change password';
      toast.error(errorMessage);
      throw error;
    }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    try {
      const response = await api.post('/auth/forgot-password', { email });
      
      if (response.data.success) {
        toast.success('Password reset email sent');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to send password reset email';
      toast.error(errorMessage);
      throw error;
    }
  }, []);

  const resetPassword = useCallback(async (resetData) => {
    try {
      const response = await api.post('/auth/reset-password', resetData);
      
      if (response.data.success) {
        toast.success('Password reset successful');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to reset password';
      toast.error(errorMessage);
      throw error;
    }
  }, []);

  const verifyEmail = useCallback(async (token) => {
    try {
      const response = await api.post('/auth/verify-email', { token });
      
      if (response.data.success) {
        if (user) {
          const updatedUser = { ...user, emailVerified: true };
          setUser(updatedUser);
          localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(updatedUser));
        }
        toast.success('Email verified successfully');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Email verification failed';
      toast.error(errorMessage);
      throw error;
    }
  }, [user]);

  const resendVerification = useCallback(async () => {
    try {
      const response = await api.post('/auth/resend-verification');
      
      if (response.data.success) {
        toast.success('Verification email sent');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to send verification email';
      toast.error(errorMessage);
      throw error;
    }
  }, []);

  const getProfile = useCallback(async () => {
    try {
      const response = await api.get('/auth/profile');
      
      if (response.data.success) {
        const userData = response.data.data;
        setUser(userData);
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(userData));
        return userData;
      }
    } catch (error) {
      console.error('Failed to get profile:', error);
      throw error;
    }
  }, []);

  const getActiveSessions = useCallback(async () => {
    try {
      const response = await api.get('/auth/sessions');
      return response.data.data || [];
    } catch (error) {
      console.error('Failed to get active sessions:', error);
      throw error;
    }
  }, []);

  const revokeSession = useCallback(async (sessionId) => {
    try {
      const response = await api.delete(`/auth/sessions/${sessionId}`);
      
      if (response.data.success) {
        toast.success('Session revoked successfully');
        return true;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to revoke session';
      toast.error(errorMessage);
      throw error;
    }
  }, []);

  const hasPermission = useCallback((permission) => {
    return permissions.includes(permission) || permissions.includes('admin');
  }, [permissions]);

  const hasRole = useCallback((role) => {
    return user?.userType === role;
  }, [user]);

  const canAccess = useCallback((resource, action = 'read') => {
    if (hasRole('admin')) return true;
    
    const resourcePermissions = {
      'patients': ['read', 'write'],
      'medical-records': ['read', 'write'],
      'appointments': ['read', 'write'],
      'payments': ['read'],
      'settings': ['read', 'write']
    };
    
    const requiredPermissions = resourcePermissions[resource];
    if (!requiredPermissions) return false;
    
    return requiredPermissions.includes(action) && 
           (hasPermission(resource) || hasPermission(`${resource}:${action}`));
  }, [hasRole, hasPermission]);

  const checkAuthStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const savedUser = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
      
      if (!token) {
        setIsLoading(false);
        return;
      }

      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      if (savedUser) {
        const userData = JSON.parse(savedUser);
        setUser(userData);
        setIsAuthenticated(true);
        setPermissions(userData.permissions || []);
      }

      try {
        await getProfile();
      } catch (error) {
        if (error.response?.status === 401) {
          try {
            await refreshToken();
            await getProfile();
          } catch (refreshError) {
            clearAuthData();
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      clearAuthData();
    } finally {
      setIsLoading(false);
    }
  }, [getProfile, refreshToken, clearAuthData]);

  const setupTokenRefresh = useCallback(() => {
    let refreshInterval;
    
    if (isAuthenticated && sessionInfo) {
      const timeToExpiry = sessionInfo.expiresAt.getTime() - Date.now();
      const refreshTime = Math.max(timeToExpiry - 5 * 60 * 1000, 60 * 1000);
      
      refreshInterval = setTimeout(async () => {
        try {
          await refreshToken();
        } catch (error) {
          console.error('Automatic token refresh failed:', error);
        }
      }, refreshTime);
    }
    
    return () => {
      if (refreshInterval) {
        clearTimeout(refreshInterval);
      }
    };
  }, [isAuthenticated, sessionInfo, refreshToken]);

  const updateLastActivity = useCallback(() => {
    if (isAuthenticated) {
      localStorage.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
    }
  }, [isAuthenticated]);

  const checkSessionTimeout = useCallback(() => {
    if (!isAuthenticated) return;
    
    const lastActivity = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVITY);
    const timeout = 30 * 60 * 1000;
    
    if (lastActivity && Date.now() - parseInt(lastActivity) > timeout) {
      toast.warning('Session expired due to inactivity');
      logout();
    }
  }, [isAuthenticated, logout]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    const cleanup = setupTokenRefresh();
    return cleanup;
  }, [setupTokenRefresh]);

  useEffect(() => {
    let activityInterval;
    let sessionInterval;
    
    if (isAuthenticated) {
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
      const handleActivity = () => updateLastActivity();
      
      events.forEach(event => {
        document.addEventListener(event, handleActivity, true);
      });
      
      sessionInterval = setInterval(checkSessionTimeout, 60000);
      
      return () => {
        events.forEach(event => {
          document.removeEventListener(event, handleActivity, true);
        });
        
        if (sessionInterval) {
          clearInterval(sessionInterval);
        }
      };
    }
  }, [isAuthenticated, updateLastActivity, checkSessionTimeout]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === STORAGE_KEYS.ACCESS_TOKEN && !e.newValue && isAuthenticated) {
        clearAuthData();
        toast.info('Logged out from another tab');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [isAuthenticated, clearAuthData]);

  const value = {
    // State
    user,
    isAuthenticated,
    isLoading,
    error,
    permissions,
    sessionInfo,

    // Actions
    login,
    walletLogin,
    register,
    logout,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    getProfile,
    refreshToken,
    getActiveSessions,
    revokeSession,

    // Utilities
    hasPermission,
    hasRole,
    canAccess,
    clearError: () => setError(null),

    // User info computed
    isPatient: user?.userType === USER_TYPES.PATIENT,
    isDoctor: user?.userType === USER_TYPES.DOCTOR,
    isAdmin: user?.userType === USER_TYPES.ADMIN,
    userName: user ? `${user.personalInfo?.firstName} ${user.personalInfo?.lastName}` : '',
    userInitials: user ? `${user.personalInfo?.firstName?.[0] || ''}${user.personalInfo?.lastName?.[0] || ''}` : '',
    isEmailVerified: user?.emailVerified || false,
    has2FA: user?.security?.twoFactorEnabled || false,
    
    // Session info
    sessionTimeLeft: sessionInfo ? Math.max(0, sessionInfo.expiresAt.getTime() - Date.now()) : 0,
    isSessionExpiringSoon: sessionInfo ? (sessionInfo.expiresAt.getTime() - Date.now()) < 5 * 60 * 1000 : false
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};