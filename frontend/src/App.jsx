import React, { useState, useEffect } from 'react';
import { User, Stethoscope, Shield, Menu, X, Heart, Calendar, FileText, Star, Clock, Search, Plus, Bitcoin, DollarSign, Wallet, AlertTriangle, CheckCircle } from 'lucide-react';

const App = () => {
  const [account, setAccount] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentView, setCurrentView] = useState('home');
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState('');

  useEffect(() => {
    checkWalletConnection();
  }, []);

  const checkWalletConnection = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          setIsConnected(true);
          await determineUserRole(accounts[0]);
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
      }
    }
    setIsLoading(false);
  };

  const determineUserRole = async (address) => {
    try {
      // Mock role assignment for demo
      const mockRoles = {
        'patient': address.toLowerCase().includes('1234'),
        'doctor': address.toLowerCase().includes('abcd'),
      };
      
      const role = mockRoles.patient ? 'patient' : mockRoles.doctor ? 'doctor' : 'patient';
      setUserRole(role);
      
      if (role === 'patient') setCurrentView('patient');
      else if (role === 'doctor') setCurrentView('doctor');
      else setCurrentView('home');
    } catch (error) {
      console.error('Error determining user role:', error);
      setUserRole('patient'); // Default to patient
      setCurrentView('patient');
    }
  };

  const connectMetaMask = async () => {
    if (typeof window.ethereum === 'undefined') {
      setWalletError('MetaMask not detected. Please install MetaMask.');
      return;
    }

    setIsConnecting(true);
    setWalletError('');

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      setAccount(accounts[0]);
      setIsConnected(true);
      await determineUserRole(accounts[0]);
      
    } catch (error) {
      console.error('Error connecting to MetaMask:', error);
      setWalletError(error.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnect = () => {
    setAccount(null);
    setUserRole(null);
    setIsConnected(false);
    setCurrentView('home');
  };

  const navigateTo = (view) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
  };

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star 
        key={i} 
        className={`h-4 w-4 ${i < Math.floor(rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`} 
      />
    ));
  };

  const WalletConnection = () => (
    <div className="space-y-4">
      {walletError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-sm text-red-700">{walletError}</p>
          </div>
        </div>
      )}

      <button
        onClick={connectMetaMask}
        disabled={isConnecting || !window.ethereum}
        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
            Connecting...
          </>
        ) : (
          <>
            <Wallet className="h-5 w-5 mr-2" />
            Connect Wallet
          </>
        )}
      </button>
    </div>
  );

  const PatientDashboard = () => {
    const [consultations] = useState([
      {
        id: 1,
        doctorName: 'Dr. Sarah Chen',
        specialty: 'dermatology',
        status: 'completed',
        fee: '0.05',
        date: '2025-08-25',
        rating: 5
      },
      {
        id: 2,
        doctorName: 'Dr. Michael Rodriguez',
        specialty: 'cardiology',
        status: 'in_progress',
        fee: '0.08',
        date: '2025-08-28',
        rating: 0
      }
    ]);

    const [doctors] = useState([
      {
        name: 'Dr. Sarah Chen',
        specialty: 'dermatology',
        rating: 4.8,
        consultations: 156,
        responseTime: '12 min',
        fee: '0.05',
        isOnline: true
      },
      {
        name: 'Dr. Maria Santos',
        specialty: 'cardiology',
        rating: 4.9,
        consultations: 203,
        responseTime: '8 min',
        fee: '0.07',
        isOnline: true
      }
    ]);

    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Patient Dashboard</h1>
        
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Recent Consultations</h2>
              <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center">
                <Plus className="h-4 w-4 mr-2" />
                New Consultation
              </button>
            </div>

            <div className="space-y-4">
              {consultations.map((consultation) => (
                <div key={consultation.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">{consultation.doctorName}</h3>
                      <p className="text-sm text-gray-600 capitalize">{consultation.specialty}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      consultation.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {consultation.status}
                    </span>
                  </div>
                  
                  <div className="grid md:grid-cols-3 gap-4 mb-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <Calendar className="h-4 w-4 mr-2" />
                      {consultation.date}
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <DollarSign className="h-4 w-4 mr-2" />
                      {consultation.fee} ETH
                    </div>
                    {consultation.rating > 0 && (
                      <div className="flex items-center">
                        {renderStars(consultation.rating)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Available Doctors</h2>
            
            <div className="space-y-4">
              {doctors.map((doctor, index) => (
                <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 mr-3">{doctor.name}</h3>
                        <div className={`w-3 h-3 rounded-full ${doctor.isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                      </div>
                      
                      <p className="text-gray-600 capitalize mb-3">{doctor.specialty}</p>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                        <div className="flex items-center">
                          <Star className="h-4 w-4 mr-1 text-yellow-400" />
                          {doctor.rating}
                        </div>
                        <div className="flex items-center">
                          <Clock className="h-4 w-4 mr-1" />
                          {doctor.responseTime}
                        </div>
                        <div className="flex items-center">
                          <DollarSign className="h-4 w-4 mr-1" />
                          {doctor.fee} ETH
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => navigateTo('consultation')}
                      disabled={!doctor.isOnline}
                      className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                        doctor.isOnline
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {doctor.isOnline ? 'Book Now' : 'Offline'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const DoctorPortal = () => {
    const [isOnline, setIsOnline] = useState(false);
    const [activeConsultations] = useState([
      {
        id: 1,
        symptoms: 'Persistent skin rash on arms',
        specialty: 'dermatology',
        fee: '0.05',
        isUrgent: false,
        status: 'pending'
      }
    ]);

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
              <User className="h-8 w-8 text-blue-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-600">Total Patients</p>
                <p className="text-2xl font-semibold text-gray-900">156</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center">
              <Star className="h-8 w-8 text-yellow-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-600">Rating</p>
                <p className="text-2xl font-semibold text-gray-900">4.8</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center">
              <DollarSign className="h-8 w-8 text-green-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-600">Today's Earnings</p>
                <p className="text-2xl font-semibold text-gray-900">0.234 ETH</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center">
              <Bitcoin className="h-8 w-8 text-orange-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-600">BTC Rewards</p>
                <p className="text-2xl font-semibold text-gray-900">0.00456</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-gray-900">Active Consultations</h2>
          
          {activeConsultations.length === 0 ? (
            <div className="bg-white rounded-lg p-8 text-center">
              <Stethoscope className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No active consultations</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {activeConsultations.map((consultation) => (
                <div key={consultation.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        Consultation #{consultation.id}
                      </h3>
                      <p className="text-sm text-gray-700">{consultation.symptoms}</p>
                    </div>
                    
                    <div className="text-right">
                      <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium">
                        {consultation.status}
                      </span>
                      <p className="text-sm text-gray-600 mt-2">{consultation.fee} ETH</p>
                    </div>
                  </div>

                  <div className="flex space-x-3">
                    <button
                      onClick={() => navigateTo('consultation')}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Accept Case
                    </button>
                    <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const ConsultationFlow = () => {
    const [currentStep, setCurrentStep] = useState(2);
    const [diagnosis, setDiagnosis] = useState('');
    const [confidence, setConfidence] = useState(8);

    const steps = [
      { number: 1, title: 'Created', desc: 'Payment escrowed' },
      { number: 2, title: 'Accepted', desc: 'Case assigned' },
      { number: 3, title: 'Diagnosis', desc: 'Assessment' },
      { number: 4, title: 'Complete', desc: 'NFT minted' }
    ];

    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button
          onClick={() => navigateTo(userRole)}
          className="text-indigo-600 hover:text-indigo-800 mb-6 flex items-center text-sm"
        >
          ← Back to {userRole === 'patient' ? 'Dashboard' : 'Portal'}
        </button>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Consultation #001
        </h1>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex justify-between mb-8">
            {steps.map((step, index) => (
              <div key={step.number} className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  currentStep >= step.number 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {currentStep > step.number ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    step.number
                  )}
                </div>
                <p className="text-xs font-medium text-gray-900 text-center">{step.title}</p>
                <p className="text-xs text-gray-500 text-center">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-4">Patient Symptoms</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-800">Persistent skin rash on both arms lasting 2 weeks. Red, itchy patches that worsen at night.</p>
              </div>
            </div>

            {userRole === 'doctor' && currentStep === 2 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Provide Diagnosis</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Diagnosis & Treatment Plan
                    </label>
                    <textarea
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      rows="6"
                      placeholder="Provide your professional diagnosis..."
                    />
                  </div>

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

                  <button
                    onClick={() => setCurrentStep(4)}
                    disabled={!diagnosis.trim()}
                    className="w-full bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    Submit Diagnosis & Release Payment
                  </button>
                </div>
              </div>
            )}

            {currentStep >= 4 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center mb-4">
                  <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                  <h3 className="font-semibold text-gray-900">Diagnosis Completed</h3>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg mb-4">
                  <p className="text-gray-800">
                    {diagnosis || 'Contact dermatitis. Recommend topical corticosteroid and avoiding known irritants. Follow up in 2 weeks if symptoms persist.'}
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button className="flex items-center bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
                    <FileText className="h-4 w-4 mr-2" />
                    View NFT
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Consultation Details</h3>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Doctor:</span>
                  <span className="text-gray-900">Dr. Sarah Chen</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fee:</span>
                  <span className="text-gray-900">0.05 ETH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">BTC Equivalent:</span>
                  <span className="text-gray-900">0.00234 BTC</span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
              <div className="flex items-center mb-3">
                <FileText className="h-5 w-5 text-blue-600 mr-2" />
                <h3 className="font-semibold text-gray-900">Medical NFT</h3>
              </div>
              
              {currentStep >= 4 ? (
                <div className="space-y-2">
                  <div className="flex items-center text-green-600">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    <span className="text-sm font-medium">NFT Minted</span>
                  </div>
                  <p className="text-sm text-gray-600">Token ID: #DGMR001</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center text-gray-500">
                    <Clock className="h-4 w-4 mr-2" />
                    <span className="text-sm">NFT Pending</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'patient':
        return isConnected && userRole === 'patient' ? <PatientDashboard /> : (
          <div className="text-center py-12">
            <p className="text-red-600">Access denied. Patient role required.</p>
          </div>
        );
        
      case 'doctor':
        return isConnected && userRole === 'doctor' ? <DoctorPortal /> : (
          <div className="text-center py-12">
            <p className="text-red-600">Access denied. Doctor verification required.</p>
          </div>
        );
        
      case 'consultation':
        return isConnected ? <ConsultationFlow /> : (
          <div className="text-center py-12">
            <p className="text-red-600">Please connect your wallet first.</p>
          </div>
        );
        
      default:
        return (
          <div className="max-w-4xl mx-auto px-4 py-12">
            <div className="text-center">
              <Heart className="h-20 w-20 text-indigo-600 mx-auto mb-8" />
              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                Welcome to DiagnoChain
              </h1>
              <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                Decentralized healthcare consultations with Bitcoin rewards. 
                Connect patients with verified doctors worldwide.
              </p>
              
              {!isConnected ? (
                <div className="mb-8">
                  <WalletConnection />
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                  <button
                    onClick={() => navigateTo('patient')}
                    className="p-6 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <User className="h-12 w-12 text-blue-600 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Patient Portal</h3>
                    <p className="text-gray-600 text-sm">Book consultations and manage health records</p>
                  </button>
                  
                  <button
                    onClick={() => navigateTo('doctor')}
                    className="p-6 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                  >
                    <Stethoscope className="h-12 w-12 text-green-600 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Doctor Portal</h3>
                    <p className="text-gray-600 text-sm">Provide consultations and earn Bitcoin rewards</p>
                  </button>
                </div>
              )}
              
              <div className="mt-12 grid md:grid-cols-3 gap-8 max-w-3xl mx-auto text-left">
                <div className="text-center">
                  <Shield className="h-8 w-8 text-indigo-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">Verified Doctors</h3>
                  <p className="text-sm text-gray-600">All doctors are blockchain-verified with staked credentials</p>
                </div>
                <div className="text-center">
                  <Heart className="h-8 w-8 text-indigo-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">Secure Payments</h3>
                  <p className="text-sm text-gray-600">Smart contract escrow with Bitcoin integration</p>
                </div>
                <div className="text-center">
                  <User className="h-8 w-8 text-indigo-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">NFT Records</h3>
                  <p className="text-sm text-gray-600">Your diagnoses become permanent, verifiable NFTs</p>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-indigo-600 font-medium">Loading DiagnoChain...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <nav className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Heart className="h-8 w-8 text-indigo-600 mr-3" />
              <span className="text-xl font-bold text-gray-900">DiagnoChain</span>
            </div>

            <div className="hidden md:flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                {userRole === 'doctor' && <Stethoscope className="h-4 w-4" />}
                {userRole === 'patient' && <User className="h-4 w-4" />}
                {userRole === 'verifier' && <Shield className="h-4 w-4" />}
                <span className="capitalize">{userRole || 'Guest'}</span>
              </div>
              
              {isConnected ? (
                <div className="flex items-center space-x-3">
                  <div className="text-sm text-gray-500">
                    {account?.slice(0, 6)}...{account?.slice(-4)}
                  </div>
                  <button
                    onClick={handleWalletDisconnect}
                    className="text-sm text-red-600 hover:text-red-800 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <WalletConnection />
              )}
            </div>

            <div className="md:hidden flex items-center">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-gray-600 hover:text-gray-900"
              >
                {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {renderCurrentView()}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <Heart className="h-5 w-5 text-indigo-600" />
              <span className="text-gray-600">DiagnoChain © 2025</span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-gray-500">
              <button className="hover:text-indigo-600 transition-colors">Privacy Policy</button>
              <button className="hover:text-indigo-600 transition-colors">Terms of Service</button>
              <button className="hover:text-indigo-600 transition-colors">Help</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;