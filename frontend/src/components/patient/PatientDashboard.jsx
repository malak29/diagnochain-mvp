import React, { useState, useEffect } from 'react';
import { Calendar, FileText, Star, Clock, User, Search, Filter, Plus, Bitcoin, DollarSign } from 'lucide-react';

const PatientDashboard = ({ account, onNavigate }) => {
  const [consultations, setConsultations] = useState([]);
  const [diagnosticNFTs, setDiagnosticNFTs] = useState([]);
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [selectedSpecialty, setSelectedSpecialty] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [symptoms, setSymptoms] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  const specialties = [
    'general_practice', 'dermatology', 'cardiology', 
    'neurology', 'oncology', 'psychiatry'
  ];

  const mockConsultations = [
    {
      id: 1,
      doctor: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      doctorName: 'Dr. Sarah Chen',
      specialty: 'dermatology',
      status: 'completed',
      fee: '0.05',
      date: '2025-08-25',
      diagnosisHash: 'QmX7Y8Z9...',
      rating: 5,
      nftId: 'DGMR001'
    },
    {
      id: 2,
      doctor: '0x123def456789abcdef123456789abcdef12345678',
      doctorName: 'Dr. Michael Rodriguez',
      specialty: 'cardiology',
      status: 'in_progress',
      fee: '0.08',
      date: '2025-08-28',
      diagnosisHash: '',
      rating: 0
    },
    {
      id: 3,
      doctor: '0x987fed321cba987fed321cba987fed321cba9876',
      doctorName: 'Dr. James Wilson',
      specialty: 'general_practice',
      status: 'pending',
      fee: '0.04',
      date: '2025-08-28',
      rating: 0
    }
  ];

  const mockDoctors = [
    {
      address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      name: 'Dr. Sarah Chen',
      specialty: 'dermatology',
      rating: 4.8,
      consultations: 156,
      responseTime: '12 min',
      fee: '0.05',
      isOnline: true,
      verification: 'Verified MD, Stanford Medical'
    },
    {
      address: '0x987fed321cba987fed321cba987fed321cba9876',
      name: 'Dr. James Wilson',
      specialty: 'general_practice',
      rating: 4.6,
      consultations: 89,
      responseTime: '18 min',
      fee: '0.04',
      isOnline: false,
      verification: 'Verified MD, Johns Hopkins'
    },
    {
      address: '0x456abc789def456abc789def456abc789def4567',
      name: 'Dr. Maria Santos',
      specialty: 'cardiology',
      rating: 4.9,
      consultations: 203,
      responseTime: '8 min',
      fee: '0.07',
      isOnline: true,
      verification: 'Verified MD, Mayo Clinic'
    },
    {
      address: '0xabc123def456abc123def456abc123def456abc1',
      name: 'Dr. Ahmed Hassan',
      specialty: 'neurology',
      rating: 4.7,
      consultations: 127,
      responseTime: '15 min',
      fee: '0.09',
      isOnline: true,
      verification: 'Verified MD, Cleveland Clinic'
    }
  ];

  const mockNFTs = [
    {
      id: 1,
      tokenId: 'DGMR001',
      specialty: 'dermatology',
      date: '2025-08-25',
      doctor: 'Dr. Sarah Chen',
      diagnosis: 'Contact Dermatitis',
      confidence: 8
    },
    {
      id: 2,
      tokenId: 'DGMR015',
      specialty: 'general_practice',
      date: '2025-08-20',
      doctor: 'Dr. James Wilson',
      diagnosis: 'Seasonal Allergies',
      confidence: 9
    }
  ];

  useEffect(() => {
    loadPatientData();
  }, [account]);

  const loadPatientData = async () => {
    try {
      setConsultations(mockConsultations);
      setAvailableDoctors(mockDoctors);
      setDiagnosticNFTs(mockNFTs);
    } catch (error) {
      console.error('Error loading patient data:', error);
    }
  };

  const handleBookConsultation = (doctor) => {
    setSelectedDoctor(doctor);
    setIsBookingOpen(true);
  };

  const submitBooking = async () => {
    try {
      console.log('Booking consultation:', {
        doctor: selectedDoctor.address,
        symptoms,
        isUrgent,
        fee: selectedDoctor.fee
      });
      
      const newConsultation = {
        id: consultations.length + 1,
        doctor: selectedDoctor.address,
        doctorName: selectedDoctor.name,
        specialty: selectedDoctor.specialty,
        status: 'pending',
        fee: selectedDoctor.fee,
        date: new Date().toISOString().split('T')[0],
        rating: 0
      };
      
      setConsultations(prev => [newConsultation, ...prev]);
      setIsBookingOpen(false);
      setSymptoms('');
      setIsUrgent(false);
      
      alert('Consultation booked successfully! Payment held in escrow.');
    } catch (error) {
      console.error('Error booking consultation:', error);
    }
  };

  const filteredDoctors = availableDoctors.filter(doctor => {
    const matchesSearch = doctor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         doctor.specialty.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSpecialty = !selectedSpecialty || doctor.specialty === selectedSpecialty;
    return matchesSearch && matchesSpecialty;
  });

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
      case 'completed': return 'text-green-600 bg-green-100';
      case 'in_progress': return 'text-blue-600 bg-blue-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'disputed': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Patient Dashboard</h1>
        <p className="text-gray-600">Manage your consultations and health records</p>
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
                <Calendar className="h-4 w-4 inline mr-2" />
                My Consultations
              </button>
              <button
                onClick={() => setActiveTab('records')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'records' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <FileText className="h-4 w-4 inline mr-2" />
                Medical NFTs
              </button>
              <button
                onClick={() => setActiveTab('doctors')}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'doctors' 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <User className="h-4 w-4 inline mr-2" />
                Find Doctors
              </button>
            </div>
          </nav>
        </div>

        <div className="lg:w-3/4">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Recent Consultations</h2>
                <button
                  onClick={() => setActiveTab('doctors')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Consultation
                </button>
              </div>

              <div className="grid gap-4">
                {consultations.map((consultation) => (
                  <div key={consultation.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">{consultation.doctorName}</h3>
                        <p className="text-sm text-gray-600 capitalize">{consultation.specialty}</p>
                        {consultation.nftId && (
                          <p className="text-xs text-indigo-600 mt-1">NFT: {consultation.nftId}</p>
                        )}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(consultation.status)}`}>
                        {consultation.status.replace('_', ' ')}
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

                    <div className="flex space-x-3">
                      {consultation.status === 'completed' && (
                        <button 
                          onClick={() => onNavigate('consultation')}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                        >
                          View Diagnosis →
                        </button>
                      )}
                      {consultation.status === 'pending' && (
                        <button className="text-yellow-600 hover:text-yellow-800 text-sm font-medium">
                          Waiting for Doctor →
                        </button>
                      )}
                      {consultation.status === 'in_progress' && (
                        <button 
                          onClick={() => onNavigate('consultation')}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View Progress →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'records' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">My Medical NFTs</h2>
              
              <div className="grid md:grid-cols-2 gap-6">
                {diagnosticNFTs.map((nft) => (
                  <div key={nft.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center">
                        <FileText className="h-8 w-8 text-indigo-600 mr-3" />
                        <div>
                          <h3 className="font-semibold text-gray-900">{nft.tokenId}</h3>
                          <p className="text-sm text-gray-600 capitalize">{nft.specialty}</p>
                        </div>
                      </div>
                      <Bitcoin className="h-6 w-6 text-orange-500" />
                    </div>
                    
                    <div className="space-y-2 text-sm text-gray-600 mb-4">
                      <p><span className="font-medium">Doctor:</span> {nft.doctor}</p>
                      <p><span className="font-medium">Date:</span> {nft.date}</p>
                      <p><span className="font-medium">Diagnosis:</span> {nft.diagnosis}</p>
                      <p><span className="font-medium">Confidence:</span> {nft.confidence}/10</p>
                    </div>
                    
                    <div className="flex space-x-3">
                      <button className="flex-1 bg-gray-100 text-gray-700 px-3 py-2 rounded-md text-sm hover:bg-gray-200 transition-colors">
                        View Record
                      </button>
                      <button 
                        onClick={() => {
                          setActiveTab('doctors');
                          alert('Select a different doctor for a second opinion');
                        }}
                        className="flex-1 bg-indigo-100 text-indigo-700 px-3 py-2 rounded-md text-sm hover:bg-indigo-200 transition-colors"
                      >
                        Second Opinion
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {diagnosticNFTs.length === 0 && (
                <div className="bg-white rounded-lg p-8 text-center">
                  <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No medical records yet</p>
                  <p className="text-sm text-gray-500 mt-2">Complete a consultation to receive your first diagnostic NFT</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'doctors' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search doctors by name or specialty..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                
                <select
                  value={selectedSpecialty}
                  onChange={(e) => setSelectedSpecialty(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">All Specialties</option>
                  {specialties.map(specialty => (
                    <option key={specialty} value={specialty}>
                      {specialty.replace('_', ' ').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-6">
                {filteredDoctors.map((doctor) => (
                  <div key={doctor.address} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center mb-2">
                          <h3 className="text-lg font-semibold text-gray-900 mr-3">{doctor.name}</h3>
                          <div className={`w-3 h-3 rounded-full ${doctor.isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                          <span className="text-sm text-gray-500 ml-2">
                            {doctor.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        
                        <p className="text-gray-600 capitalize mb-2">{doctor.specialty.replace('_', ' ')}</p>
                        <p className="text-xs text-gray-500 mb-3">{doctor.verification}</p>
                        
                        <div className="grid md:grid-cols-3 gap-4 mb-4">
                          <div className="flex items-center text-sm text-gray-600">
                            <Star className="h-4 w-4 mr-1 text-yellow-400" />
                            {doctor.rating} ({doctor.consultations} reviews)
                          </div>
                          <div className="flex items-center text-sm text-gray-600">
                            <Clock className="h-4 w-4 mr-1" />
                            Avg {doctor.responseTime}
                          </div>
                          <div className="flex items-center text-sm text-gray-600">
                            <DollarSign className="h-4 w-4 mr-1" />
                            {doctor.fee} ETH
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {renderStars(doctor.rating)}
                        </div>
                      </div>

                      <div className="ml-6">
                        <button
                          onClick={() => handleBookConsultation(doctor)}
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
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {isBookingOpen && selectedDoctor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Book Consultation with {selectedDoctor.name}
            </h3>
            
            <div className="space-y-4 mb-6">
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium">Specialty:</span> {selectedDoctor.specialty.replace('_', ' ')}</p>
                  <p><span className="font-medium">Rating:</span> {selectedDoctor.rating}/5</p>
                  <p><span className="font-medium">Response Time:</span> {selectedDoctor.responseTime}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Describe your symptoms *
                </label>
                <textarea
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  rows="4"
                  placeholder="Please describe your symptoms in detail..."
                  required
                />
              </div>

              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="urgent"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" 
                />
                <label htmlFor="urgent" className="text-sm text-gray-700">
                  Urgent consultation (+20% fee, 2hr response time)
                </label>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Consultation Fee:</span>
                    <span>{selectedDoctor.fee} ETH</span>
                  </div>
                  {isUrgent && (
                    <div className="flex justify-between text-orange-600">
                      <span>Urgent Fee (+20%):</span>
                      <span>+{(parseFloat(selectedDoctor.fee) * 0.2).toFixed(3)} ETH</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium border-t pt-2">
                    <span>Total:</span>
                    <span>{isUrgent ? (parseFloat(selectedDoctor.fee) * 1.2).toFixed(3) : selectedDoctor.fee} ETH</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>≈ Bitcoin equivalent:</span>
                    <span>~0.00234 BTC</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setIsBookingOpen(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitBooking}
                disabled={!symptoms.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Book & Pay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;