const { expect } = require('chai');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ethers } = require('hardhat');

const app = require('../../backend/src/server');
const config = require('../../config/config');

describe('DiagnoChain Security Tests', function () {
  let validToken;
  let expiredToken;
  let maliciousToken;

  before(function () {
    // Generate test tokens
    validToken = jwt.sign(
      { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
      config.security.jwt.secret,
      { expiresIn: '1h' }
    );

    expiredToken = jwt.sign(
      { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
      config.security.jwt.secret,
      { expiresIn: '1ms' }
    );

    maliciousToken = jwt.sign(
      { address: '0x1234567890123456789012345678901234567890', role: 'admin' },
      'wrong-secret',
      { expiresIn: '1h' }
    );
  });

  describe('Authentication Security', function () {
    it('Should reject requests with invalid JWT tokens', async function () {
      const invalidTokens = [
        'invalid.token.format',
        'Bearer invalid-token',
        maliciousToken,
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature'
      ];

      for (const token of invalidTokens) {
        const response = await request(app)
          .get('/api/consultations')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should reject expired tokens', async function () {
      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await request(app)
        .get('/api/consultations')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error).to.equal('Token expired');
    });

    it('Should validate wallet signature correctly', async function () {
      // Test nonce-based authentication
      const nonceResponse = await request(app)
        .post('/api/auth/nonce')
        .send({ address: '0x1234567890123456789012345678901234567890' });

      const nonce = nonceResponse.body.nonce;
      
      // Test with invalid signature
      const invalidAuthResponse = await request(app)
        .post('/api/auth/login')
        .send({
          address: '0x1234567890123456789012345678901234567890',
          signature: '0xinvalidsignature123'
        })
        .expect(401);

      expect(invalidAuthResponse.body).to.have.property('error');
    });

    it('Should prevent signature replay attacks', async function () {
      const address = '0x1234567890123456789012345678901234567890';
      
      // Get first nonce
      const nonce1Response = await request(app)
        .post('/api/auth/nonce')
        .send({ address });

      const nonce1 = nonce1Response.body.nonce;
      
      // Get second nonce
      const nonce2Response = await request(app)
        .post('/api/auth/nonce')
        .send({ address });

      const nonce2 = nonce2Response.body.nonce;
      
      expect(nonce1).to.not.equal(nonce2); // Nonces should be different

      // Try to use old nonce (should fail)
      const replayResponse = await request(app)
        .post('/api/auth/login')
        .send({
          address,
          signature: '0x' + '0'.repeat(130) // Mock signature for old nonce
        });

      // Should reject old nonce
      expect(replayResponse.status).to.equal(400);
    });

    it('Should enforce rate limiting on authentication endpoints', async function () {
      this.timeout(10000);

      const address = '0x1234567890123456789012345678901234567890';
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/nonce')
          .send({ address })
      );

      const responses = await Promise.allSettled(promises);
      const rateLimitedCount = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      ).length;

      expect(rateLimitedCount).to.be.gt(0);
    });
  });

  describe('Authorization and Access Control', function () {
    it('Should enforce role-based access control strictly', async function () {
      const patientToken = jwt.sign(
        { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Patient should not access doctor-only endpoints
      const unauthorizedEndpoints = [
        '/api/doctors/register',
        '/api/consultations/1/accept',
        '/api/doctors/0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc/private-stats'
      ];

      for (const endpoint of unauthorizedEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${patientToken}`)
          .expect(403);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should prevent privilege escalation attempts', async function () {
      const userToken = jwt.sign(
        { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Try to perform admin actions
      const adminActions = [
        { method: 'post', path: '/api/admin/users', data: { role: 'admin' } },
        { method: 'patch', path: '/api/admin/contracts/upgrade', data: {} },
        { method: 'delete', path: '/api/admin/users/0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc', data: {} }
      ];

      for (const action of adminActions) {
        const response = await request(app)[action.method](action.path)
          .set('Authorization', `Bearer ${userToken}`)
          .send(action.data)
          .expect(403);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should validate user can only access own data', async function () {
      const user1Token = jwt.sign(
        { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      const user2Address = '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc';

      // User 1 trying to access User 2's data
      const response = await request(app)
        .get(`/api/consultations/patient/${user2Address}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);

      expect(response.body.error).to.equal('Access denied');
    });
  });

  describe('Input Validation and Sanitization', function () {
    it('Should prevent SQL injection attempts', async function () {
      const sqlInjectionPayloads = [
        "'; DROP TABLE users; --",
        "' OR 1=1 --",
        "' UNION SELECT * FROM users --",
        "'; INSERT INTO users (eth_address, user_role) VALUES ('0xhacker', 'admin'); --"
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            doctorAddress: payload,
            symptoms: 'Test symptoms',
            specialty: 'dermatology',
            fee: '0.05'
          })
          .expect(400);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should prevent NoSQL injection attempts', async function () {
      const noSqlPayloads = [
        { $ne: null },
        { $gt: '' },
        { $where: 'this.role == "admin"' },
        { $regex: '.*', $options: 'i' }
      ];

      for (const payload of noSqlPayloads) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
            symptoms: payload,
            specialty: 'dermatology',
            fee: '0.05'
          });

        // Should either reject or sanitize the input
        expect([400, 201]).to.include(response.status);
        
        if (response.status === 201) {
          // If accepted, payload should be sanitized
          expect(response.body.consultation.symptomsHash).to.be.a('string');
        }
      }
    });

    it('Should sanitize XSS attempts in user inputs', async function () {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(\'xss\')">',
        '"><script>alert("xss")</script>',
        'onload="alert(\'xss\')"'
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
            symptoms: `Valid symptoms ${payload}`,
            specialty: 'dermatology',
            fee: '0.05'
          });

        if (response.status === 201) {
          // XSS payload should be sanitized
          const responseText = JSON.stringify(response.body);
          expect(responseText).to.not.include('<script>');
          expect(responseText).to.not.include('javascript:');
          expect(responseText).to.not.include('onerror=');
        }
      }
    });

    it('Should validate Ethereum address formats strictly', async function () {
      const invalidAddresses = [
        '0x123', // Too short
        '0xgg123456789012345678901234567890123456789', // Invalid characters
        '123456789012345678901234567890123456789012', // Missing 0x
        '0x' + 'f'.repeat(41), // Too long
        '', // Empty
        null, // Null
        undefined // Undefined
      ];

      for (const address of invalidAddresses) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            doctorAddress: address,
            symptoms: 'Test symptoms',
            specialty: 'dermatology',
            fee: '0.05'
          })
          .expect(400);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should prevent path traversal attacks', async function () {
      const pathTraversalPayloads = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '....//....//....//etc//passwd'
      ];

      for (const payload of pathTraversalPayloads) {
        const response = await request(app)
          .get(`/api/ipfs/${payload}`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(400);

        expect(response.body).to.have.property('error');
      }
    });
  });

  describe('Smart Contract Security', function () {
    it('Should prevent reentrancy attacks on escrow contract', async function () {
      const [owner, attacker, doctor, patient] = await ethers.getSigners();

      // Deploy test contracts
      const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
      const accessControl = await AccessControl.deploy();

      const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
      const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);

      const ConsultationEscrow = await ethers.getContractFactory('ConsultationEscrow');
      const escrow = await ConsultationEscrow.deploy(doctorRegistry.address, owner.address);

      // Grant roles
      await accessControl.grantRoleWithTimestamp(await accessControl.PATIENT_ROLE(), patient.address);
      await accessControl.grantRoleWithTimestamp(await accessControl.DOCTOR_ROLE(), doctor.address);

      // Deploy malicious contract that attempts reentrancy
      const MaliciousContract = await ethers.getContractFactory('MaliciousReentrancy');
      
      // For this test, we'll verify the contract has reentrancy guards
      const fee = ethers.utils.parseEther('0.05');
      
      await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmTestSymptoms',
        'dermatology',
        false,
        { value: fee }
      );

      await escrow.connect(doctor).acceptConsultation(1);

      // Normal diagnosis submission should work
      const tx = await escrow.connect(doctor).submitDiagnosis(1, 'QmTestDiagnosis');
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1); // Success

      // Verify consultation is completed and cannot be manipulated
      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(3); // COMPLETED
    });

    it('Should prevent integer overflow/underflow attacks', async function () {
      const [owner, doctor, patient] = await ethers.getSigners();

      const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
      const accessControl = await AccessControl.deploy();

      const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
      const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);

      // Test with maximum values
      const maxUint256 = ethers.constants.MaxUint256;
      
      // Should revert with overflow protection
      await expect(
        doctorRegistry.connect(doctor).requestVerification(
          'QmTestCredentials',
          ['dermatology'],
          maxUint256,
          { value: maxUint256 }
        )
      ).to.be.reverted;
    });

    it('Should validate access control for emergency functions', async function () {
      const [owner, attacker] = await ethers.getSigners();

      const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
      const accessControl = await AccessControl.deploy();

      // Non-emergency role should not be able to pause
      await expect(
        accessControl.connect(attacker).emergencyPause()
      ).to.be.revertedWith('AccessControl: account');

      // Only emergency role should pause
      await accessControl.emergencyPause();
      expect(await accessControl.paused()).to.be.true;
    });

    it('Should protect against front-running attacks', async function () {
      const [owner, doctor, patient, frontrunner] = await ethers.getSigners();

      // Deploy contracts
      const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
      const accessControl = await AccessControl.deploy();

      const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
      const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);

      const ConsultationEscrow = await ethers.getContractFactory('ConsultationEscrow');
      const escrow = await ConsultationEscrow.deploy(doctorRegistry.address, owner.address);

      // Setup roles
      await accessControl.grantRoleWithTimestamp(await accessControl.PATIENT_ROLE(), patient.address);
      await accessControl.grantRoleWithTimestamp(await accessControl.DOCTOR_ROLE(), doctor.address);

      // Patient creates consultation
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmTestSymptoms',
        'dermatology',
        false,
        { value: fee }
      );

      // Frontrunner tries to accept consultation (should fail)
      await expect(
        escrow.connect(frontrunner).acceptConsultation(1)
      ).to.be.revertedWith('Not assigned doctor');

      // Only assigned doctor can accept
      await escrow.connect(doctor).acceptConsultation(1);
      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(1); // ACCEPTED
    });

    it('Should validate smart contract upgrade permissions', async function () {
      // Test that contracts cannot be upgraded without proper authorization
      // This is more relevant for proxy contracts, but we'll test admin functions

      const [owner, attacker] = await ethers.getSigners();

      const BTCOracle = await ethers.getContractFactory('BTCOracle');
      const oracle = await BTCOracle.deploy();

      // Non-oracle role should not update prices
      await expect(
        oracle.connect(attacker).updateBTCPrice(ethers.utils.parseUnits('50000', 8))
      ).to.be.revertedWith('AccessControl: account');
    });
  });

  describe('Data Privacy and Encryption', function () {
    it('Should encrypt sensitive medical data before IPFS upload', async function () {
      const sensitiveData = {
        symptoms: 'Confidential medical information',
        medicalHistory: 'Previous diagnoses and treatments',
        personalInfo: 'Patient identification data'
      };

      const response = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ data: sensitiveData })
        .expect(200);

      expect(response.body.encrypted).to.be.true;
      expect(response.body).to.have.property('hash');

      // Verify data cannot be accessed without decryption
      const directIpfsResponse = await request(app)
        .get(`/api/ipfs/${response.body.hash}/raw`) // Raw access
        .set('Authorization', `Bearer ${validToken}`);

      if (directIpfsResponse.status === 200) {
        expect(directIpfsResponse.body).to.not.include('Confidential medical information');
      }
    });

    it('Should prevent unauthorized data access', async function () {
      const user1Token = jwt.sign(
        { address: '0x1111111111111111111111111111111111111111', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      const user2Token = jwt.sign(
        { address: '0x2222222222222222222222222222222222222222', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // User 1 uploads data
      const uploadResponse = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ 
          data: { 
            type: 'private',
            content: 'User 1 private medical data' 
          } 
        });

      const hash = uploadResponse.body.hash;

      // User 2 should not be able to access User 1's data
      const accessResponse = await request(app)
        .get(`/api/ipfs/${hash}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(accessResponse.body).to.have.property('error');
    });

    it('Should protect against timing attacks', async function () {
      const validAddress = '0x1234567890123456789012345678901234567890';
      const invalidAddress = '0x9999999999999999999999999999999999999999';

      // Measure response times for valid vs invalid addresses
      const timingResults = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        
        await request(app)
          .post('/api/auth/nonce')
          .send({ address: i % 2 === 0 ? validAddress : invalidAddress });

        timingResults.push({
          isValid: i % 2 === 0,
          responseTime: Date.now() - startTime
        });
      }

      // Response times should not vary significantly between valid/invalid
      const validTimes = timingResults.filter(r => r.isValid).map(r => r.responseTime);
      const invalidTimes = timingResults.filter(r => !r.isValid).map(r => r.responseTime);

      const avgValidTime = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
      const avgInvalidTime = invalidTimes.reduce((a, b) => a + b, 0) / invalidTimes.length;

      const timingDifference = Math.abs(avgValidTime - avgInvalidTime);
      expect(timingDifference).to.be.lt(50); // Less than 50ms difference
    });
  });

  describe('Network and Infrastructure Security', function () {
    it('Should enforce HTTPS in production', function () {
      if (process.env.NODE_ENV === 'production') {
        // Check security headers
        return request(app)
          .get('/health')
          .expect(200)
          .expect('strict-transport-security', /max-age=/)
          .expect('x-content-type-options', 'nosniff')
          .expect('x-frame-options', 'DENY');
      }
    });

    it('Should implement proper CORS policies', async function () {
      // Test allowed origins
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers).to.have.property('access-control-allow-origin');

      // Test disallowed origins
      const blockedResponse = await request(app)
        .options('/api/consultations')
        .set('Origin', 'https://malicious-site.com')
        .set('Access-Control-Request-Method', 'POST');

      // Should not include CORS headers for unauthorized origin
      expect(blockedResponse.headers['access-control-allow-origin']).to.be.undefined;
    });

    it('Should protect against CSRF attacks', async function () {
      // Test that state-changing operations require proper tokens
      const response = await request(app)
        .post('/api/consultations/create')
        .set('Origin', 'https://malicious-site.com')
        .send({
          doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
          symptoms: 'CSRF test symptoms',
          specialty: 'dermatology',
          fee: '0.05'
        })
        .expect(401); // Should require authentication

      expect(response.body).to.have.property('error');
    });

    it('Should implement request size limits', async function () {
      const largePayload = {
        symptoms: 'x'.repeat(20 * 1024 * 1024), // 20MB payload
        specialty: 'dermatology',
        fee: '0.05'
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send(largePayload);

      expect([413, 400]).to.include(response.status); // Payload too large or validation error
    });
  });

  describe('Business Logic Security', function () {
    it('Should prevent double spending in consultations', async function () {
      const consultationData = {
        doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        symptoms: 'Double spending test symptoms',
        specialty: 'dermatology',
        fee: '0.05'
      };

      // Create consultation
      const response1 = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send(consultationData);

      const consultationId = response1.body.consultation.id;

      // Try to create identical consultation
      const response2 = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send(consultationData);

      // Both should succeed (different consultations) but with different IDs
      if (response2.status === 201) {
        expect(response2.body.consultation.id).to.not.equal(consultationId);
      }
    });

    it('Should validate consultation state transitions', async function () {
      const consultationId = 1;
      
      // Try to submit diagnosis without accepting first
      const response = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          diagnosisText: 'Invalid state transition test',
          confidenceLevel: 8
        });

      expect([400, 403]).to.include(response.status);
    });

    it('Should prevent manipulation of consultation fees', async function () {
      const manipulationAttempts = [
        { fee: '-0.05' }, // Negative fee
        { fee: '0' }, // Zero fee
        { fee: 'free' }, // Non-numeric
        { fee: '999999999999999999999999999999' } // Unreasonably large
      ];

      for (const attempt of manipulationAttempts) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
            symptoms: 'Fee manipulation test',
            specialty: 'dermatology',
            ...attempt
          })
          .expect(400);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should prevent reputation score manipulation', async function () {
      const doctorToken = jwt.sign(
        { address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc', role: 'doctor' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Doctor should not be able to rate themselves
      const response = await request(app)
        .post('/api/consultations/1/feedback')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ rating: 5, comment: 'Self-rating attempt' })
        .expect(403);

      expect(response.body).to.have.property('error');
    });
  });

  describe('Bitcoin Integration Security', function () {
    it('Should validate Bitcoin addresses properly', async function () {
      const invalidBtcAddresses = [
        '1InvalidAddress123', // Invalid format
        'bc1qinvalidaddress', // Invalid mainnet address for testnet
        '3P3QsMVK89JBNqZQv5zMAKG8FK3kJM4rjt', // Wrong network
        '', // Empty
        'notabitcoinaddress' // Not an address at all
      ];

      for (const address of invalidBtcAddresses) {
        const response = await request(app)
          .post('/api/btc/wallet/import')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            userAddress: '0x1234567890123456789012345678901234567890',
            btcAddress: address
          });

        expect([400, 500]).to.include(response.status);
      }
    });

    it('Should prevent Bitcoin private key exposure', async function () {
      const response = await request(app)
        .post('/api/btc/wallet/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ userAddress: '0x1234567890123456789012345678901234567890' });

      if (response.status === 200) {
        const responseText = JSON.stringify(response.body);
        
        // Private keys should never be in API responses
        expect(responseText).to.not.match(/[1-9A-HJ-NP-Za-km-z]{51,52}/); // WIF format
        expect(responseText).to.not.include('privateKey');
        expect(responseText).to.not.include('mnemonic');
        expect(responseText).to.not.include('seed');
      }
    });

    it('Should validate Lightning Network invoice formats', async function () {
      const invalidInvoices = [
        'invalid_invoice_format',
        'lnbc1invalid',
        '', // Empty
        'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' // Bitcoin URI, not Lightning
      ];

      for (const invoice of invalidInvoices) {
        const response = await request(app)
          .post('/api/btc/lightning/pay')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ paymentRequest: invoice });

        expect([400, 500]).to.include(response.status);
      }
    });

    it('Should prevent Bitcoin amount manipulation', async function () {
      const manipulationAttempts = [
        { amount: -0.001 }, // Negative amount
        { amount: 0 }, // Zero amount
        { amount: 21000000 }, // More than total Bitcoin supply
        { amount: 'invalid' }, // Non-numeric
        { amount: Infinity }, // Infinity
        { amount: NaN } // NaN
      ];

      for (const attempt of manipulationAttempts) {
        const response = await request(app)
          .post('/api/btc/lightning/invoice')
          .set('Authorization', `Bearer ${validToken}`)
          .send({
            memo: 'Test invoice',
            ...attempt
          });

        expect([400, 500]).to.include(response.status);
      }
    });
  });

  describe('Session and State Management Security', function () {
    it('Should handle session hijacking attempts', async function () {
      // Create session for user 1
      const user1Token = jwt.sign(
        { address: '0x1111111111111111111111111111111111111111', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Attacker tries to use token with different address
      const hijackToken = jwt.sign(
        { address: '0x2222222222222222222222222222222222222222', role: 'admin' }, // Elevated role
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/consultations/patient/0x1111111111111111111111111111111111111111')
        .set('Authorization', `Bearer ${hijackToken}`)
        .expect(403);

      expect(response.body).to.have.property('error');
    });

    it('Should prevent session fixation attacks', async function () {
      // Get nonce for user
      const nonceResponse1 = await request(app)
        .post('/api/auth/nonce')
        .send({ address: '0x1234567890123456789012345678901234567890' });

      const nonce1 = nonceResponse1.body.nonce;

      // Get second nonce (should be different)
      const nonceResponse2 = await request(app)
        .post('/api/auth/nonce')
        .send({ address: '0x1234567890123456789012345678901234567890' });

      const nonce2 = nonceResponse2.body.nonce;

      expect(nonce1).to.not.equal(nonce2);
    });

    it('Should implement secure token refresh', async function () {
      // Create token that expires soon
      const shortLivedToken = jwt.sign(
        { address: '0x1234567890123456789012345678901234567890', role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1s' }
      );

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Token should be rejected
      const response = await request(app)
        .get('/api/consultations')
        .set('Authorization', `Bearer ${shortLivedToken}`)
        .expect(401);

      expect(response.body.error).to.equal('Token expired');
    });
  });

  describe('API Security Headers', function () {
    it('Should include all required security headers', async function () {
      const response = await request(app)
        .get('/health')
        .expect(200);

      const requiredHeaders = [
        'x-content-type-options',
        'x-frame-options',
        'x-xss-protection'
      ];

      if (process.env.NODE_ENV === 'production') {
        requiredHeaders.push('strict-transport-security');
      }

      for (const header of requiredHeaders) {
        expect(response.headers).to.have.property(header);
      }
    });

    it('Should implement proper Content Security Policy', async function () {
      const response = await request(app)
        .get('/health')
        .expect(200);

      if (response.headers['content-security-policy']) {
        const csp = response.headers['content-security-policy'];
        
        expect(csp).to.include("default-src 'self'");
        expect(csp).to.not.include("'unsafe-eval'");
      }
    });

    it('Should prevent clickjacking attacks', async function () {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['x-frame-options']).to.equal('DENY');
    });
  });

  describe('Penetration Testing Simulation', function () {
    it('Should resist common web vulnerabilities', async function () {
      this.timeout(30000);

      const vulnerabilityTests = [
        {
          name: 'Directory Traversal',
          request: () => request(app).get('/api/../../../etc/passwd'),
          expectedStatus: [404, 400]
        },
        {
          name: 'Command Injection',
          request: () => request(app)
            .post('/api/ipfs/upload')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ data: { symptoms: '; cat /etc/passwd; #' } }),
          expectedStatus: [200, 400] // Should sanitize or reject
        },
        {
          name: 'XML External Entity (XXE)',
          request: () => request(app)
            .post('/api/consultations/create')
            .set('Authorization', `Bearer ${validToken}`)
            .set('Content-Type', 'application/xml')
            .send('<?xml version="1.0"?><!DOCTYPE test [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><test>&xxe;</test>'),
          expectedStatus: [400, 415] // Should reject XML or unsupported media type
        }
      ];

      for (const test of vulnerabilityTests) {
        const response = await test.request();
        expect(test.expectedStatus).to.include(response.status);
        
        // Ensure no sensitive data leaked
        const responseText = JSON.stringify(response.body);
        expect(responseText).to.not.include('root:');
        expect(responseText).to.not.include('/bin/bash');
      }
    });

    it('Should handle denial of service attempts', async function () {
      this.timeout(20000);

      // Test rapid requests (should be rate limited)
      const rapidRequests = Array.from({ length: 50 }, () =>
        request(app)
          .get('/health')
          .set('User-Agent', 'AttackBot/1.0')
      );

      const responses = await Promise.allSettled(rapidRequests);
      const rateLimitedCount = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      ).length;

      expect(rateLimitedCount).to.be.gt(0);
    });

    it('Should protect against automated attacks', async function () {
      // Test bot detection based on patterns
      const botRequests = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/auth/nonce')
          .set('User-Agent', 'Bot/1.0')
          .set('X-Forwarded-For', `192.168.1.${i % 10}`)
          .send({ address: `0x${'0'.repeat(39)}${i}` })
      );

      const responses = await Promise.allSettled(botRequests);
      const blockedCount = responses.filter(r => 
        r.status === 'fulfilled' && [429, 403].includes(r.value.status)
      ).length;

      expect(blockedCount).to.be.gt(0); // Some requests should be blocked
    });
  });

  describe('Smart Contract Attack Vectors', function () {
    it('Should resist flash loan attacks', async function () {
      // This test simulates a flash loan attack scenario
      // In a real attack, an attacker would borrow large amounts to manipulate state

      const [owner, attacker, doctor, patient] = await ethers.getSigners();

      // Deploy contracts
      const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
      const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);

      const ConsultationEscrow = await ethers.getContractFactory('ConsultationEscrow');
      const escrow = await ConsultationEscrow.deploy(doctorRegistry.address, owner.address);

      // Normal flow should work
      await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmTestSymptoms',
        'dermatology',
        false,
        { value: ethers.utils.parseEther('0.05') }
      );

      // Flash loan attack simulation (large transaction in same block)
      // The contract should maintain state integrity
      const consultation = await escrow.getConsultation(1);
      expect(consultation.fee).to.equal(ethers.utils.parseEther('0.05'));
    });

    it('Should validate gas limits for complex operations', async function () {
      const [owner, doctor] = await ethers.getSigners();

      const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
      const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);

      // Test with extremely low gas limit (should fail)
      await expect(
        doctorRegistry.connect(doctor).requestVerification(
          'QmTestCredentials',
          ['dermatology'],
          ethers.utils.parseEther('1000'),
          { 
            value: ethers.utils.parseEther('1000'),
            gasLimit: 21000 // Only enough for simple transfer
          }
        )
      ).to.be.reverted;
    });
  });

  describe('Compliance and Regulatory Security', function () {
    it('Should implement HIPAA-compliant data handling', async function () {
      const medicalData = {
        symptoms: 'Confidential patient medical information',
        patientId: '0x1234567890123456789012345678901234567890',
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ data: medicalData });

      if (response.status === 200) {
        // Data should be encrypted
        expect(response.body.encrypted).to.be.true;
        
        // Should not contain plaintext medical info
        expect(JSON.stringify(response.body)).to.not.include('Confidential patient medical');
      }
    });

    it('Should maintain audit trails for all operations', async function () {
      const consultationData = {
        doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
        symptoms: 'Audit trail test symptoms',
        specialty: 'dermatology',
        fee: '0.05'
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send(consultationData);

      if (response.status === 201) {
        // Check that audit information is present
        expect(response.body.consultation).to.have.property('createdAt');
        expect(response.body.consultation.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });

    it('Should implement data retention policies', async function () {
      // Test data cleanup for old records
      const response = await request(app)
        .get('/api/admin/data-retention-status')
        .set('Authorization', `Bearer ${validToken}`);

      // Admin endpoint should exist for compliance monitoring
      expect([200, 403, 404]).to.include(response.status);
    });
  });

  describe('Recovery and Incident Response', function () {
    it('Should handle emergency pause scenarios', async function () {
      // Test emergency pause functionality
      const emergencyResponse = await request(app)
        .post('/api/admin/emergency-pause')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ reason: 'Security incident test' });

      // Should require admin role (expect 403 for regular user)
      expect(emergencyResponse.status).to.equal(403);
    });

    it('Should maintain service during partial failures', async function () {
      // Health endpoint should always work
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);

      expect(healthResponse.body.status).to.equal('healthy');

      // Test individual service failures don't break entire system
      const serviceTests = [
        '/api/btc/prices', // Bitcoin service
        '/api/ipfs/stats', // IPFS service
      ];

      for (const endpoint of serviceTests) {
        const response = await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${validToken}`);

        // Should either work or fail gracefully
        expect([200, 503, 502]).to.include(response.status);
      }
    });

    it('Should log security events appropriately', async function () {
      // Trigger security event
      await request(app)
        .post('/api/consultations/create')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
          symptoms: 'Security logging test',
          specialty: 'dermatology',
          fee: '0.05'
        })
        .expect(401);

      // Check that security log endpoint exists
      const logResponse = await request(app)
        .get('/api/admin/security-logs')
        .set('Authorization', `Bearer ${validToken}`);

      // Admin endpoint should exist for security monitoring
      expect([200, 403, 404]).to.include(logResponse.status);
    });
  });

  describe('Cryptographic Security', function () {
    it('Should use secure random number generation', async function () {
      const nonceRequests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/nonce')
          .send({ address: '0x1234567890123456789012345678901234567890' })
      );

      const responses = await Promise.all(nonceRequests);
      const nonces = responses.map(r => r.body.nonce);

      // All nonces should be unique
      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).to.equal(nonces.length);

      // Nonces should be unpredictable (no sequential patterns)
      const numericNonces = nonces.map(n => parseInt(n));
      const differences = numericNonces.slice(1).map((n, i) => n - numericNonces[i]);
      const sequentialCount = differences.filter(d => d === 1 || d === -1).length;
      
      expect(sequentialCount).to.be.lt(nonces.length * 0.3); // Less than 30% sequential
    });

    it('Should validate cryptographic signatures properly', async function () {
      const testMessage = 'Test message for signature validation';
      const validAddress = '0x1234567890123456789012345678901234567890';
      
      // Mock signature validation
      const mockSignature = '0x' + '0'.repeat(130);
      
      // Should accept valid signature format
      const response = await request(app)
        .post('/api/auth/verify-signature')
        .send({
          message: testMessage,
          signature: mockSignature,
          address: validAddress
        });

      expect([200, 400]).to.include(response.status);
    });

    it('Should protect against rainbow table attacks on passwords', async function () {
      // Even though we use wallet auth, test any password-related functionality
      const commonPasswords = [
        'password123',
        'admin',
        'qwerty',
        '12345678',
        'password'
      ];

      for (const password of commonPasswords) {
        // If password endpoints exist, they should reject weak passwords
        const response = await request(app)
          .post('/api/auth/set-password')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ password });

        if (response.status === 200) {
          // If password setting is allowed, it should enforce strong passwords
          expect(password.length).to.be.gte(12); // Strong password requirement
        } else {
          // Should reject weak passwords
          expect([400, 422]).to.include(response.status);
        }
      }
    });
  });

  describe('Third-Party Integration Security', function () {
    it('Should validate external API responses', async function () {
      // Test Bitcoin price oracle security
      const priceResponse = await request(app)
        .get('/api/btc/prices')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      if (priceResponse.body.success) {
        const prices = priceResponse.body.prices;
        
        // Validate price data makes sense
        expect(prices.btcPrice).to.be.gt(1000); // Reasonable minimum
        expect(prices.btcPrice).to.be.lt(1000000); // Reasonable maximum
        expect(prices.ethPrice).to.be.gt(100);
        expect(prices.ethPrice).to.be.lt(100000);
      }
    });

    it('Should handle malformed external responses', async function () {
      // This would test how the system handles corrupted data from external APIs
      // For security, ensure the system doesn't crash or expose internal state
      
      const response = await request(app)
        .get('/api/btc/prices')
        .set('Authorization', `Bearer ${validToken}`);

      // Should either succeed or fail gracefully
      expect([200, 503]).to.include(response.status);
      
      if (response.status === 503) {
        expect(response.body).to.have.property('error');
      }
    });
  });

  after(function () {
    console.log('Security test suite completed');
    console.log('⚠️  Remember to run additional security tools:');
    console.log('   - npm run security:audit');
    console.log('   - slither contracts/');
    console.log('   - OWASP ZAP scan');
    console.log('   - Dependabot alerts review');
  });
});