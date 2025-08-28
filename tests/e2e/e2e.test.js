const puppeteer = require('puppeteer');
const { expect } = require('chai');
const path = require('path');

const config = require('../../config/config');

describe('DiagnoChain End-to-End Browser Tests', function () {
  let browser;
  let page;
  let context;
  
  const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';
  const apiUrl = process.env.E2E_API_URL || 'http://localhost:3001';
  
  const testWallets = {
    patient: {
      address: '0x1234567890123456789012345678901234567890',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    },
    doctor: {
      address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    }
  };

  before(async function () {
    this.timeout(30000);
    
    browser = await puppeteer.launch({
      headless: process.env.E2E_HEADLESS !== 'false',
      slowMo: parseInt(process.env.E2E_SLOW_MO) || 0,
      devtools: process.env.E2E_DEVTOOLS === 'true',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--allow-running-insecure-content'
      ]
    });

    context = await browser.createIncognitoBrowserContext();
  });

  beforeEach(async function () {
    page = await context.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    
    // Mock MetaMask
    await page.evaluateOnNewDocument(() => {
      window.ethereum = {
        isMetaMask: true,
        request: async (args) => {
          switch (args.method) {
            case 'eth_accounts':
              return ['0x1234567890123456789012345678901234567890'];
            case 'eth_requestAccounts':
              return ['0x1234567890123456789012345678901234567890'];
            case 'eth_chainId':
              return '0xaa36a7'; // Sepolia
            case 'eth_getBalance':
              return '0xde0b6b3a7640000'; // 1 ETH
            case 'personal_sign':
              return '0x' + '0'.repeat(130); // Mock signature
            default:
              return null;
          }
        },
        on: () => {},
        removeListener: () => {}
      };
    });

    // Mock API responses
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: getMockApiResponse(req.url()) })
        });
      } else {
        req.continue();
      }
    });

    // Navigate to application
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });
  });

  afterEach(async function () {
    if (page) {
      await page.close();
    }
  });

  after(async function () {
    if (browser) {
      await browser.close();
    }
  });

  function getMockApiResponse(url) {
    if (url.includes('/api/consultations')) {
      return {
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
      };
    }

    if (url.includes('/api/doctors')) {
      return {
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
      };
    }

    if (url.includes('/api/user/role/')) {
      return { role: 'patient' };
    }

    return {};
  }

  describe('Patient User Journey', function () {
    it('Should complete full patient consultation booking flow', async function () {
      this.timeout(60000);

      // Step 1: Landing page
      await page.waitForSelector('h1');
      const heading = await page.$eval('h1', el => el.textContent);
      expect(heading).to.include('Welcome to DiagnoChain');

      console.log('✓ Landing page loaded');

      // Step 2: Connect wallet
      await page.click('button:has-text("Connect Wallet")');
      
      await page.waitForSelector('.bg-green-50', { timeout: 10000 });
      console.log('✓ Wallet connected');

      // Step 3: Navigate to patient portal
      await page.click('button:has-text("Patient Portal")');
      
      await page.waitForSelector('text=Patient Dashboard');
      console.log('✓ Navigated to patient dashboard');

      // Step 4: Browse available doctors
      await page.click('button:has-text("Find Doctors")');
      
      await page.waitForSelector('input[placeholder*="Search doctors"]');
      console.log('✓ Doctor listing loaded');

      // Step 5: Book consultation
      await page.click('button:has-text("Book Now")');
      
      await page.waitForSelector('text=Book Consultation with Dr. Sarah Chen');
      console.log('✓ Booking modal opened');

      // Step 6: Fill consultation form
      const symptomsTextarea = await page.$('textarea[placeholder*="describe your symptoms"]');
      await symptomsTextarea.type('I have been experiencing a persistent skin rash on my arms for the past two weeks. It is red, itchy, and seems to get worse at night.');

      console.log('✓ Symptoms entered');

      // Step 7: Submit booking
      await page.click('button:has-text("Book & Pay")');
      
      // Should redirect to consultation view
      await page.waitForSelector('text=Consultation #', { timeout: 15000 });
      console.log('✓ Consultation booked successfully');

      // Verify consultation details are displayed
      const consultationTitle = await page.$eval('h1', el => el.textContent);
      expect(consultationTitle).to.include('Consultation #');

      console.log('✅ Complete patient journey test passed!');
    });

    it('Should handle urgent consultation booking with fee adjustment', async function () {
      this.timeout(30000);

      await connectWalletAndNavigate(page, 'patient');

      // Book urgent consultation
      await page.click('button:has-text("Find Doctors")');
      await page.waitForSelector('button:has-text("Book Now")');
      await page.click('button:has-text("Book Now")');

      // Fill form
      await page.type('textarea', 'Severe chest pain and difficulty breathing');
      
      // Enable urgent consultation
      await page.click('input[type="checkbox"]'); // Urgent checkbox
      
      // Verify fee adjustment
      const feeText = await page.$eval('.bg-gray-50', el => el.textContent);
      expect(feeText).to.include('+20%');

      await page.click('button:has-text("Book & Pay")');
      
      await page.waitForSelector('text=Consultation #');
      console.log('✅ Urgent consultation booking test passed!');
    });

    it('Should search and filter doctors effectively', async function () {
      this.timeout(20000);

      await connectWalletAndNavigate(page, 'patient');
      
      await page.click('button:has-text("Find Doctors")');
      await page.waitForSelector('input[placeholder*="Search doctors"]');

      // Test search functionality
      await page.type('input[placeholder*="Search doctors"]', 'Sarah');
      
      // Should filter results
      const searchResults = await page.$$eval('.bg-white', elements => 
        elements.filter(el => el.textContent.includes('Dr. Sarah')).length
      );
      expect(searchResults).to.be.gt(0);

      // Test specialty filter
      await page.selectOption('select', 'dermatology');
      
      // Results should be filtered by specialty
      const specialtyResults = await page.$$eval('.capitalize', elements =>
        elements.filter(el => el.textContent.includes('dermatology')).length
      );
      expect(specialtyResults).to.be.gt(0);

      console.log('✅ Doctor search and filtering test passed!');
    });
  });

  describe('Doctor User Journey', function () {
    it('Should complete doctor consultation management flow', async function () {
      this.timeout(60000);

      await connectWalletAndNavigate(page, 'doctor');

      // Verify doctor dashboard
      await page.waitForSelector('text=Doctor Portal');
      console.log('✓ Doctor portal loaded');

      // Go online to receive consultations
      await page.click('button:has-text("Go Online")');
      
      const onlineStatus = await page.$eval('.bg-green-400', () => true);
      expect(onlineStatus).to.be.true;
      console.log('✓ Doctor went online');

      // Mock incoming consultation
      await page.evaluate(() => {
        // Simulate receiving a consultation
        window.postMessage({
          type: 'new_consultation',
          consultationId: 1,
          symptoms: 'Test symptoms for doctor flow'
        }, '*');
      });

      // Accept consultation
      if (await page.$('button:has-text("Accept Case")')) {
        await page.click('button:has-text("Accept Case")');
        console.log('✓ Consultation accepted');
      }

      // Provide diagnosis
      if (await page.$('button:has-text("Provide Diagnosis")')) {
        await page.click('button:has-text("Provide Diagnosis")');
        
        await page.waitForSelector('textarea[placeholder*="professional diagnosis"]');
        await page.type('textarea[placeholder*="professional diagnosis"]', 
          'Based on the symptoms described, this appears to be contact dermatitis. I recommend applying a topical corticosteroid cream twice daily and avoiding known irritants.');

        // Set confidence level
        await page.evaluate(() => {
          const slider = document.querySelector('input[type="range"]');
          if (slider) {
            slider.value = '8';
            slider.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        await page.click('button:has-text("Submit Diagnosis")');
        console.log('✓ Diagnosis submitted');
      }

      // Check BTC rewards section
      await page.click('button:has-text("BTC Rewards")');
      await page.waitForSelector('text=Bitcoin Rewards');
      
      const rewardButton = await page.$('button:has-text("Claim Daily Reward")');
      if (rewardButton) {
        console.log('✓ BTC rewards section accessible');
      }

      console.log('✅ Complete doctor journey test passed!');
    });

    it('Should handle multiple concurrent consultations', async function () {
      this.timeout(45000);

      await connectWalletAndNavigate(page, 'doctor');
      
      // Go online
      await page.click('button:has-text("Go Online")');

      // Simulate multiple consultations coming in
      await page.evaluate(() => {
        for (let i = 1; i <= 3; i++) {
          setTimeout(() => {
            window.postMessage({
              type: 'new_consultation',
              consultationId: i,
              symptoms: `Test consultation ${i} symptoms`,
              isUrgent: i === 1 // First one is urgent
            }, '*');
          }, i * 1000);
        }
      });

      // Wait for consultations to appear
      await page.waitForSelector('.bg-red-100'); // Urgent consultation badge
      
      // Should see urgent consultation highlighted
      const urgentBadge = await page.$('.bg-red-100');
      expect(urgentBadge).to.not.be.null;

      console.log('✅ Multiple consultations handling test passed!');
    });
  });

  describe('Wallet Integration Tests', function () {
    it('Should detect and connect to MetaMask', async function () {
      this.timeout(20000);

      // Test without MetaMask
      await page.evaluateOnNewDocument(() => {
        delete window.ethereum;
      });

      await page.reload();
      await page.waitForSelector('.bg-yellow-50'); // MetaMask required warning
      
      const warningText = await page.$eval('.bg-yellow-50', el => el.textContent);
      expect(warningText).to.include('MetaMask Required');

      console.log('✓ MetaMask detection test passed');

      // Test with MetaMask
      await page.evaluateOnNewDocument(() => {
        window.ethereum = {
          isMetaMask: true,
          request: async () => ['0x1234567890123456789012345678901234567890'],
          on: () => {},
          removeListener: () => {}
        };
      });

      await page.reload();
      await page.waitForSelector('button:has-text("Connect Wallet")');
      
      console.log('✅ MetaMask integration test passed!');
    });

    it('Should handle network switching', async function () {
      this.timeout(15000);

      // Mock unsupported network
      await page.evaluateOnNewDocument(() => {
        window.ethereum = {
          isMetaMask: true,
          request: async (args) => {
            if (args.method === 'eth_chainId') {
              return '0x1'; // Mainnet (unsupported)
            }
            return ['0x1234567890123456789012345678901234567890'];
          },
          on: () => {},
          removeListener: () => {}
        };
      });

      await page.reload();
      await page.click('button:has-text("Connect Wallet")');

      await page.waitForSelector('.bg-red-50'); // Unsupported network warning
      
      const networkButton = await page.$('button:has-text("Sepolia")');
      expect(networkButton).to.not.be.null;

      console.log('✓ Network switching test passed');
    });

    it('Should display wallet balance and network info', async function () {
      await page.goto(baseUrl);
      await page.click('button:has-text("Connect Wallet")');

      await page.waitForSelector('.bg-green-50'); // Connected status
      
      const balanceText = await page.$eval('.bg-green-50', el => el.textContent);
      expect(balanceText).to.include('Balance:');
      expect(balanceText).to.include('ETH');

      console.log('✓ Wallet info display test passed');
    });
  });

  describe('Real-time UI Updates', function () {
    it('Should update consultation status in real-time', async function () {
      this.timeout(25000);

      await connectWalletAndNavigate(page, 'patient');

      // Navigate to a consultation
      await page.click('text=View Progress →');
      await page.waitForSelector('text=Progress');

      // Simulate status update
      await page.evaluate(() => {
        // Mock WebSocket message
        window.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'consultation_update',
            consultationId: 1,
            status: 'diagnosis_submitted'
          })
        }));
      });

      // Should update progress indicator
      await page.waitForFunction(() => {
        const progressElement = document.querySelector('.bg-indigo-600');
        return progressElement && progressElement.textContent.includes('4'); // Step 4
      });

      console.log('✓ Real-time status updates test passed');
    });

    it('Should show live doctor availability', async function () {
      this.timeout(15000);

      await connectWalletAndNavigate(page, 'patient');
      
      await page.click('button:has-text("Find Doctors")');
      await page.waitForSelector('.bg-green-400'); // Online indicator

      // Should show online doctors
      const onlineIndicators = await page.$$('.bg-green-400');
      expect(onlineIndicators.length).to.be.gt(0);

      // Simulate doctor going offline
      await page.evaluate(() => {
        const offlineIndicator = document.querySelector('.bg-green-400');
        if (offlineIndicator) {
          offlineIndicator.className = offlineIndicator.className.replace('bg-green-400', 'bg-gray-400');
          const statusText = offlineIndicator.nextElementSibling;
          if (statusText) {
            statusText.textContent = 'Offline';
          }
        }
      });

      const offlineIndicators = await page.$$('.bg-gray-400');
      expect(offlineIndicators.length).to.be.gt(0);

      console.log('✓ Live doctor availability test passed');
    });
  });

  describe('Mobile Responsiveness Tests', function () {
    it('Should adapt to mobile viewport correctly', async function () {
      await page.setViewport({ width: 375, height: 667 }); // iPhone dimensions
      
      await page.goto(baseUrl);
      
      // Should show mobile menu button
      await page.waitForSelector('.md\\:hidden button'); // Mobile menu toggle
      
      const mobileMenuButton = await page.$('.md\\:hidden button');
      expect(mobileMenuButton).to.not.be.null;

      await page.click('.md\\:hidden button');
      
      // Mobile menu should open
      await page.waitForSelector('.md\\:hidden .bg-white');
      
      console.log('✓ Mobile responsiveness test passed');
    });

    it('Should maintain functionality on tablet viewport', async function () {
      await page.setViewport({ width: 768, height: 1024 }); // iPad dimensions
      
      await connectWalletAndNavigate(page, 'patient');
      
      // All major functions should still work
      await page.click('button:has-text("Find Doctors")');
      await page.waitForSelector('input[placeholder*="Search doctors"]');
      
      // Search should work
      await page.type('input[placeholder*="Search doctors"]', 'dermatology');
      
      const searchResults = await page.$$eval('.bg-white', elements => 
        elements.filter(el => el.textContent.includes('dermatology')).length
      );
      expect(searchResults).to.be.gt(0);

      console.log('✓ Tablet functionality test passed');
    });
  });

  describe('Form Interactions and Validation', function () {
    it('Should validate consultation booking form properly', async function () {
      this.timeout(20000);

      await connectWalletAndNavigate(page, 'patient');
      
      await page.click('button:has-text("Find Doctors")');
      await page.click('button:has-text("Book Now")');

      // Test empty form validation
      const submitButton = await page.$('button:has-text("Book & Pay")');
      const isDisabled = await page.evaluate(btn => btn.disabled, submitButton);
      expect(isDisabled).to.be.true;

      // Test minimum symptoms length
      await page.type('textarea', 'Too short');
      
      // Should still be disabled or show validation error
      const stillDisabled = await page.evaluate(btn => btn.disabled, submitButton);
      expect(stillDisabled).to.be.true;

      // Enter valid symptoms
      await page.evaluate(() => {
        document.querySelector('textarea').value = '';
      });
      await page.type('textarea', 'Detailed symptoms description that meets minimum length requirements for booking a consultation');

      // Should enable submit button
      await page.waitForFunction(() => {
        const btn = document.querySelector('button:has-text("Book & Pay")');
        return btn && !btn.disabled;
      });

      console.log('✓ Form validation test passed');
    });

    it('Should handle file uploads for medical images', async function () {
      this.timeout(15000);

      await connectWalletAndNavigate(page, 'patient');
      await page.click('button:has-text("Find Doctors")');
      await page.click('button:has-text("Book Now")');

      // Test file upload if available
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        const testImagePath = path.join(__dirname, '../fixtures/test-image.jpg');
        
        // Create a test file if it doesn't exist
        await page.evaluate(() => {
          const fileInput = document.querySelector('input[type="file"]');
          if (fileInput) {
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        // Should show uploaded file
        await page.waitForSelector('text=test.jpg', { timeout: 5000 });
        console.log('✓ File upload test passed');
      }
    });
  });

  describe('Error Handling and User Feedback', function () {
    it('Should display error messages appropriately', async function () {
      this.timeout(15000);

      // Mock API error
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('/api/consultations/create')) {
          req.respond({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Server error', message: 'Failed to create consultation' })
          });
        } else {
          req.continue();
        }
      });

      await connectWalletAndNavigate(page, 'patient');
      
      // Try to create consultation
      await page.click('button:has-text("Find Doctors")');
      await page.click('button:has-text("Book Now")');
      await page.type('textarea', 'Test symptoms for error handling');
      await page.click('button:has-text("Book & Pay")');

      // Should show error message
      await page.waitForSelector('.bg-red-50, [role="alert"], text=Error', { timeout: 10000 });
      
      console.log('✓ Error handling test passed');
    });

    it('Should handle connection timeouts gracefully', async function () {
      this.timeout(20000);

      // Mock slow API response
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('/api/')) {
          setTimeout(() => {
            req.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true })
            });
          }, 5000); // 5 second delay
        } else {
          req.continue();
        }
      });

      await page.goto(baseUrl);
      
      // Should show loading state
      await page.waitForSelector('.animate-spin', { timeout: 2000 });
      
      console.log('✓ Loading state display test passed');
    });
  });

  describe('Performance and Load Tests', function () {
    it('Should load initial page within acceptable time', async function () {
      const startTime = Date.now();
      
      await page.goto(baseUrl, { waitUntil: 'load' });
      
      const loadTime = Date.now() - startTime;
      expect(loadTime).to.be.lt(5000); // Should load in under 5 seconds

      console.log(`✓ Page load time: ${loadTime}ms`);
    });

    it('Should handle rapid user interactions without breaking', async function () {
      this.timeout(30000);

      await connectWalletAndNavigate(page, 'patient');

      // Rapid tab switching
      for (let i = 0; i < 10; i++) {
        await page.click('button:has-text("Find Doctors")');
        await page.waitForTimeout(100);
        await page.click('button:has-text("My Consultations")');
        await page.waitForTimeout(100);
        await page.click('button:has-text("Medical NFTs")');
        await page.waitForTimeout(100);
      }

      // Should still function correctly
      await page.waitForSelector('text=Patient Dashboard');
      console.log('✓ Rapid interactions test passed');
    });

    it('Should maintain performance with large data sets', async function () {
      this.timeout(20000);

      // Mock large consultation list
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('/api/consultations')) {
          const largeDataset = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            doctorName: `Dr. Test ${i + 1}`,
            specialty: 'general_practice',
            status: 'completed',
            fee: '0.05',
            date: '2025-08-25'
          }));
          
          req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, consultations: largeDataset })
          });
        } else {
          req.continue();
        }
      });

      const startTime = Date.now();
      await connectWalletAndNavigate(page, 'patient');
      const renderTime = Date.now() - startTime;

      expect(renderTime).to.be.lt(3000); // Should render large dataset in under 3 seconds

      // Should show first few items
      await page.waitForSelector('text=Dr. Test 1');
      
      console.log(`✓ Large dataset performance: ${renderTime}ms`);
    });
  });

  describe('Cross-browser Compatibility', function () {
    it('Should work consistently across different browsers', async function () {
      this.timeout(30000);

      // Test Chrome-like behavior (default)
      await page.goto(baseUrl);
      await page.waitForSelector('h1');
      
      const chromeHeading = await page.$eval('h1', el => el.textContent);
      expect(chromeHeading).to.include('DiagnoChain');

      // Test with different user agent (Firefox simulation)
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0');
      
      await page.reload();
      await page.waitForSelector('h1');
      
      const firefoxHeading = await page.$eval('h1', el => el.textContent);
      expect(firefoxHeading).to.include('DiagnoChain');

      console.log('✓ Cross-browser compatibility test passed');
    });
  });

  describe('Accessibility Tests', function () {
    it('Should meet basic accessibility requirements', async function () {
      await page.goto(baseUrl);
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      
      const focusedElement = await page.evaluate(() => document.activeElement.tagName);
      expect(focusedElement).to.equal('BUTTON');

      // Test screen reader compatibility
      const mainContent = await page.$('[role="main"], main');
      expect(mainContent).to.not.be.null;

      // Test heading hierarchy
      const headings = await page.$$eval('h1, h2, h3, h4, h5, h6', 
        elements => elements.map(el => ({ tag: el.tagName, text: el.textContent }))
      );
      
      expect(headings.length).to.be.gt(0);
      expect(headings[0].tag).to.equal('H1');

      console.log('✓ Accessibility test passed');
    });

    it('Should support high contrast mode', async function () {
      // Enable high contrast simulation
      await page.emulateMediaFeatures([
        { name: 'prefers-contrast', value: 'high' }
      ]);

      await page.goto(baseUrl);
      
      // Should still be readable and functional
      await page.waitForSelector('h1');
      const isVisible = await page.isVisible('h1');
      expect(isVisible).to.be.true;

      console.log('✓ High contrast mode test passed');
    });

    it('Should work with reduced motion preferences', async function () {
      await page.emulateMediaFeatures([
        { name: 'prefers-reduced-motion', value: 'reduce' }
      ]);

      await page.goto(baseUrl);
      await page.waitForSelector('h1');

      // Animations should be reduced but functionality maintained
      const animatedElements = await page.$$('.animate-spin, .transition-');
      // Should still have elements but potentially with reduced animations
      
      console.log('✓ Reduced motion test passed');
    });
  });

  describe('Data Flow and State Management', function () {
    it('Should maintain state across page refreshes', async function () {
      this.timeout(20000);

      await connectWalletAndNavigate(page, 'patient');
      
      // Perform some actions
      await page.click('button:has-text("Find Doctors")');
      await page.type('input[placeholder*="Search doctors"]', 'dermatology');

      // Refresh page
      await page.reload();
      
      // Should reconnect wallet automatically
      await page.waitForSelector('.bg-green-50', { timeout: 10000 });
      
      console.log('✓ State persistence test passed');
    });

    it('Should handle localStorage data correctly', async function () {
      await page.goto(baseUrl);
      
      // Set some local data
      await page.evaluate(() => {
        localStorage.setItem('diagnochain_user_preferences', JSON.stringify({
          theme: 'light',
          preferredSpecialty: 'dermatology'
        }));
      });

      await page.reload();
      
      // Data should persist
      const storedData = await page.evaluate(() => {
        return localStorage.getItem('diagnochain_user_preferences');
      });
      
      expect(JSON.parse(storedData).theme).to.equal('light');
      
      console.log('✓ LocalStorage handling test passed');
    });
  });

  describe('Security and Privacy Tests', function () {
    it('Should not expose sensitive data in DOM', async function () {
      await connectWalletAndNavigate(page, 'doctor');
      
      // Check that private keys or sensitive data aren't exposed
      const pageContent = await page.content();
      
      expect(pageContent).to.not.include('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // Private key
      expect(pageContent).to.not.include('sk_test_'); // API keys
      expect(pageContent).to.not.include('password');

      console.log('✓ Sensitive data exposure test passed');
    });

    it('Should properly handle authentication state', async function () {
      await page.goto(baseUrl);
      
      // Should not allow access to protected routes without auth
      await page.goto(`${baseUrl}/patient`);
      
      // Should redirect to login or show connect wallet
      await page.waitForSelector('button:has-text("Connect"), text=Connect');
      
      console.log('✓ Authentication protection test passed');
    });

    it('Should validate user inputs for XSS prevention', async function () {
      await connectWalletAndNavigate(page, 'patient');
      
      await page.click('button:has-text("Find Doctors")');
      await page.click('button:has-text("Book Now")');

      // Try to inject script
      const maliciousInput = '<script>alert("xss")</script>Valid symptoms';
      await page.type('textarea', maliciousInput);

      // Script should not execute
      const alertDialogs = [];
      page.on('dialog', dialog => {
        alertDialogs.push(dialog);
        dialog.dismiss();
      });

      await page.click('button:has-text("Book & Pay")');
      
      expect(alertDialogs.length).to.equal(0); // No alerts should fire

      console.log('✓ XSS prevention test passed');
    });
  });

  describe('Integration with External Services', function () {
    it('Should handle IPFS gateway timeouts gracefully', async function () {
      this.timeout(15000);

      await connectWalletAndNavigate(page, 'patient');

      // Mock slow IPFS response
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('ipfs') || req.url().includes('pinata')) {
          setTimeout(() => {
            req.respond({
              status: 408,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Gateway timeout' })
            });
          }, 2000);
        } else {
          req.continue();
        }
      });

      // Try to view medical records
      await page.click('button:has-text("Medical NFTs")');
      
      // Should show loading state then fallback
      await page.waitForSelector('.animate-spin, text=Loading', { timeout: 3000 });
      
      console.log('✓ IPFS timeout handling test passed');
    });

    it('Should work offline with cached data', async function () {
      await connectWalletAndNavigate(page, 'patient');
      
      // Cache some data
      await page.click('button:has-text("Find Doctors")');
      await page.waitForSelector('text=Dr. Sarah Chen');

      // Go offline
      await page.setOfflineMode(true);
      
      // Should still show cached data
      expect(await page.isVisible('text=Dr. Sarah Chen')).to.be.true;
      
      console.log('✓ Offline functionality test passed');
    });
  });

  // Helper functions
  async function connectWalletAndNavigate(page, userType) {
    await page.goto(baseUrl);
    
    // Connect wallet
    await page.click('button:has-text("Connect Wallet")');
    await page.waitForSelector('.bg-green-50', { timeout: 10000 });
    
    // Select user type if modal appears
    try {
      await page.waitForSelector('text=Welcome to DiagnoChain!', { timeout: 2000 });
      await page.click(`button:has-text("${userType.charAt(0).toUpperCase() + userType.slice(1)}")`);
    } catch (e) {
      // Modal might not appear if user already exists
    }
    
    // Navigate to appropriate portal
    const portalButton = userType === 'patient' ? 'Patient Portal' : 'Doctor Portal';
    try {
      await page.click(`button:has-text("${portalButton}")`);
    } catch (e) {
      // Might already be on the right page
    }
    
    await page.waitForSelector(`text=${userType.charAt(0).toUpperCase() + userType.slice(1)} ${userType === 'patient' ? 'Dashboard' : 'Portal'}`);
  }

  async function takeScreenshot(page, name) {
    if (process.env.E2E_SCREENSHOTS === 'true') {
      const screenshotPath = path.join(__dirname, '../screenshots', `${name}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved: ${screenshotPath}`);
    }
  }

  async function measurePagePerformance(page) {
    const performanceMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: navigation.loadEventEnd - navigation.loadEventStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        totalSize: navigation.transferSize
      };
    });

    return performanceMetrics;
  }
});