import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ToastContainer } from 'react-toastify';
import { ErrorBoundary } from 'react-error-boundary';
import { HelmetProvider } from 'react-helmet-async';

import { AuthProvider } from './hooks/useAuth';
import { WalletProvider } from './hooks/useWallet';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/shared/ProtectedRoute';
import LoadingSpinner from './components/shared/LoadingSpinner';
import ErrorFallback from './components/shared/ErrorFallback';
import Layout from './components/shared/Layout';

const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/Register'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Profile = React.lazy(() => import('./pages/Profile'));
const MedicalRecords = React.lazy(() => import('./pages/MedicalRecords'));
const Appointments = React.lazy(() => import('./pages/Appointments'));
const Documents = React.lazy(() => import('./pages/Documents'));
const AccessControl = React.lazy(() => import('./pages/AccessControl'));
const Payments = React.lazy(() => import('./pages/Payments'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Analytics = React.lazy(() => import('./pages/Analytics'));
const Help = React.lazy(() => import('./pages/Help'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

import 'react-toastify/dist/ReactToastify.css';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      suspense: false
    },
    mutations: {
      retry: 1,
      retryDelay: 1000
    }
  }
});

const AppRoutes = () => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/login" 
        element={
          !isAuthenticated ? (
            <Suspense fallback={<LoadingSpinner />}>
              <Login />
            </Suspense>
          ) : (
            <Navigate to="/dashboard" replace />
          )
        } 
      />
      
      <Route 
        path="/register" 
        element={
          !isAuthenticated ? (
            <Suspense fallback={<LoadingSpinner />}>
              <Register />
            </Suspense>
          ) : (
            <Navigate to="/dashboard" replace />
          )
        } 
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Dashboard />
            </Suspense>
          }
        />
        
        <Route
          path="profile"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Profile />
            </Suspense>
          }
        />
        
        <Route
          path="medical-records/*"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <MedicalRecords />
            </Suspense>
          }
        />
        
        <Route
          path="appointments/*"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Appointments />
            </Suspense>
          }
        />
        
        <Route
          path="documents/*"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Documents />
            </Suspense>
          }
        />
        
        <Route
          path="access-control/*"
          element={
            <ProtectedRoute allowedRoles={['patient', 'admin']}>
              <Suspense fallback={<LoadingSpinner />}>
                <AccessControl />
              </Suspense>
            </ProtectedRoute>
          }
        />
        
        <Route
          path="payments/*"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Payments />
            </Suspense>
          }
        />
        
        <Route
          path="analytics/*"
          element={
            <ProtectedRoute allowedRoles={['doctor', 'admin']}>
              <Suspense fallback={<LoadingSpinner />}>
                <Analytics />
              </Suspense>
            </ProtectedRoute>
          }
        />
        
        <Route
          path="settings/*"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Settings />
            </Suspense>
          }
        />
        
        <Route
          path="help"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <Help />
            </Suspense>
          }
        />
      </Route>

      <Route
        path="*"
        element={
          <Suspense fallback={<LoadingSpinner />}>
            <NotFound />
          </Suspense>
        }
      />
    </Routes>
  );
};

const App = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleContextMenu = (e) => {
      if (process.env.NODE_ENV === 'production') {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e) => {
      if (process.env.NODE_ENV === 'production') {
        if (e.key === 'F12' || 
            (e.ctrlKey && e.shiftKey && e.key === 'I') ||
            (e.ctrlKey && e.shiftKey && e.key === 'C') ||
            (e.ctrlKey && e.shiftKey && e.key === 'J')) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleError = (error, errorInfo) => {
    console.error('Application Error:', error);
    console.error('Error Info:', errorInfo);
    
    if (window.gtag) {
      window.gtag('event', 'exception', {
        description: error.toString(),
        fatal: false
      });
    }
  };

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={handleError}
      onReset={() => window.location.reload()}
    >
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <WalletProvider>
              <Router>
                <div className="App">
                  {!isOnline && (
                    <div className="bg-red-600 text-white text-center py-2 px-4 text-sm">
                      <span className="font-medium">No internet connection.</span>
                      <span className="ml-2">Some features may not work properly.</span>
                    </div>
                  )}
                  
                  <AppRoutes />
                  
                  <ToastContainer
                    position="top-right"
                    autoClose={5000}
                    hideProgressBar={false}
                    newestOnTop={false}
                    closeOnClick
                    rtl={false}
                    pauseOnFocusLoss
                    draggable
                    pauseOnHover
                    theme="light"
                    toastClassName="toast-custom"
                    bodyClassName="toast-body"
                    className="toast-container"
                  />
                </div>
              </Router>
            </WalletProvider>
          </AuthProvider>
          
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
};

if (process.env.NODE_ENV === 'production') {
  console.log(
    '%c🔐 DiagnoChain',
    'color: #3b82f6; font-size: 24px; font-weight: bold;'
  );
  console.log(
    '%cSecure Healthcare Data Management',
    'color: #6b7280; font-size: 14px;'
  );
  console.log(
    '%c⚠️ Warning: This is a browser console. Do not paste any code here that you don\'t understand. Malicious code could compromise your account security.',
    'color: #dc2626; font-size: 12px; font-weight: bold;'
  );
}

window.addEventListener('beforeunload', (event) => {
  if (process.env.NODE_ENV === 'production') {
    const hasUnsavedChanges = sessionStorage.getItem('hasUnsavedChanges');
    if (hasUnsavedChanges === 'true') {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return event.returnValue;
    }
  }
});

const vitals = async () => {
  if (process.env.NODE_ENV === 'production') {
    const { getCLS, getFID, getFCP, getLCP, getTTFB } = await import('web-vitals');
    
    const sendToAnalytics = (metric) => {
      if (window.gtag) {
        window.gtag('event', metric.name, {
          event_category: 'Web Vitals',
          value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
          event_label: metric.id,
          non_interaction: true,
        });
      }
    };
    
    getCLS(sendToAnalytics);
    getFID(sendToAnalytics);
    getFCP(sendToAnalytics);
    getLCP(sendToAnalytics);
    getTTFB(sendToAnalytics);
  }
};

vitals();

export default App;