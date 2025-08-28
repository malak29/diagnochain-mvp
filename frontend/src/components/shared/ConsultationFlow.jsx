import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, Clock, CheckCircle, AlertCircle, FileText, 
  Bitcoin, Star, MessageSquare, Upload, Download, Eye 
} from 'lucide-react';

const ConsultationFlow = ({ account, userRole, onNavigate }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [consultationData, setConsultationData] = useState({
    id: 1,
    patient: '0x1234...5678',
    doctor: '0x742d...0abc',
    doctorName: 'Dr. Sarah Chen',
    specialty: 'dermatology',
    symptoms: 'Persistent skin rash on both arms lasting 2 weeks',
    fee: '0.05',
    btcEquivalent: '0.00234',
    status: 'in_progress',
    createdAt: '2025-08-28T14:30:00Z',
    deadline: '2025-08-29T14:30:00Z'
  });
  
  const [diagnosis, setDiagnosis] = useState('');
  const [confidence, setConfidence] = useState(8);
  const [followUp, setFollowUp] = useState('2weeks');
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const steps = [
    { number: 1, title: 'Consultation Created', desc: 'Payment escrowed' },
    { number: 2, title: 'Doctor Acceptance', desc: 'Case assigned' },
    { number: 3, title: 'Diagnosis', desc: 'Medical assessment' },
    { number: 4, title: 'Payment Released', desc: 'NFT minted' },
    { number: 5, title: 'Feedback', desc: 'Rate & review' }
  ];

  useEffect(() => {
    if (consultationData.status === 'pending') setCurrentStep(1);
    else if (consultationData.status === 'accepted') setCurrentStep(2);
    else if (consultationData.status === 'in_progress') setCurrentStep(3);
    else if (consultationData.status === 'completed') setCurrentStep(4);
  }, [consultationData.status]);

  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    setUploadedFiles(prev => [...prev, ...files.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file)
    }))]);
  };

  const submitDiagnosis = async () => {
    try {
      console.log('Submitting diagnosis:', { diagnosis, confidence, followUp });
      
      setConsultationData(prev => ({
        ...prev,
        status: 'completed',
        diagnosis: diagnosis
      }));
      
      setCurrentStep(4);
      
      setTimeout(() => {
        alert('🎉 Payment released! NFT minted successfully.');
        setCurrentStep(5);
      }, 2000);
      
    } catch (error) {
      console.error('Error submitting diagnosis:', error);
    }
  };

  const submitFeedback = async () => {
    try {
      console.log('Submitting feedback:', { rating, feedback });
      alert('Thank you for your feedback!');
      onNavigate('patient');
    } catch (error) {
      console.error('Error submitting feedback:', error);
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <button
          onClick={() => onNavigate(userRole)}
          className="text-indigo-600 hover:text-indigo-800 mb-4 flex items-center text-sm"
        >
          ← Back to {userRole === 'patient' ? 'Dashboard' : 'Portal'}
        </button>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Consultation #{consultationData.id}
        </h1>
        <p className="text-gray-600 capitalize">{consultationData.specialty} consultation</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Progress</h3>
            <p className="text-sm text-gray-600">
              Time remaining: {formatTimeRemaining(consultationData.deadline)}
            </p>
          </div>
          <div className="flex items-center space-x-2 text-sm">
            <Bitcoin className="h-4 w-4 text-orange-500" />
            <span className="text-gray-600">{consultationData.btcEquivalent} BTC</span>
          </div>
        </div>

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
              
              {index < steps.length - 1 && (
                <div className={`hidden md:block absolute h-0.5 w-20 mt-5 ${
                  currentStep > step.number ? 'bg-indigo-600' : 'bg-gray-200'
                }`} style={{ left: `${(index + 1) * 20}%`, transform: 'translateX(-50%)' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {currentStep <= 2 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-4">Patient Information</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Symptoms Description</label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    <p className="text-gray-800">{consultationData.symptoms}</p>
                  </div>
                </div>

                {uploadedFiles.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Uploaded Images</label>
                    <div className="mt-2 grid grid-cols-2 gap-4">
                      {uploadedFiles.map((file, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700">{file.name}</span>
                            <button className="text-indigo-600 hover:text-indigo-800">
                              <Eye className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {userRole === 'patient' && currentStep === 1 && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      Upload Images (Optional)
                    </label>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && userRole === 'doctor' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-4">Provide Diagnosis</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Medical Diagnosis & Treatment Plan
                  </label>
                  <textarea
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    rows="6"
                    placeholder="Provide your professional diagnosis, treatment recommendations, and any additional notes..."
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confidence Level (1-10)
                    </label>
                    <select 
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      {Array.from({ length: 10 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}/10</option>
                      ))}
                    </select>
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

                <button
                  onClick={submitDiagnosis}
                  disabled={!diagnosis.trim()}
                  className="w-full bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Diagnosis & Release Payment
                </button>
              </div>
            </div>
          )}

          {currentStep >= 4 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                <h3 className="font-semibold text-gray-900">Diagnosis Completed</h3>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <p className="text-gray-800 whitespace-pre-wrap">
                  {diagnosis || 'Based on the symptoms described, this appears to be contact dermatitis. Recommend topical corticosteroid and avoiding known irritants. Follow up in 2 weeks if symptoms persist.'}
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="text-gray-600">
                  <span className="font-medium">Confidence:</span> {confidence}/10
                </div>
                <div className="text-gray-600">
                  <span className="font-medium">Follow-up:</span> {followUp.replace('_', ' ')}
                </div>
                <div className="text-gray-600">
                  <span className="font-medium">NFT ID:</span> #DGMR001
                </div>
              </div>

              <div className="mt-4 flex space-x-3">
                <button className="flex items-center bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
                  <Download className="h-4 w-4 mr-2" />
                  Download Report
                </button>
                <button className="flex items-center bg-blue-100 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-200 transition-colors">
                  <FileText className="h-4 w-4 mr-2" />
                  View NFT
                </button>
              </div>
            </div>
          )}

          {currentStep === 5 && userRole === 'patient' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Rate Your Experience</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    How would you rate this consultation?
                  </label>
                  <div className="flex space-x-2">
                    {Array.from({ length: 5 }, (_, i) => (
                      <button
                        key={i + 1}
                        onClick={() => setRating(i + 1)}
                        className="p-2"
                      >
                        <Star 
                          className={`h-8 w-8 ${
                            i < rating 
                              ? 'text-yellow-400 fill-current' 
                              : 'text-gray-300 hover:text-yellow-200'
                          } transition-colors`} 
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Additional Comments (Optional)
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    rows="4"
                    placeholder="Share your experience with this doctor..."
                  />
                </div>

                <button
                  onClick={submitFeedback}
                  disabled={rating === 0}
                  className="w-full bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Feedback
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Consultation Details</h3>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Doctor:</span>
                <span className="text-gray-900">{consultationData.doctorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Specialty:</span>
                <span className="text-gray-900 capitalize">{consultationData.specialty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Fee:</span>
                <span className="text-gray-900">{consultationData.fee} ETH</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">BTC Equivalent:</span>
                <span className="text-gray-900">{consultationData.btcEquivalent} BTC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span className="text-gray-900">
                  {new Date(consultationData.createdAt).toLocaleDateString()}
                </span>
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
                <p className="text-sm text-gray-600">
                  Token ID: #DGMR{String(consultationData.id).padStart(3, '0')}
                </p>
                <p className="text-xs text-gray-500">
                  Your diagnosis is now permanently recorded on the blockchain as an NFT owned by the patient.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center text-gray-500">
                  <Clock className="h-4 w-4 mr-2" />
                  <span className="text-sm">NFT Pending</span>
                </div>
                <p className="text-xs text-gray-500">
                  An immutable diagnostic NFT will be minted upon consultation completion.
                </p>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-6">
            <div className="flex items-center mb-3">
              <Bitcoin className="h-5 w-5 text-orange-600 mr-2" />
              <h3 className="font-semibold text-gray-900">Bitcoin Integration</h3>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Payment Method:</span>
                <span className="text-gray-900">Smart Contract Escrow</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">BTC Address:</span>
                <span className="text-gray-900 text-xs">tb1q...x7y9z</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Lightning:</span>
                <span className="text-green-600">✓ Available</span>
              </div>
            </div>
            
            <p className="text-xs text-gray-500 mt-3">
              Payments are automatically converted to BTC and distributed via Lightning Network for instant settlement.
            </p>
          </div>

          {userRole === 'patient' && currentStep >= 4 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Request Second Opinion</h3>
              <p className="text-sm text-gray-600 mb-4">
                Get an additional professional opinion on your diagnosis from another verified doctor.
              </p>
              <button className="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors text-sm">
                Find Another Doctor
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConsultationFlow;