import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { 
  Home, 
  Users, 
  FileText, 
  CreditCard, 
  Settings, 
  BarChart3,
  Shield,
  Key,
  Calendar,
  MessageSquare,
  Database,
  AlertTriangle,
  Stethoscope,
  UserCheck,
  Brain,
  Zap,
  Bitcoin,
  Lock,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

const Sidebar = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [expandedSections, setExpandedSections] = useState({
    medical: false,
    blockchain: false,
    payments: false,
    admin: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getNavigationItems = () => {
    const baseItems = [
      {
        label: 'Dashboard',
        icon: Home,
        path: '/dashboard',
        roles: ['patient', 'doctor', 'admin']
      }
    ];

    const patientItems = [
      {
        label: 'My Health Records',
        icon: FileText,
        path: '/medical-records',
        roles: ['patient']
      },
      {
        label: 'Access Control',
        icon: Key,
        path: '/access-control',
        roles: ['patient']
      },
      {
        label: 'Appointments',
        icon: Calendar,
        path: '/appointments',
        roles: ['patient']
      },
      {
        label: 'Medical',
        icon: Stethoscope,
        isSection: true,
        key: 'medical',
        roles: ['patient'],
        children: [
          {
            label: 'Lab Results',
            icon: BarChart3,
            path: '/lab-results',
            roles: ['patient']
          },
          {
            label: 'Prescriptions',
            icon: FileText,
            path: '/prescriptions',
            roles: ['patient']
          },
          {
            label: 'Treatment Plans',
            icon: Brain,
            path: '/treatment-plans',
            roles: ['patient']
          },
          {
            label: 'Consultation Notes',
            icon: MessageSquare,
            path: '/consultations',
            roles: ['patient']
          }
        ]
      }
    ];

    const doctorItems = [
      {
        label: 'Patients',
        icon: Users,
        path: '/patients',
        roles: ['doctor', 'admin']
      },
      {
        label: 'Medical Records',
        icon: FileText,
        path: '/medical-records',
        roles: ['doctor', 'admin']
      },
      {
        label: 'Appointments',
        icon: Calendar,
        path: '/appointments',
        roles: ['doctor', 'admin']
      },
      {
        label: 'Analytics',
        icon: BarChart3,
        path: '/analytics',
        roles: ['doctor', 'admin']
      }
    ];

    const blockchainItems = [
      {
        label: 'Blockchain',
        icon: Shield,
        isSection: true,
        key: 'blockchain',
        roles: ['patient', 'doctor', 'admin'],
        children: [
          {
            label: 'Transaction History',
            icon: Database,
            path: '/transactions',
            roles: ['patient', 'doctor', 'admin']
          },
          {
            label: 'Data Integrity',
            icon: Lock,
            path: '/data-integrity',
            roles: ['patient', 'doctor', 'admin']
          },
          {
            label: 'Smart Contracts',
            icon: Zap,
            path: '/contracts',
            roles: ['doctor', 'admin']
          },
          {
            label: 'Audit Trail',
            icon: AlertTriangle,
            path: '/audit-trail',
            roles: ['admin']
          }
        ]
      }
    ];

    const paymentItems = [
      {
        label: 'Payments',
        icon: Bitcoin,
        isSection: true,
        key: 'payments',
        roles: ['patient', 'doctor', 'admin'],
        children: [
          {
            label: 'Payment History',
            icon: CreditCard,
            path: '/payment-history',
            roles: ['patient', 'doctor', 'admin']
          },
          {
            label: 'Lightning Network',
            icon: Zap,
            path: '/lightning',
            roles: ['patient', 'doctor', 'admin']
          },
          {
            label: 'Escrow Transactions',
            icon: Lock,
            path: '/escrow',
            roles: ['patient', 'doctor', 'admin']
          },
          {
            label: 'Billing Management',
            icon: FileText,
            path: '/billing',
            roles: ['doctor', 'admin']
          }
        ]
      }
    ];

    const adminItems = [
      {
        label: 'Administration',
        icon: UserCheck,
        isSection: true,
        key: 'admin',
        roles: ['admin'],
        children: [
          {
            label: 'User Management',
            icon: Users,
            path: '/admin/users',
            roles: ['admin']
          },
          {
            label: 'System Health',
            icon: Activity,
            path: '/admin/health',
            roles: ['admin']
          },
          {
            label: 'Security Logs',
            icon: Shield,
            path: '/admin/security',
            roles: ['admin']
          },
          {
            label: 'Network Status',
            icon: Zap,
            path: '/admin/network',
            roles: ['admin']
          },
          {
            label: 'Compliance Reports',
            icon: FileText,
            path: '/admin/compliance',
            roles: ['admin']
          }
        ]
      }
    ];

    const settingsItems = [
      {
        label: 'Settings',
        icon: Settings,
        path: '/settings',
        roles: ['patient', 'doctor', 'admin']
      }
    ];

    return [
      ...baseItems,
      ...patientItems,
      ...doctorItems,
      ...blockchainItems,
      ...paymentItems,
      ...adminItems,
      ...settingsItems
    ].filter(item => 
      item.roles.includes(user?.userType)
    );
  };

  const isItemActive = (path) => {
    return location.pathname === path;
  };

  const handleNavigation = (path) => {
    navigate(path);
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  const renderNavigationItem = (item) => {
    if (item.isSection) {
      const isExpanded = expandedSections[item.key];
      
      return (
        <div key={item.key} className="space-y-1">
          <button
            onClick={() => toggleSection(item.key)}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
          >
            <item.icon className="h-5 w-5 mr-3 flex-shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          
          {isExpanded && (
            <div className="ml-6 space-y-1 border-l border-gray-200 pl-4">
              {item.children.map(child => (
                <button
                  key={child.path}
                  onClick={() => handleNavigation(child.path)}
                  className={`flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors ${
                    isItemActive(child.path)
                      ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-500'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <child.icon className={`h-4 w-4 mr-3 flex-shrink-0 ${
                    isItemActive(child.path) ? 'text-blue-600' : ''
                  }`} />
                  {child.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={item.path}
        onClick={() => handleNavigation(item.path)}
        className={`flex items-center w-full px-3 py-2 text-sm font-medium rounded-md transition-colors ${
          isItemActive(item.path)
            ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-500'
            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
        }`}
      >
        <item.icon className={`h-5 w-5 mr-3 flex-shrink-0 ${
          isItemActive(item.path) ? 'text-blue-600' : ''
        }`} />
        {item.label}
      </button>
    );
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={onClose}
        />
      )}
      
      <nav className={`fixed top-0 left-0 z-30 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 lg:translate-x-0 lg:static lg:inset-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-center h-16 px-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Shield className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">
                DiagnoChain
              </span>
            </div>
          </div>

          <div className="flex-1 px-4 py-4 overflow-y-auto">
            <div className="space-y-2">
              {getNavigationItems().map(item => renderNavigationItem(item))}
            </div>
          </div>

          <div className="border-t border-gray-200 p-4">
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 text-center">
              <Shield className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                Secure & Decentralized
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Your health data is protected by blockchain technology and advanced encryption
              </p>
              
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Security Score</span>
                  <span className="text-green-600 font-semibold">98%</span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="bg-gradient-to-r from-green-500 to-blue-500 h-1.5 rounded-full" style={{width: '98%'}}></div>
                </div>
                
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span>Encrypted</span>
                  <span>Decentralized</span>
                  <span>Auditable</span>
                </div>
              </div>
            </div>
            
            <div className="mt-3 text-center">
              <button
                onClick={() => navigate('/help')}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Need Help? Contact Support
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
};

export default Sidebar;