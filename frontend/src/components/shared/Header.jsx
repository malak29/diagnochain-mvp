import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { Bell, Settings, LogOut, User, Wallet, Menu, X, Shield, Activity, CreditCard } from 'lucide-react';

const Header = ({ onMenuToggle, isSidebarOpen }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAuthenticated } = useAuth();
  const { isConnected, account, balance, disconnect } = useWallet();
  
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(3);
  
  const profileRef = useRef(null);
  const notificationsRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
    }
  }, [isAuthenticated]);

  const fetchNotifications = async () => {
    try {
      const response = await fetch('/api/notifications', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      if (isConnected) {
        await disconnect();
      }
      navigate('/login');
      setIsProfileOpen(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId 
            ? { ...notif, isRead: true }
            : notif
        )
      );
      
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const getPageTitle = () => {
    const path = location.pathname;
    const titles = {
      '/dashboard': 'Dashboard',
      '/patients': 'Patients',
      '/medical-records': 'Medical Records',
      '/payments': 'Payments',
      '/settings': 'Settings',
      '/profile': 'Profile',
      '/analytics': 'Analytics',
      '/access-control': 'Access Control'
    };
    
    return titles[path] || 'DiagnoChain';
  };

  const formatBalance = (balance) => {
    if (!balance) return '0.0000';
    return parseFloat(balance).toFixed(4);
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center space-x-4">
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Toggle sidebar"
          >
            {isSidebarOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
          
          <div className="flex items-center">
            <div className="flex items-center space-x-2">
              <Shield className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900 hidden sm:block">
                DiagnoChain
              </span>
            </div>
            
            <div className="hidden sm:block ml-6 text-sm text-gray-500">
              {getPageTitle()}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {isConnected && (
            <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <Wallet className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">
                {formatBalance(balance)} BTC
              </span>
              <span className="text-xs text-green-600">
                {account?.slice(0, 6)}...{account?.slice(-4)}
              </span>
            </div>
          )}

          <div className="relative" ref={notificationsRef}>
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-6 w-6" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {isNotificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="text-sm text-gray-500">{unreadCount} unread</span>
                  )}
                </div>
                
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      <Bell className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p>No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                          !notification.isRead ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => markNotificationAsRead(notification.id)}
                      >
                        <div className="flex items-start space-x-3">
                          <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${
                            !notification.isRead ? 'bg-blue-500' : 'bg-gray-300'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {notification.title}
                            </p>
                            <p className="text-sm text-gray-600 mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                              {new Date(notification.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                
                {notifications.length > 0 && (
                  <div className="p-3 border-t border-gray-200">
                    <button 
                      onClick={() => navigate('/notifications')}
                      className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      View all notifications
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center space-x-2 p-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              aria-label="Profile menu"
            >
              <div className="h-8 w-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                {user?.personalInfo?.profileImage ? (
                  <img
                    src={user.personalInfo.profileImage}
                    alt="Profile"
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <User className="h-5 w-5 text-white" />
                )}
              </div>
              
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-900">
                  {user?.personalInfo?.firstName} {user?.personalInfo?.lastName}
                </p>
                <p className="text-xs text-gray-500 capitalize">
                  {user?.userType}
                </p>
              </div>
            </button>

            {isProfileOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center space-x-3">
                    <div className="h-12 w-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      {user?.personalInfo?.profileImage ? (
                        <img
                          src={user.personalInfo.profileImage}
                          alt="Profile"
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <User className="h-6 w-6 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {user?.personalInfo?.firstName} {user?.personalInfo?.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {user?.email}
                      </p>
                      <p className="text-xs text-gray-400 capitalize">
                        {user?.userType}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="py-2">
                  <button
                    onClick={() => {
                      navigate('/profile');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <User className="h-4 w-4 mr-3" />
                    Profile Settings
                  </button>

                  <button
                    onClick={() => {
                      navigate('/security');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Shield className="h-4 w-4 mr-3" />
                    Security Settings
                  </button>

                  <button
                    onClick={() => {
                      navigate('/wallet');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Wallet className="h-4 w-4 mr-3" />
                    Wallet Management
                  </button>

                  <button
                    onClick={() => {
                      navigate('/activity');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Activity className="h-4 w-4 mr-3" />
                    Activity Log
                  </button>

                  <button
                    onClick={() => {
                      navigate('/billing');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <CreditCard className="h-4 w-4 mr-3" />
                    Billing & Payments
                  </button>

                  <button
                    onClick={() => {
                      navigate('/settings');
                      setIsProfileOpen(false);
                    }}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Settings className="h-4 w-4 mr-3" />
                    App Settings
                  </button>
                </div>

                {isConnected && (
                  <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Connected Wallet</div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-gray-700">
                        {account?.slice(0, 8)}...{account?.slice(-6)}
                      </span>
                      <span className="text-sm font-semibold text-green-600">
                        {formatBalance(balance)} BTC
                      </span>
                    </div>
                  </div>
                )}

                <div className="border-t border-gray-200">
                  <button
                    onClick={handleLogout}
                    className="flex items-center w-full px-4 py-3 text-sm text-red-700 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4 mr-3" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {location.pathname === '/dashboard' && user?.userType === 'patient' && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 sm:px-6 lg:px-8 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-sm text-blue-700">
              <Shield className="h-4 w-4" />
              <span>
                Your medical data is secured on the blockchain
              </span>
            </div>
            
            <div className="flex items-center space-x-4 text-xs text-blue-600">
              <span>Last backup: 2 hours ago</span>
              <span>•</span>
              <span>Encryption: AES-256</span>
              <span>•</span>
              <span>
                Access grants: {user?.accessGrants?.filter(g => g.isActive)?.length || 0}
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

const formatBalance = (balance) => {
  if (!balance || balance === '0') return '0.0000';
  return parseFloat(balance).toFixed(4);
};

export default Header;