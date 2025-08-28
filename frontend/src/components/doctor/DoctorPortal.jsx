import React, { useState, useEffect } from 'react';
import { 
  Stethoscope, Clock, Star, Bitcoin, DollarSign, TrendingUp, 
  FileText, AlertCircle, CheckCircle, Users, Activity 
} from 'lucide-react';

const DoctorPortal = ({ account, onNavigate }) => {
  const [activeConsultations, setActiveConsultations] = useState([]);
  const [completedConsultations, setCompletedConsultations] = useState([]);
  const [reputationMetrics, setReputationMetrics] = useState({});
  const [earnings, setEarnings] = useState({ daily: 0, total: 0, btcRewards: 0 });
  const [isOnline, setIsOnline] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedConsultation, setSelectedConsultation] = useState(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [confidence, setConfidence] = useState(8);
  const [followUp, setFollowUp] = useState('2weeks');

  const mockActiveConsultations = [
    {
      id: 1,
      patient: '0x1234...5678',
      symptoms: 'Persistent skin rash on arms for 2 weeks, red and itchy',
      specialty: 'dermatology',
      fee: '0.05',
      isUrgent: false,
      createdAt: '2025-08-28T10:30:00Z',
      deadline: '2025-08-29T10:30:00Z',
      status: 'pending'
    },
    {
      id: 2,
      patient: '0x9876...4321',
      symptoms: 'Chest pain and shortness of breath during exercise',
      specialty: 'cardiology', 
      fee: '0.08',
      isUrgent: true,
      createdAt: '2025-08-28T14:15:00Z',
      deadline: '2025-08-28T16:15:00Z',
      status: 'accepted'
    }
  ];

  const mockMetrics = {
    totalConsultations: 156,
    averageRating: 4.8,
    responseTime: 12,
    streak: 23,
    successRate: 94
  };

  useEffect(() => {
    loadDoctorData();
  }, [account]);

  const loadDoctorData = async () => {
    try {
      setActiveConsultations(mockActiveConsultations);
      setReputationMetrics(mockMetrics);
      setEarnings({
        daily: 0.234,
        total: 12.567,
        btcRewards: 0.00456
      });
    } catch (error) {
      console.error('Error loading doctor data:', error);
    }
  };

  const handleAcceptConsultation = async (consultationId) => {
    try {
      const updatedConsultations = activeConsultations.map(c => 
        c.id === consultationId ? { ...c, status: 'accepted' } : c
      );
      setActiveConsultations(updatedConsultations);
      alert('Consultation accepted! You can now provide your diagnosis.');
    } catch (error) {
      console.error('Error accepting consultation:', error);
    }
  };

  const handleSubmitDiagnosis = async (consultationId) => {
    try {
      if (!diagnosis.trim()) {
        alert('Please provide a diagnosis');
        return;
      }

      const consultation = activeConsultations.find(c => c.id === consultationId);
      if (consultation) {
        const completed = { 
          ...consultation, 
          status: 'completed', 
          diagnosis,
          confidence,
          followUp,
          completedAt: new Date().toISOString()
        };
        
        setCompletedConsultations(prev => [completed, ...prev]);
        setActiveConsultations(prev => prev.filter(c => c.id !== consultationId));
        
        alert(`Diagnosis submitted! Payment released: ${consultation.fee} ETH`);
      }
      
      setSelectedConsultation(null);
      setDiagnosis('');
      setConfidence(8);
    } catch (error) {
      console.error('Error submitting diagnosis:', error);
    }
  };

  const claimDailyReward = async () => {
    try {
      if (reputationMetrics.averageRating < 4.0) {
        alert('You need a 4.0+ star rating to claim daily rewards');
        return;
      }
      alert('Daily BTC reward claimed: 0.00012 BTC sent to your wallet!');
    } catch (error) {
      console.error('Error claiming reward:', error);
    }
  };

  const formatTimeRemaining = (deadline) => {
    const now = new Date();
    const end = new Date(deadline);
    const diff = Math.max(0, end - now);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star 
        key={i} 
        className={`h-4 w-4 ${i < Math.floor(rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} 
      />
    ));
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'accepted': return 'text-blue-600 bg-blue-100'; 
      case 'completed': return 'text-green-600 bg-green-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Doctor Portal</h1>
          <p className="text-gray-600">Manage consultations and earn Bitcoin rewards</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></div>
            <span className="text-sm text-gray-600">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isOnline 
                ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {isOnline ? 'Go Offline' : 'Go Online'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-blue-600" />
            <div className="ml-3">
              <p className="text-sm text-gray-600">Total Patients</p>
              <p className="text-2xl font-semibold text-gray-900">{reputationMetrics.totalConsultations}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Star className="h-8 w-8 text-yellow-500" />
            <div className="ml-3">
              <p className="text-sm text-gray-600">Rating</p>
              <p className="text-2xl font-semibold text-gray-900">{reputationMetrics.averageRating}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <DollarSign className="h-8 w-8 text-green-600" />
            <div className="ml-3">
              <p className="text-sm text-gray-600">Today's Earnings</p>
              <p className="text-2xl font-semibold text-gray-900">{earnings.daily} ETH</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Bitcoin className="h-8 w-8 text-orange-500" />
            <div className="ml-3">
              <p className="text-sm text-gray-600">BTC Rewards</p>
              <p className="text-2xl font-semibold text-gray-900">{earnings.btcRewards}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="lg:w-1/4">
          <nav className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'dashboard' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Activity className="h-4 w-4 inline mr-2" />
                Active Cases
              </button>
              <button
                onClick={() => setActiveTab('completed')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'completed' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <CheckCircle className="h-4 w-4 inline mr-2" />
                Completed
              </button>
              <button
                onClick={() => setActiveTab('rewards')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'rewards' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Bitcoin className="h-4 w-4 inline mr-2" />
                BTC Rewards
              </button>
            </div>
          </nav>
        </div>

        <div className="lg:w-3/4">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Active Consultations</h2>
              
              {!isOnline && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
                    <p className="text-yellow-800">You're offline. Go online to receive new consultations.</p>
                  </div>
                </div>
              )}

              {activeConsultations.length === 0 ? (
                <div className="bg-white rounded-lg p-8 text-center">
                  <Stethoscope className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No active consultations</p>
                  <p className="text-sm text-gray-500 mt-2">
                    {isOnline ? 'Waiting for new patient requests...' : 'Go online to receive consultation requests'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {activeConsultations.map((consultation) => (
                    <div key={consultation.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center mb-2">
                            <h3 className="font-semibold text-gray-900 mr-3">
                              Consultation #{consultation.id}
                            </h3>
                            {consultation.isUrgent && (
                              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-medium">
                                URGENT
                              </span>
                            )}
                          </div>
                          <p className="text-gray-600 capitalize mb-2">{consultation.specialty}</p>
                          <p className="text-sm text-gray-700">{consultation.symptoms}</p>
                        </div>
                        
                        <div className="text-right">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(consultation.status)}`}>
                            {consultation.status}
                          </span>
                          <p className="text-sm text-gray-600 mt-2">{consultation.fee} ETH</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center text-sm text-gray-600">
                          <Clock className="h-4 w-4 mr-1" />
                          Time remaining: {formatTimeRemaining(consultation.deadline)}
                        </div>
                      </div>

                      <div className="flex space-x-3">
                        {consultation.status === 'pending' && (
                          <button
                            onClick={() => handleAcceptConsultation(consultation.id)}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Accept Case
                          </button>
                        )}
                        
                        {consultation.status === 'accepted' && (
                          <button
                            onClick={() => setSelectedConsultation(consultation)}
                            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                          >
                            Provide Diagnosis
                          </button>
                        )}
                        
                        <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
                          View Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'rewards' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Bitcoin Rewards</h2>
                <button
                  onClick={claimDailyReward}
                  disabled={reputationMetrics.averageRating < 4.0}
                  className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition-colors flex items-center disabled:opacity-50"
                >
                  <Bitcoin className="h-4 w-4 mr-2" />
                  Claim Daily Reward
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-4">Reputation Metrics</h3>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average Rating:</span>
                      <div className="flex items-center">
                        {renderStars(reputationMetrics.averageRating)}
                        <span className="ml-2 text-sm text-gray-600">{reputationMetrics.averageRating}</span>
                      </div>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Response Time:</span>
                      <span className="text-gray-900">{reputationMetrics.responseTime} min</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Current Streak:</span>
                      <span className="text-green-600 font-medium">{reputationMetrics.streak} 🔥</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Success Rate:</span>
                      <span className="text-green-600 font-medium">{reputationMetrics.successRate}%</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-4">Earnings Summary</h3>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Today's Earnings:</span>
                      <span className="text-gray-900 font-medium">{earnings.daily} ETH</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Earned:</span>
                      <span className="text-gray-900 font-medium">{earnings.total} ETH</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-gray-600">BTC Rewards:</span>
                      <span className="text-orange-600 font-medium">{earnings.btcRewards} BTC</span>
                    </div>
                  </div>
                </div>
              </div>

              {reputationMetrics.streak >= 10 && (
                <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-6">
                  <div className="flex items-center mb-3">
                    <Bitcoin className="h-6 w-6 text-orange-600 mr-2" />
                    <h3 className="font-semibold text-gray-900">Streak Bonus Available!</h3>
                  </div>
                  <p className="text-gray-700 mb-4">
                    You've maintained a {reputationMetrics.streak}-consultation streak with 4+ star ratings.
                  </p>
                  <button className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition-colors">
                    Claim Streak Bonus: 0.00025 BTC
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedConsultation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                Provide Diagnosis - Case #{selectedConsultation.id}
              </h3>
              <button
                onClick={() => setSelectedConsultation(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Patient Symptoms
                </label>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-gray-700">{selectedConsultation.symptoms}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Diagnosis & Treatment Plan *
                </label>
                <textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  rows="6"
                  placeholder="Provide your professional diagnosis and treatment recommendations..."
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confidence Level ({confidence}/10)
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={confidence}
                    onChange={(e) => setConfidence(e.target.value)}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recommended Follow-up
                  </label>
                  <select 
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="none">No follow-up needed</option>
                    <option value="1week">1 week follow-up</option>
                    <option value="2weeks">2 weeks follow-up</option>
                    <option value="1month">1 month follow-up</option>
                    <option value="specialist">Refer to specialist</option>
                    <option value="emergency">Seek immediate care</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg mb-6">
              <div className="flex items-center text-blue-800 mb-2">
                <AlertCircle className="h-4 w-4 mr-2" />
                <span className="font-medium">Payment Information</span>
              </div>
              <div className="text-sm text-blue-700 space-y-1">
                <p>Consultation Fee: {selectedConsultation.fee} ETH</p>
                <p>Your Earnings: {(parseFloat(selectedConsultation.fee) * 0.97).toFixed(3)} ETH (after 3% platform fee)</p>
                <p>BTC Equivalent: ~{(parseFloat(selectedConsultation.fee) * 0.00468).toFixed(5)} BTC</p>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setSelectedConsultation(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSubmitDiagnosis(selectedConsultation.id)}
                disabled={!diagnosis.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Submit Diagnosis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function formatTimeRemaining(deadline) {
    const now = new Date();
    const end = new Date(deadline);
    const diff = Math.max(0, end - now);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  function renderStars(rating) {
    return Array.from({ length: 5 }, (_, i) => (
      <Star 
        key={i} 
        className={`h-4 w-4 ${i < Math.floor(rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} 
      />
    ));
  }

  function getStatusColor(status) {
    switch (status) {
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'accepted': return 'text-blue-600 bg-blue-100';
      case 'completed': return 'text-green-600 bg-green-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }
};

export default DoctorPortal;