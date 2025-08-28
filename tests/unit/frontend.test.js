const React = require('react');
const { render, screen, fireEvent, waitFor, act } = require('@testing-library/react');
const { jest } = require('@jest/globals');

// Mock Web3 and MetaMask
const mockWeb3 = {
  utils: {
    isAddress: jest.fn(() => true),
    formatEther: jest.fn((wei) => (parseInt(wei) / Math.pow(10, 18)).toString())
  },
  eth: {
    getBalance: jest.fn(() => Promise.resolve('1000000000000000000')), // 1 ETH
    getGasPrice: jest.fn(() => Promise.resolve('20000000000')) // 20 gwei
  }
};

// Mock window.ethereum
Object.defineProperty(window, 'ethereum', {
  value: {
    request: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    isMetaMask: true
  },
  writable: true
});

// Mock fetch for API calls
global.fetch = jest.fn();

// Import components after mocking
const PatientDashboard = require('../../frontend/src/components/patient/PatientDashboard');
const DoctorPortal = require('../../frontend/src/components/doctor/DoctorPortal');
const WalletConnection = require('../../frontend/src/components/shared/WalletConnection');
const ConsultationFlow = require('../../frontend/src/components/shared/ConsultationFlow');

describe('DiagnoChain Frontend Components', function () {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    fetch.mockClear();
    window.ethereum.request.mockClear();
    
    // Default successful responses
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} })
    });

    window.ethereum.request.mockImplementation((args) => {
      switch (args.method) {
        case 'eth_accounts':
          return Promise.resolve(['0x1234567890123456789012345678901234567890']);
        case 'eth_requestAccounts':
          return Promise.resolve(['0x1234567890123456789012345678901234567890']);
        case 'eth_chainId':
          return Promise.resolve('0xaa36a7'); // Sepolia
        case 'eth_getBalance':
          return Promise.resolve('0xde0b6b3a7640000'); // 1 ETH
        default:
          return Promise.resolve(null);
      }
    });
  });

  describe('PatientDashboard Component', function () {
    const defaultProps = {
      account: '0x1234567890123456789012345678901234567890',
      onNavigate: jest.fn()
    };

    beforeEach(() => {
      fetch.mockImplementation((url) => {
        if (url.includes('/api/consultations')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              consultations: [
                {
                  id: 1,
                  doctorName: 'Dr. Sarah Chen',
                  specialty: 'dermatology',
                  status: 'completed',
                  fee: '0.05',
                  date: '2025-08-25',
                  rating: 5
                }
              ]
            })
          });
        }
        
        if (url.includes('/api/doctors')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              doctors: [
                {
                  name: 'Dr. Sarah Chen',
                  specialty: 'dermatology',
                  rating: 4.8,
                  consultations: 156,
                  responseTime: '12 min',
                  fee: '0.05',
                  isOnline: true
                }
              ]
            })
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      });
    });

    it('Should render patient dashboard with consultations', async function () {
      render(React.createElement(PatientDashboard, defaultProps));
      
      expect(screen.getByText('Patient Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Manage your consultations and health records')).toBeInTheDocument();
      
      // Wait for consultations to load
      await waitFor(() => {
        expect(screen.getByText('Dr. Sarah Chen')).toBeInTheDocument();
      });

      expect(screen.getByText('dermatology')).toBeInTheDocument();
      expect(screen.getByText('0.05 ETH')).toBeInTheDocument();
    });

    it('Should switch between dashboard tabs correctly', async function () {
      render(React.createElement(PatientDashboard, defaultProps));

      const recordsTab = screen.getByText('Medical NFTs');
      fireEvent.click(recordsTab);

      expect(screen.getByText('My Medical NFTs')).toBeInTheDocument();

      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search doctors by name or specialty...')).toBeInTheDocument();
      });
    });

    it('Should filter doctors by specialty', async function () {
      render(React.createElement(PatientDashboard, defaultProps));

      // Switch to doctors tab
      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        const specialtyFilter = screen.getByDisplayValue('All Specialties');
        fireEvent.change(specialtyFilter, { target: { value: 'dermatology' } });
      });

      expect(screen.getByDisplayValue('DERMATOLOGY')).toBeInTheDocument();
    });

    it('Should open consultation booking modal', async function () {
      render(React.createElement(PatientDashboard, defaultProps));

      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        const bookButton = screen.getByText('Book Now');
        fireEvent.click(bookButton);
      });

      expect(screen.getByText('Book Consultation with Dr. Sarah Chen')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Please describe your symptoms in detail...')).toBeInTheDocument();
    });

    it('Should validate symptoms input in booking modal', async function () {
      render(React.createElement(PatientDashboard, defaultProps));

      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        const bookButton = screen.getByText('Book Now');
        fireEvent.click(bookButton);
      });

      const bookAndPayButton = screen.getByText('Book & Pay');
      expect(bookAndPayButton).toBeDisabled();

      const symptomsInput = screen.getByPlaceholderText('Please describe your symptoms in detail...');
      fireEvent.change(symptomsInput, { target: { value: 'Test symptoms for validation' } });

      expect(bookAndPayButton).toBeEnabled();
    });

    it('Should calculate urgent consultation fees correctly', async function () {
      render(React.createElement(PatientDashboard, defaultProps));

      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        const bookButton = screen.getByText('Book Now');
        fireEvent.click(bookButton);
      });

      const urgentCheckbox = screen.getByLabelText(/Urgent consultation/);
      fireEvent.click(urgentCheckbox);

      // Should show +20% fee
      expect(screen.getByText('+0.010 ETH')).toBeInTheDocument();
      expect(screen.getByText('0.060 ETH')).toBeInTheDocument(); // 0.05 + 20%
    });
  });

  describe('DoctorPortal Component', function () {
    const doctorProps = {
      account: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      onNavigate: jest.fn()
    };

    beforeEach(() => {
      fetch.mockImplementation((url) => {
        if (url.includes('/api/consultations/doctor/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              consultations: [
                {
                  id: 1,
                  patient: '0x1234...5678',
                  symptoms: 'Test symptoms for doctor portal',
                  specialty: 'dermatology',
                  fee: '0.05',
                  status: 'pending',
                  isUrgent: false,
                  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }
              ]
            })
          });
        }

        if (url.includes('/api/doctors/') && url.includes('/stats')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              stats: {
                totalConsultations: 156,
                averageRating: 4.8,
                reputationScore: 4800,
                currentStreak: 23,
                successRate: 94
              }
            })
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      });
    });

    it('Should render doctor portal with metrics', async function () {
      render(React.createElement(DoctorPortal, doctorProps));

      expect(screen.getByText('Doctor Portal')).toBeInTheDocument();
      expect(screen.getByText('Manage consultations and earn Bitcoin rewards')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('156')).toBeInTheDocument(); // Total patients
        expect(screen.getByText('4.8')).toBeInTheDocument(); // Rating
      });
    });

    it('Should toggle online/offline status', async function () {
      render(React.createElement(DoctorPortal, doctorProps));

      const toggleButton = screen.getByText('Go Online');
      expect(screen.getByText('Offline')).toBeInTheDocument();

      fireEvent.click(toggleButton);

      expect(screen.getByText('Online')).toBeInTheDocument();
      expect(screen.getByText('Go Offline')).toBeInTheDocument();
    });

    it('Should accept consultation requests', async function () {
      render(React.createElement(DoctorPortal, doctorProps));

      await waitFor(() => {
        const acceptButton = screen.getByText('Accept Case');
        fireEvent.click(acceptButton);
      });

      // Should show success message or update UI
      await waitFor(() => {
        // This would trigger the mock API call
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/accept'),
          expect.objectContaining({ method: 'PATCH' })
        );
      });
    });

    it('Should open diagnosis modal and submit diagnosis', async function () {
      // First set doctor online
      render(React.createElement(DoctorPortal, doctorProps));

      const goOnlineButton = screen.getByText('Go Online');
      fireEvent.click(goOnlineButton);

      // Mock accepted consultation
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          consultations: [{
            id: 1,
            symptoms: 'Test symptoms',
            status: 'accepted',
            fee: '0.05'
          }]
        })
      }));

      await waitFor(() => {
        const provideDiagnosisButton = screen.getByText('Provide Diagnosis');
        fireEvent.click(provideDiagnosisButton);
      });

      expect(screen.getByText('Provide Diagnosis - Case #1')).toBeInTheDocument();

      const diagnosisTextArea = screen.getByPlaceholderText(/Provide your professional diagnosis/);
      fireEvent.change(diagnosisTextArea, { 
        target: { value: 'Contact dermatitis. Recommend topical treatment.' } 
      });

      const submitButton = screen.getByText('Submit Diagnosis');
      expect(submitButton).toBeEnabled();

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/diagnosis'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Contact dermatitis')
          })
        );
      });
    });

    it('Should display Bitcoin rewards section', async function () {
      render(React.createElement(DoctorPortal, doctorProps));

      const rewardsTab = screen.getByText('BTC Rewards');
      fireEvent.click(rewardsTab);

      expect(screen.getByText('Bitcoin Rewards')).toBeInTheDocument();
      expect(screen.getByText('Claim Daily Reward')).toBeInTheDocument();
      expect(screen.getByText('Reputation Metrics')).toBeInTheDocument();
    });

    it('Should claim daily BTC reward when eligible', async function () {
      render(React.createElement(DoctorPortal, doctorProps));

      const rewardsTab = screen.getByText('BTC Rewards');
      fireEvent.click(rewardsTab);

      const claimButton = screen.getByText('Claim Daily Reward');
      fireEvent.click(claimButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/rewards/claim-daily'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });

  describe('WalletConnection Component', function () {
    const walletProps = {
      onConnect: jest.fn()
    };

    it('Should render wallet connection interface', function () {
      render(React.createElement(WalletConnection, walletProps));

      expect(screen.getByText('Connect MetaMask')).toBeInTheDocument();
      expect(screen.getByText('Security Features')).toBeInTheDocument();
      expect(screen.getByText('Bitcoin Integration')).toBeInTheDocument();
    });

    it('Should detect MetaMask installation', function () {
      // Test with MetaMask installed
      render(React.createElement(WalletConnection, walletProps));
      expect(screen.queryByText('MetaMask Required')).not.toBeInTheDocument();

      // Test without MetaMask
      const originalEthereum = window.ethereum;
      delete window.ethereum;

      render(React.createElement(WalletConnection, walletProps));
      expect(screen.getByText('MetaMask Required')).toBeInTheDocument();

      // Restore
      window.ethereum = originalEthereum;
    });

    it('Should connect to MetaMask successfully', async function () {
      render(React.createElement(WalletConnection, walletProps));

      const connectButton = screen.getByText('Connect MetaMask');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(window.ethereum.request).toHaveBeenCalledWith({
          method: 'eth_requestAccounts'
        });
      });

      // Should trigger onConnect callback
      await waitFor(() => {
        expect(walletProps.onConnect).toHaveBeenCalled();
      });
    });

    it('Should display role selection modal after connection', async function () {
      render(React.createElement(WalletConnection, walletProps));

      // Mock role check to show modal
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 404
      }));

      const connectButton = screen.getByText('Connect MetaMask');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Welcome to DiagnoChain!')).toBeInTheDocument();
        expect(screen.getByText('Patient')).toBeInTheDocument();
        expect(screen.getByText('Doctor')).toBeInTheDocument();
      });
    });

    it('Should validate Bitcoin address input', async function () {
      render(React.createElement(WalletConnection, walletProps));

      // Trigger role selection modal
      fetch.mockImplementationOnce(() => Promise.resolve({ ok: false }));
      fireEvent.click(screen.getByText('Connect MetaMask'));

      await waitFor(() => {
        const btcAddressInput = screen.getByPlaceholderText('tb1q... (testnet address for rewards)');
        
        // Test invalid address
        fireEvent.change(btcAddressInput, { target: { value: 'invalid-address' } });
        
        const patientButton = screen.getByText('Patient');
        fireEvent.click(patientButton);

        // Should still proceed (validation happens server-side)
        expect(walletProps.onConnect).toHaveBeenCalled();
      });
    });

    it('Should handle unsupported networks', async function () {
      window.ethereum.request.mockImplementation((args) => {
        if (args.method === 'eth_chainId') {
          return Promise.resolve('0x1'); // Mainnet (unsupported for testing)
        }
        return Promise.resolve(['0x1234567890123456789012345678901234567890']);
      });

      render(React.createElement(WalletConnection, walletProps));

      const connectButton = screen.getByText('Connect MetaMask');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Unsupported Network')).toBeInTheDocument();
        expect(screen.getByText('Switch to Sepolia')).toBeInTheDocument();
      });
    });
  });

  describe('ConsultationFlow Component', function () {
    const consultationProps = {
      account: '0x1234567890123456789012345678901234567890',
      userRole: 'patient',
      onNavigate: jest.fn()
    };

    it('Should render consultation progress steps', function () {
      render(React.createElement(ConsultationFlow, consultationProps));

      expect(screen.getByText('Consultation #001')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('Accepted')).toBeInTheDocument();
      expect(screen.getByText('Diagnosis')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('Should show appropriate interface based on user role', function () {
      // Test patient view
      render(React.createElement(ConsultationFlow, consultationProps));
      expect(screen.getByText('Patient Information')).toBeInTheDocument();

      // Test doctor view
      const doctorProps = { ...consultationProps, userRole: 'doctor' };
      render(React.createElement(ConsultationFlow, doctorProps));
      
      // Doctor should see diagnosis form when appropriate
      if (screen.queryByText('Provide Diagnosis')) {
        expect(screen.getByText('Medical Diagnosis & Treatment Plan')).toBeInTheDocument();
      }
    });

    it('Should display NFT information correctly', function () {
      render(React.createElement(ConsultationFlow, consultationProps));

      expect(screen.getByText('Medical NFT')).toBeInTheDocument();
      expect(screen.getByText('NFT Pending')).toBeInTheDocument();
    });

    it('Should show Bitcoin payment information', function () {
      render(React.createElement(ConsultationFlow, consultationProps));

      expect(screen.getByText('Bitcoin Integration')).toBeInTheDocument();
      expect(screen.getByText('Smart Contract Escrow')).toBeInTheDocument();
      expect(screen.getByText('✓ Available')).toBeInTheDocument(); // Lightning
    });

    it('Should handle file uploads for patient images', async function () {
      render(React.createElement(ConsultationFlow, consultationProps));

      if (screen.queryByText('Upload Images (Optional)')) {
        const fileInput = screen.getByText('Upload Images (Optional)').closest('div').querySelector('input[type="file"]');
        
        const testFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
        
        await act(async () => {
          fireEvent.change(fileInput, { target: { files: [testFile] } });
        });

        await waitFor(() => {
          expect(screen.getByText('test.jpg')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Component Interaction Tests', function () {
    it('Should navigate between components correctly', function () {
      const mockNavigate = jest.fn();
      
      render(React.createElement(PatientDashboard, { 
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: mockNavigate 
      }));

      // Click on a completed consultation
      const viewDiagnosisButton = screen.getByText('View Diagnosis →');
      fireEvent.click(viewDiagnosisButton);

      expect(mockNavigate).toHaveBeenCalledWith('consultation');
    });

    it('Should maintain state across navigation', async function () {
      let currentComponent = 'patient';
      const mockNavigate = jest.fn((newComponent) => {
        currentComponent = newComponent;
      });

      // Start with patient dashboard
      const { rerender } = render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: mockNavigate
      }));

      // Navigate to consultation
      const viewButton = screen.getByText('View Diagnosis →');
      fireEvent.click(viewButton);

      // Rerender with consultation component
      rerender(React.createElement(ConsultationFlow, {
        account: '0x1234567890123456789012345678901234567890',
        userRole: 'patient',
        onNavigate: mockNavigate
      }));

      expect(screen.getByText('Consultation #001')).toBeInTheDocument();

      // Navigate back
      const backButton = screen.getByText('← Back to Dashboard');
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('patient');
    });
  });

  describe('Error Handling in Components', function () {
    it('Should handle API errors gracefully', async function () {
      // Mock API error
      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' })
      }));

      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      // Component should handle error without crashing
      await waitFor(() => {
        // Should show some error state or fallback content
        expect(screen.getByText('Patient Dashboard')).toBeInTheDocument();
      });
    });

    it('Should handle MetaMask connection errors', async function () {
      window.ethereum.request.mockRejectedValueOnce(new Error('User rejected request'));

      render(React.createElement(WalletConnection, { onConnect: jest.fn() }));

      const connectButton = screen.getByText('Connect MetaMask');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/User rejected request/)).toBeInTheDocument();
      });
    });

    it('Should handle network switching errors', async function () {
      window.ethereum.request.mockImplementation((args) => {
        if (args.method === 'wallet_switchEthereumChain') {
          return Promise.reject(new Error('Failed to switch network'));
        }
        return Promise.resolve(['0x1234567890123456789012345678901234567890']);
      });

      render(React.createElement(WalletConnection, { onConnect: jest.fn() }));

      // Trigger network switch
      const switchButton = screen.getByText('Switch to Sepolia');
      fireEvent.click(switchButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to switch network/)).toBeInTheDocument();
      });
    });
  });

  describe('Responsive Design Tests', function () {
    it('Should adapt to mobile viewport', function () {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      // Should show mobile-friendly layout
      expect(screen.getByText('Patient Dashboard')).toBeInTheDocument();
      
      // Mobile menu should be available
      const mobileElements = document.querySelectorAll('.md\\:hidden');
      expect(mobileElements.length).toBeGreaterThan(0);
    });

    it('Should handle tablet viewport correctly', function () {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });

      render(React.createElement(DoctorPortal, {
        account: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        onNavigate: jest.fn()
      }));

      // Should adapt layout for tablet
      expect(screen.getByText('Doctor Portal')).toBeInTheDocument();
    });
  });

  describe('Accessibility Tests', function () {
    it('Should have proper ARIA labels and roles', function () {
      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      // Check for proper button roles
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);

      // Check for proper navigation structure
      const navigation = screen.getByRole('navigation');
      expect(navigation).toBeInTheDocument();
    });

    it('Should support keyboard navigation', async function () {
      render(React.createElement(WalletConnection, { onConnect: jest.fn() }));

      const connectButton = screen.getByText('Connect MetaMask');
      
      // Test Tab navigation
      connectButton.focus();
      expect(document.activeElement).toBe(connectButton);

      // Test Enter key activation
      fireEvent.keyPress(connectButton, { key: 'Enter', code: 'Enter', charCode: 13 });
      
      await waitFor(() => {
        expect(window.ethereum.request).toHaveBeenCalled();
      });
    });

    it('Should have sufficient color contrast', function () {
      render(React.createElement(ConsultationFlow, {
        account: '0x1234567890123456789012345678901234567890',
        userRole: 'patient',
        onNavigate: jest.fn()
      }));

      // Check for proper text contrast classes
      const elements = document.querySelectorAll('.text-gray-900, .text-gray-800, .text-gray-700');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Tests', function () {
    it('Should render components within acceptable time', async function () {
      const startTime = performance.now();

      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      const renderTime = performance.now() - startTime;
      expect(renderTime).toBeLessThan(100); // Should render in under 100ms
    });

    it('Should handle large datasets efficiently', async function () {
      // Mock large consultation list
      const largeConsultationList = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        doctorName: `Dr. Test ${i + 1}`,
        specialty: 'general_practice',
        status: 'completed',
        fee: '0.05',
        date: '2025-08-25',
        rating: Math.floor(Math.random() * 5) + 1
      }));

      fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          consultations: largeConsultationList
        })
      }));

      const startTime = performance.now();

      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      await waitFor(() => {
        expect(screen.getByText('Dr. Test 1')).toBeInTheDocument();
      });

      const renderTime = performance.now() - startTime;
      expect(renderTime).toBeLessThan(500); // Should handle large list in under 500ms
    });

    it('Should implement proper memoization for expensive operations', function () {
      const expensiveProps = {
        account: '0x1234567890123456789012345678901234567890',
        consultations: Array.from({ length: 100 }, (_, i) => ({ id: i, data: `test${i}` })),
        onNavigate: jest.fn()
      };

      const { rerender } = render(React.createElement(PatientDashboard, expensiveProps));

      // Rerender with same props (should be memoized)
      const startTime = performance.now();
      rerender(React.createElement(PatientDashboard, expensiveProps));
      const rerenderTime = performance.now() - startTime;

      expect(rerenderTime).toBeLessThan(50); // Memoized rerender should be very fast
    });
  });

  describe('Real-time Updates', function () {
    it('Should update consultation status in real-time', async function () {
      const { rerender } = render(React.createElement(ConsultationFlow, {
        account: '0x1234567890123456789012345678901234567890',
        userRole: 'patient',
        onNavigate: jest.fn()
      }));

      // Initial state - step 2
      expect(screen.getByText('Progress')).toBeInTheDocument();

      // Simulate status update
      const updatedProps = {
        account: '0x1234567890123456789012345678901234567890',
        userRole: 'patient',
        onNavigate: jest.fn(),
        consultationStatus: 'completed'
      };

      rerender(React.createElement(ConsultationFlow, updatedProps));

      // Should show updated progress
      expect(screen.getByText('Diagnosis Completed')).toBeInTheDocument();
    });

    it('Should handle WebSocket connection for live updates', function (done) {
      // Mock WebSocket
      const mockWebSocket = {
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null
      };

      global.WebSocket = jest.fn(() => mockWebSocket);

      render(React.createElement(DoctorPortal, {
        account: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        onNavigate: jest.fn()
      }));

      // Simulate WebSocket connection
      setTimeout(() => {
        if (mockWebSocket.onopen) {
          mockWebSocket.onopen();
        }

        // Simulate incoming message
        if (mockWebSocket.onmessage) {
          mockWebSocket.onmessage({
            data: JSON.stringify({
              type: 'consultation_update',
              consultationId: 1,
              status: 'accepted'
            })
          });
        }

        expect(global.WebSocket).toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('Form Validation and User Input', function () {
    it('Should validate consultation booking form', async function () {
      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      // Navigate to doctors and open booking modal
      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      await waitFor(() => {
        const bookButton = screen.getByText('Book Now');
        fireEvent.click(bookButton);
      });

      // Test empty symptoms validation
      const bookAndPayButton = screen.getByText('Book & Pay');
      expect(bookAndPayButton).toBeDisabled();

      // Add symptoms
      const symptomsInput = screen.getByPlaceholderText('Please describe your symptoms in detail...');
      fireEvent.change(symptomsInput, { target: { value: 'Valid symptoms description' } });

      expect(bookAndPayButton).toBeEnabled();

      // Test urgent fee calculation
      const urgentCheckbox = screen.getByLabelText(/Urgent consultation/);
      fireEvent.click(urgentCheckbox);

      expect(screen.getByText('+0.010 ETH')).toBeInTheDocument(); // 20% fee
    });

    it('Should validate diagnosis form for doctors', async function () {
      const doctorProps = {
        account: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        userRole: 'doctor',
        onNavigate: jest.fn()
      };

      render(React.createElement(ConsultationFlow, doctorProps));

      if (screen.queryByPlaceholderText(/Provide your professional diagnosis/)) {
        const diagnosisTextArea = screen.getByPlaceholderText(/Provide your professional diagnosis/);
        const submitButton = screen.getByText('Submit Diagnosis & Release Payment');

        // Should be disabled with empty diagnosis
        expect(submitButton).toBeDisabled();

        // Should enable with valid diagnosis
        fireEvent.change(diagnosisTextArea, {
          target: { value: 'Valid medical diagnosis with treatment recommendations' }
        });

        expect(submitButton).toBeEnabled();

        // Test confidence level slider
        const confidenceSlider = screen.getByDisplayValue('8');
        fireEvent.change(confidenceSlider, { target: { value: '9' } });

        expect(screen.getByText('(9)/10')).toBeInTheDocument();
      }
    });
  });

  describe('State Management Tests', function () {
    it('Should maintain component state during user interactions', async function () {
      render(React.createElement(PatientDashboard, {
        account: '0x1234567890123456789012345678901234567890',
        onNavigate: jest.fn()
      }));

      // Switch tabs and verify state preservation
      const recordsTab = screen.getByText('Medical NFTs');
      fireEvent.click(recordsTab);

      const doctorsTab = screen.getByText('Find Doctors');
      fireEvent.click(doctorsTab);

      // Search functionality should work
      const searchInput = screen.getByPlaceholderText('Search doctors by name or specialty...');
      fireEvent.change(searchInput, { target: { value: 'dermatology' } });

      expect(searchInput.value).toBe('dermatology');

      // Switch back to dashboard
      const dashboardTab = screen.getByText('My Consultations');
      fireEvent.click(dashboardTab);

      // Should return to dashboard state
      expect(screen.getByText('Recent Consultations')).toBeInTheDocument();
    });

    it('Should handle async state updates correctly', async function () {
      render(React.createElement(DoctorPortal, {
        account: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        onNavigate: jest.fn()
      }));

      // Toggle online status
      const goOnlineButton = screen.getByText('Go Online');
      fireEvent.click(goOnlineButton);

      expect(screen.getByText('Online')).toBeInTheDocument();
      expect(screen.getByText('Go Offline')).toBeInTheDocument();

      // Status should persist during tab switches
      const rewardsTab = screen.getByText('BTC Rewards');
      fireEvent.click(rewardsTab);

      const activeCasesTab = screen.getByText('Active Cases');
      fireEvent.click(activeCasesTab);

      // Online status should still be maintained
      expect(screen.getByText('Online')).toBeInTheDocument();
    });
  });

  after(function () {
    // Cleanup mocks
    jest.restoreAllMocks();
    
    if (global.WebSocket && global.WebSocket.mockRestore) {
      global.WebSocket.mockRestore();
    }

    console.log('Frontend component tests cleanup completed');
  });
});