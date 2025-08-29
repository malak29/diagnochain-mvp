import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useWallet } from '../../hooks/useWallet';
import { 
  Activity,
  FileText,
  Calendar,
  Shield,
  CreditCard,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Users,
  Bitcoin,
  Lock,
  Eye,
  Download,
  Share2,
  Plus,
  ArrowRight,
  Heart,
  Thermometer,
  Scale,
  Zap
} from 'lucide-react';

const PatientDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isConnected, balance } = useWallet();
  
  const [dashboardData, setDashboardData] = useState({
    healthMetrics: {},
    recentRecords: [],
    upcomingAppointments: [],
    accessGrants: [],
    blockchainStats: {},
    notifications: []
  });
  
  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState('30d');

  useEffect(() => {
    fetchDashboardData();
  }, [selectedTimeframe]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      
      const responses = await Promise.allSettled([
        fetch('/api/patients/my-profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/medical-records?timeframe=${selectedTimeframe}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/appointments/upcoming', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/access-grants', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/blockchain/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/health-metrics/latest', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const [profileRes, recordsRes, appointmentsRes, grantsRes, blockchainRes, metricsRes] = responses;

      if (recordsRes.status === 'fulfilled' && recordsRes.value.ok) {
        const recordsData = await recordsRes.value.json();
        setDashboardData(prev => ({ ...prev, recentRecords: recordsData.records || [] }));
      }

      if (appointmentsRes.status === 'fulfilled' && appointmentsRes.value.ok) {
        const appointmentsData = await appointmentsRes.value.json();
        setDashboardData(prev => ({ ...prev, upcomingAppointments: appointmentsData.appointments || [] }));
      }

      if (grantsRes.status === 'fulfilled' && grantsRes.value.ok) {
        const grantsData = await grantsRes.value.json();
        setDashboardData(prev => ({ ...prev, accessGrants: grantsData.grants || [] }));
      }

      if (blockchainRes.status === 'fulfilled' && blockchainRes.value.ok) {
        const blockchainData = await blockchainRes.value.json();
        setDashboardData(prev => ({ ...prev, blockchainStats: blockchainData.stats || {} }));
      }

      if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
        const metricsData = await metricsRes.value.json();
        setDashboardData(prev => ({ ...prev, healthMetrics: metricsData.metrics || {} }));
      }

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, subtitle, icon: Icon, color = 'blue', trend, onClick }) => (
    <div 
      className={`bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow ${
        onClick ? 'cursor-pointer' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className={`text-2xl font-bold text-${color}-600 mt-1`}>{value}</p>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
          )}
          {trend && (
            <div className={`flex items-center mt-2 text-sm ${
              trend.direction === 'up' ? 'text-green-600' : trend.direction === 'down' ? 'text-red-600' : 'text-gray-600'
            }`}>
              <TrendingUp className="h-4 w-4 mr-1" />
              <span>{trend.value}</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-full bg-${color}-50`}>
          <Icon className={`h-6 w-6 text-${color}-600`} />
        </div>
      </div>
    </div>
  );

  const QuickAction = ({ title, description, icon: Icon, color, onClick }) => (
    <button
      onClick={onClick}
      className="flex items-center p-4 bg-white rounded-lg border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all group w-full text-left"
    >
      <div className={`p-2 rounded-lg bg-${color}-50 group-hover:bg-${color}-100 transition-colors`}>
        <Icon className={`h-6 w-6 text-${color}-600`} />
      </div>
      <div className="ml-4 flex-1">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
      <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.personalInfo?.firstName}! 👋
          </h1>
          <p className="text-gray-600 mt-1">
            Here's an overview of your health data and recent activity.
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          <select
            value={selectedTimeframe}
            onChange={(e) => setSelectedTimeframe(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 3 months</option>
            <option value="1y">Last year</option>
          </select>
          
          <button
            onClick={() => navigate('/medical-records/new')}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add Record</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          title="Total Records"
          value={dashboardData.recentRecords.length || 0}
          subtitle="Medical records stored"
          icon={FileText}
          color="blue"
          onClick={() => navigate('/medical-records')}
        />
        
        <StatCard
          title="Active Doctors"
          value={dashboardData.accessGrants.filter(g => g.isActive).length || 0}
          subtitle="Healthcare providers with access"
          icon={Users}
          color="green"
          onClick={() => navigate('/access-control')}
        />
        
        <StatCard
          title="Blockchain Health"
          value={dashboardData.blockchainStats.healthScore || 'N/A'}
          subtitle="Data integrity score"
          icon={Shield}
          color="purple"
          trend={{
            direction: 'up',
            value: '+2.3% this month'
          }}
          onClick={() => navigate('/data-integrity')}
        />
        
        <StatCard
          title="Wallet Balance"
          value={isConnected ? `${formatBalance(balance)} BTC` : 'Not Connected'}
          subtitle="Available for payments"
          icon={Bitcoin}
          color="orange"
          onClick={() => navigate('/wallet')}
        />
      </div>

      {dashboardData.healthMetrics && Object.keys(dashboardData.healthMetrics).length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Heart className="h-5 w-5 mr-2 text-red-500" />
            Latest Health Metrics
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {dashboardData.healthMetrics.bloodPressure && (
              <div className="flex items-center p-4 bg-red-50 rounded-lg">
                <Heart className="h-8 w-8 text-red-500 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Blood Pressure</p>
                  <p className="text-lg font-bold text-red-600">
                    {dashboardData.healthMetrics.bloodPressure}
                  </p>
                  <p className="text-xs text-gray-500">
                    {dashboardData.healthMetrics.bpDate}
                  </p>
                </div>
              </div>
            )}
            
            {dashboardData.healthMetrics.temperature && (
              <div className="flex items-center p-4 bg-orange-50 rounded-lg">
                <Thermometer className="h-8 w-8 text-orange-500 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Temperature</p>
                  <p className="text-lg font-bold text-orange-600">
                    {dashboardData.healthMetrics.temperature}°F
                  </p>
                  <p className="text-xs text-gray-500">
                    {dashboardData.healthMetrics.tempDate}
                  </p>
                </div>
              </div>
            )}
            
            {dashboardData.healthMetrics.weight && (
              <div className="flex items-center p-4 bg-blue-50 rounded-lg">
                <Scale className="h-8 w-8 text-blue-500 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Weight</p>
                  <p className="text-lg font-bold text-blue-600">
                    {dashboardData.healthMetrics.weight} lbs
                  </p>
                  <p className="text-xs text-gray-500">
                    {dashboardData.healthMetrics.weightDate}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Clock className="h-5 w-5 mr-2 text-blue-500" />
              Recent Activity
            </h2>
            <button
              onClick={() => navigate('/medical-records')}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              View all
            </button>
          </div>
          
          <div className="space-y-3">
            {dashboardData.recentRecords.slice(0, 5).map((record, index) => (
              <div key={record.id || index} className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                <div className={`p-2 rounded-lg ${getRecordTypeColor(record.type)}`}>
                  {getRecordIcon(record.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {record.title || record.type}
                  </p>
                  <p className="text-sm text-gray-600 truncate">
                    {record.description || 'No description available'}
                  </p>
                  <div className="flex items-center mt-1 space-x-2">
                    <span className="text-xs text-gray-400">
                      {new Date(record.createdAt).toLocaleDateString()}
                    </span>
                    {record.doctorName && (
                      <>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-400">
                          Dr. {record.doctorName}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button className="text-gray-400 hover:text-gray-600 p-1">
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            ))}
            
            {dashboardData.recentRecords.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No recent medical records</p>
                <button
                  onClick={() => navigate('/medical-records/new')}
                  className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Add your first record
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-green-500" />
              Upcoming Appointments
            </h2>
            <button
              onClick={() => navigate('/appointments')}
              className="text-green-600 hover:text-green-700 text-sm font-medium"
            >
              Schedule new
            </button>
          </div>
          
          <div className="space-y-3">
            {dashboardData.upcomingAppointments.slice(0, 4).map((appointment, index) => (
              <div key={appointment.id || index} className="flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                <div className="flex-shrink-0">
                  <div className="h-10 w-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-green-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {appointment.type || 'General Consultation'}
                  </p>
                  <p className="text-sm text-gray-600">
                    Dr. {appointment.doctorName}
                  </p>
                  <div className="flex items-center mt-1 space-x-2 text-xs text-gray-400">
                    <span>{new Date(appointment.dateTime).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>{new Date(appointment.dateTime).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    appointment.status === 'confirmed' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {appointment.status || 'pending'}
                  </span>
                </div>
              </div>
            ))}
            
            {dashboardData.upcomingAppointments.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No upcoming appointments</p>
                <button
                  onClick={() => navigate('/appointments/new')}
                  className="mt-2 text-green-600 hover:text-green-700 text-sm font-medium"
                >
                  Schedule an appointment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-purple-500" />
              Data Access Control
            </h2>
            <button
              onClick={() => navigate('/access-control')}
              className="text-purple-600 hover:text-purple-700 text-sm font-medium"
            >
              Manage access
            </button>
          </div>
          
          <div className="space-y-4">
            {dashboardData.accessGrants.slice(0, 3).map((grant, index) => (
              <div key={grant.id || index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="h-10 w-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Dr. {grant.doctorName}
                    </p>
                    <p className="text-sm text-gray-600">
                      {grant.permissions.join(', ')} access
                    </p>
                    <p className="text-xs text-gray-400">
                      Granted {new Date(grant.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    grant.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {grant.isActive ? 'Active' : 'Expired'}
                  </span>
                  
                  {grant.expirationDate && (
                    <span className="text-xs text-gray-400">
                      Expires {new Date(grant.expirationDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
            
            {dashboardData.accessGrants.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Lock className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No active access grants</p>
                <button
                  onClick={() => navigate('/access-control/new')}
                  className="mt-2 text-purple-600 hover:text-purple-700 text-sm font-medium"
                >
                  Grant access to a doctor
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Zap className="h-5 w-5 mr-2 text-yellow-500" />
              Quick Actions
            </h3>
            
            <div className="space-y-3">
              <QuickAction
                title="Upload Medical Document"
                description="Scan and upload lab results, prescriptions"
                icon={FileText}
                color="blue"
                onClick={() => navigate('/upload')}
              />
              
              <QuickAction
                title="Share Health Data"
                description="Grant temporary access to a healthcare provider"
                icon={Share2}
                color="green"
                onClick={() => navigate('/access-control/new')}
              />
              
              <QuickAction
                title="View Transaction History"
                description="See all blockchain transactions"
                icon={Activity}
                color="purple"
                onClick={() => navigate('/transactions')}
              />
              
              <QuickAction
                title="Download Health Report"
                description="Generate comprehensive health summary"
                icon={Download}
                color="orange"
                onClick={() => navigate('/reports/generate')}
              />
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6 text-white">
            <div className="flex items-center mb-3">
              <Shield className="h-6 w-6 mr-2" />
              <h3 className="text-lg font-semibold">Security Status</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Data Encryption</span>
                <CheckCircle className="h-4 w-4 text-green-300" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Blockchain Backup</span>
                <CheckCircle className="h-4 w-4 text-green-300" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Access Monitoring</span>
                <CheckCircle className="h-4 w-4 text-green-300" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">2FA Enabled</span>
                {user?.security?.twoFactorEnabled ? (
                  <CheckCircle className="h-4 w-4 text-green-300" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-300" />
                )}
              </div>
            </div>
            
            {!user?.security?.twoFactorEnabled && (
              <button
                onClick={() => navigate('/security/2fa')}
                className="mt-4 w-full bg-white bg-opacity-20 text-white py-2 px-4 rounded-md hover:bg-opacity-30 transition-colors text-sm font-medium"
              >
                Enable Two-Factor Authentication
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-gray-500" />
            Blockchain Activity
          </h2>
          <button
            onClick={() => navigate('/blockchain/activity')}
            className="text-gray-600 hover:text-gray-700 text-sm font-medium"
          >
            View details
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">
              {dashboardData.blockchainStats.totalTransactions || 0}
            </p>
            <p className="text-sm text-gray-600">Total Transactions</p>
          </div>
          
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">
              {dashboardData.blockchainStats.dataIntegrityScore || 'N/A'}%
            </p>
            <p className="text-sm text-gray-600">Data Integrity</p>
          </div>
          
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">
              {dashboardData.blockchainStats.lastBackup || 'Never'}
            </p>
            <p className="text-sm text-gray-600">Last Backup</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const getRecordTypeColor = (type) => {
  const colors = {
    diagnosis: 'bg-red-100',
    prescription: 'bg-blue-100',
    lab_result: 'bg-green-100',
    imaging: 'bg-purple-100',
    surgery: 'bg-orange-100',
    consultation: 'bg-yellow-100'
  };
  return colors[type] || 'bg-gray-100';
};

const getRecordIcon = (type) => {
  const icons = {
    diagnosis: <AlertCircle className="h-4 w-4 text-red-600" />,
    prescription: <FileText className="h-4 w-4 text-blue-600" />,
    lab_result: <BarChart3 className="h-4 w-4 text-green-600" />,
    imaging: <Camera className="h-4 w-4 text-purple-600" />,
    surgery: <Zap className="h-4 w-4 text-orange-600" />,
    consultation: <MessageSquare className="h-4 w-4 text-yellow-600" />
  };
  return icons[type] || <FileText className="h-4 w-4 text-gray-600" />;
};

const formatBalance = (balance) => {
  if (!balance || balance === '0') return '0.0000';
  return parseFloat(balance).toFixed(4);
};

export default PatientDashboard;