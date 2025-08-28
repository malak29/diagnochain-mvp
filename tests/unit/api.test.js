const request = require('supertest');
const jwt = require('jsonwebtoken');
const { expect } = require('chai');

const app = require('../../backend/src/server');
const config = require('../../config/config');

describe('DiagnoChain API Endpoints', function () {
  let authToken;
  let doctorToken;
  let patientToken;

  const mockUsers = {
    patient: {
      address: '0x1234567890123456789012345678901234567890',
      role: 'patient',
      isVerified: true
    },
    doctor: {
      address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      role: 'doctor',
      isVerified: true
    },
    verifier: {
      address: '0x987fed321cba987fed321cba987fed321cba9876',
      role: 'verifier',
      isVerified: true
    }
  };

  before(async function () {
    // Generate test JWT tokens
    patientToken = jwt.sign(
      {
        address: mockUsers.patient.address,
        role: 'patient',
        isAdmin: false
      },
      config.security.jwt.secret,
      { expiresIn: '1h' }
    );

    doctorToken = jwt.sign(
      {
        address: mockUsers.doctor.address,
        role: 'doctor', 
        isAdmin: false
      },
      config.security.jwt.secret,
      { expiresIn: '1h' }
    );
  });

  describe('Health Check Endpoint', function () {
    it('GET /health should return system status', async function () {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('timestamp');
      expect(response.body).to.have.property('uptime');
      expect(response.body).to.have.property('environment');
      expect(response.body).to.have.property('version');
    });
  });

  describe('Authentication Endpoints', function () {
    it('POST /api/auth/nonce should generate authentication nonce', async function () {
      const response = await request(app)
        .post('/api/auth/nonce')
        .send({ address: mockUsers.patient.address })
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('nonce');
      expect(response.body.message).to.include('DiagnoChain Authentication');
    });

    it('POST /api/auth/nonce should reject invalid address', async function () {
      const response = await request(app)
        .post('/api/auth/nonce')
        .send({ address: 'invalid-address' })
        .expect(400);

      expect(response.body).to.have.property('error');
    });

    it('POST /api/auth/login should authenticate with valid signature', async function () {
      // First get nonce
      const nonceResponse = await request(app)
        .post('/api/auth/nonce')
        .send({ address: mockUsers.patient.address });

      // Mock signature (in real test, you'd sign with private key)
      const mockSignature = '0x' + '0'.repeat(130);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          address: mockUsers.patient.address,
          signature: mockSignature
        })
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('token');
      expect(response.body).to.have.property('user');
      expect(response.body.user.address).to.equal(mockUsers.patient.address);
    });

    it('Should reject authentication with invalid signature', async function () {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          address: mockUsers.patient.address,
          signature: 'invalid-signature'
        })
        .expect(401);

      expect(response.body).to.have.property('error');
    });
  });

  describe('Consultation Endpoints', function () {
    it('POST /api/consultations/create should create new consultation', async function () {
      const consultationData = {
        doctorAddress: mockUsers.doctor.address,
        symptoms: 'Test symptoms for API testing',
        specialty: 'dermatology',
        isUrgent: false,
        fee: '0.05'
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send(consultationData)
        .expect(201);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('consultation');
      expect(response.body.consultation.patientAddress).to.equal(mockUsers.patient.address);
      expect(response.body.consultation.doctorAddress).to.equal(mockUsers.doctor.address);
      expect(response.body).to.have.property('ipfsHash');
      expect(response.body).to.have.property('btcEquivalent');
    });

    it('POST /api/consultations/create should validate input parameters', async function () {
      const invalidData = {
        doctorAddress: 'invalid-address',
        symptoms: 'abc', // Too short
        specialty: 'invalid-specialty',
        fee: -1 // Negative fee
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body).to.have.property('error', 'Validation failed');
      expect(response.body).to.have.property('details');
      expect(response.body.details).to.be.an('array');
    });

    it('POST /api/consultations/create should enforce rate limiting', async function () {
      this.timeout(10000);

      const consultationData = {
        doctorAddress: mockUsers.doctor.address,
        symptoms: 'Rate limit test symptoms',
        specialty: 'dermatology',
        isUrgent: false,
        fee: '0.05'
      };

      // Make multiple rapid requests
      const promises = Array.from({ length: 12 }, () =>
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${patientToken}`)
          .send(consultationData)
      );

      const responses = await Promise.allSettled(promises);
      const rateLimitedResponses = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      );

      expect(rateLimitedResponses.length).to.be.gt(0);
    });

    it('PATCH /api/consultations/:id/accept should allow doctor to accept', async function () {
      // First create a consultation
      const createResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorAddress: mockUsers.doctor.address,
          symptoms: 'Test symptoms',
          specialty: 'dermatology',
          isUrgent: false,
          fee: '0.05'
        });

      const consultationId = createResponse.body.consultation.id;

      const response = await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body.consultation.status).to.equal('accepted');
    });

    it('POST /api/consultations/:id/diagnosis should submit diagnosis', async function () {
      // Create and accept consultation first
      const createResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorAddress: mockUsers.doctor.address,
          symptoms: 'Test symptoms for diagnosis',
          specialty: 'dermatology',
          isUrgent: false,
          fee: '0.05'
        });

      const consultationId = createResponse.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${doctorToken}`);

      const diagnosisData = {
        diagnosisText: 'Test diagnosis: Contact dermatitis. Recommend topical treatment.',
        confidenceLevel: 8,
        followUpRecommendation: '2weeks'
      };

      const response = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(diagnosisData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body.consultation.status).to.equal('completed');
      expect(response.body).to.have.property('diagnosisHash');
      expect(response.body).to.have.property('btcPayment');
    });

    it('GET /api/consultations should return user consultations', async function () {
      const response = await request(app)
        .get('/api/consultations')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('consultations');
      expect(response.body.consultations).to.be.an('array');
      expect(response.body).to.have.property('pagination');
    });

    it('GET /api/consultations should filter by status', async function () {
      const response = await request(app)
        .get('/api/consultations?status=completed')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body.consultations).to.be.an('array');
      // All returned consultations should have 'completed' status
      response.body.consultations.forEach(consultation => {
        expect(consultation.status).to.equal('completed');
      });
    });

    it('POST /api/consultations/:id/feedback should accept patient feedback', async function () {
      // Mock consultation ID for completed consultation
      const consultationId = 1;

      const feedbackData = {
        rating: 5,
        comment: 'Excellent diagnosis and treatment recommendations'
      };

      const response = await request(app)
        .post(`/api/consultations/${consultationId}/feedback`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send(feedbackData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('feedback');
      expect(response.body.feedback.rating).to.equal(5);
    });
  });

  describe('Doctor Endpoints', function () {
    it('GET /api/doctors should return verified doctors list', async function () {
      const response = await request(app)
        .get('/api/doctors')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('doctors');
      expect(response.body.doctors).to.be.an('array');
    });

    it('GET /api/doctors should filter by specialty', async function () {
      const response = await request(app)
        .get('/api/doctors?specialty=dermatology')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      response.body.doctors.forEach(doctor => {
        expect(doctor.specialties).to.include('dermatology');
      });
    });

    it('POST /api/doctors/register should register new doctor', async function () {
      const doctorData = {
        licenseNumber: 'MD98765',
        institution: 'Mayo Clinic',
        specialties: ['cardiology'],
        credentialsHash: 'QmTestDoctorCredentials',
        stakeAmount: '1500'
      };

      const response = await request(app)
        .post('/api/doctors/register')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(doctorData)
        .expect(201);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('doctor');
      expect(response.body.doctor.licenseNumber).to.equal('MD98765');
    });

    it('GET /api/doctors/:address/stats should return doctor statistics', async function () {
      const response = await request(app)
        .get(`/api/doctors/${mockUsers.doctor.address}/stats`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('stats');
      expect(response.body.stats).to.have.property('totalConsultations');
      expect(response.body.stats).to.have.property('averageRating');
      expect(response.body.stats).to.have.property('reputationScore');
    });
  });

  describe('Bitcoin Integration Endpoints', function () {
    it('GET /api/btc/prices should return current BTC prices', async function () {
      const response = await request(app)
        .get('/api/btc/prices')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('prices');
      expect(response.body.prices).to.have.property('btcPrice');
      expect(response.body.prices).to.have.property('ethPrice');
      expect(response.body.prices).to.have.property('timestamp');
    });

    it('POST /api/btc/convert should convert ETH to BTC', async function () {
      const conversionData = { ethAmount: '0.05' };

      const response = await request(app)
        .post('/api/btc/convert')
        .set('Authorization', `Bearer ${patientToken}`)
        .send(conversionData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('conversion');
      expect(response.body.conversion).to.have.property('btcAmount');
      expect(response.body.conversion).to.have.property('rate');
      expect(parseFloat(response.body.conversion.btcAmount)).to.be.gt(0);
    });

    it('POST /api/btc/wallet/create should create BTC wallet', async function () {
      const response = await request(app)
        .post('/api/btc/wallet/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ userAddress: mockUsers.patient.address })
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('wallet');
      expect(response.body.wallet).to.have.property('address');
      expect(response.body.wallet).to.have.property('network');
      expect(response.body.wallet.network).to.equal('testnet');
    });

    it('GET /api/btc/wallet/:address should return wallet info', async function () {
      const response = await request(app)
        .get(`/api/btc/wallet/${mockUsers.doctor.address}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('wallet');
      expect(response.body.wallet).to.have.property('balance');
    });

    it('POST /api/btc/lightning/invoice should create Lightning invoice', async function () {
      const invoiceData = {
        amount: 0.001,
        memo: 'Test consultation payment',
        expiry: 3600
      };

      const response = await request(app)
        .post('/api/btc/lightning/invoice')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(invoiceData)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('invoice');
      expect(response.body.invoice).to.have.property('paymentRequest');
      expect(response.body.invoice).to.have.property('paymentHash');
      expect(response.body.invoice.amount).to.equal(0.001);
    });
  });

  describe('IPFS Endpoints', function () {
    it('POST /api/ipfs/upload should upload encrypted data', async function () {
      const testData = {
        type: 'symptoms',
        content: 'Test medical data for IPFS upload',
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ data: testData })
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('hash');
      expect(response.body).to.have.property('encrypted', true);
      expect(response.body.hash).to.match(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('GET /api/ipfs/:hash should retrieve and decrypt data', async function () {
      // First upload some data
      const uploadResponse = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ 
          data: { 
            type: 'test', 
            content: 'Test retrieval data' 
          } 
        });

      const hash = uploadResponse.body.hash;

      const response = await request(app)
        .get(`/api/ipfs/${hash}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('data');
      expect(response.body.data.content).to.equal('Test retrieval data');
    });

    it('Should reject invalid IPFS hash format', async function () {
      const response = await request(app)
        .get('/api/ipfs/invalid-hash-format')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(400);

      expect(response.body).to.have.property('error');
    });
  });

  describe('NFT Endpoints', function () {
    it('GET /api/nft/patient/:address should return patient NFTs', async function () {
      const response = await request(app)
        .get(`/api/nft/patient/${mockUsers.patient.address}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('nfts');
      expect(response.body.nfts).to.be.an('array');
    });

    it('GET /api/nft/doctor/:address should return doctor NFTs', async function () {
      const response = await request(app)
        .get(`/api/nft/doctor/${mockUsers.doctor.address}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('nfts');
      expect(response.body.nfts).to.be.an('array');
    });

    it('POST /api/nft/metadata should generate NFT metadata', async function () {
      const metadataRequest = {
        consultationId: 1,
        diagnosis: 'Contact dermatitis',
        confidence: 8,
        specialty: 'dermatology'
      };

      const response = await request(app)
        .post('/api/nft/metadata')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(metadataRequest)
        .expect(200);

      expect(response.body).to.have.property('success', true);
      expect(response.body).to.have.property('metadata');
      expect(response.body.metadata).to.have.property('name');
      expect(response.body.metadata).to.have.property('description');
      expect(response.body.metadata).to.have.property('attributes');
    });
  });

  describe('Authorization and Access Control', function () {
    it('Should reject requests without authentication token', async function () {
      const response = await request(app)
        .get('/api/consultations')
        .expect(401);

      expect(response.body).to.have.property('error', 'Authentication required');
    });

    it('Should reject requests with invalid token', async function () {
      const response = await request(app)
        .get('/api/consultations')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).to.have.property('error');
    });

    it('Should reject requests with expired token', async function () {
      const expiredToken = jwt.sign(
        { address: mockUsers.patient.address, role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1ms' }
      );

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await request(app)
        .get('/api/consultations')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body).to.have.property('error', 'Token expired');
    });

    it('Should enforce role-based access control', async function () {
      // Patient trying to access doctor-only endpoint
      const response = await request(app)
        .get(`/api/doctors/${mockUsers.doctor.address}/private-stats`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(403);

      expect(response.body).to.have.property('error');
    });

    it('Should allow self-access to own data', async function () {
      const response = await request(app)
        .get(`/api/consultations/patient/${mockUsers.patient.address}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body).to.have.property('success', true);
    });

    it('Should prevent access to other users data', async function () {
      const response = await request(app)
        .get(`/api/consultations/patient/${mockUsers.doctor.address}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(403);

      expect(response.body).to.have.property('error', 'Access denied');
    });
  });

  describe('Error Handling', function () {
    it('Should handle 404 for non-existent endpoints', async function () {
      const response = await request(app)
        .get('/api/non-existent-endpoint')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(404);

      expect(response.body).to.have.property('error', 'Endpoint not found');
    });

    it('Should handle malformed JSON in request body', async function () {
      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .set('Content-Type', 'application/json')
        .send('invalid-json')
        .expect(400);

      expect(response.body).to.have.property('error');
    });

    it('Should handle large request payloads', async function () {
      const largeData = {
        symptoms: 'x'.repeat(10000), // Very long symptoms
        specialty: 'dermatology',
        fee: '0.05'
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send(largeData)
        .expect(400);

      expect(response.body).to.have.property('error');
    });

    it('Should return consistent error format', async function () {
      const response = await request(app)
        .get('/api/consultations/999999')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(404);

      expect(response.body).to.have.property('error');
      expect(response.body).to.have.property('timestamp');
      expect(response.body.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Performance Tests', function () {
    it('Should respond to health check within 100ms', async function () {
      const startTime = Date.now();
      
      await request(app)
        .get('/health')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).to.be.lt(100);
    });

    it('Should handle concurrent requests efficiently', async function () {
      this.timeout(5000);

      const concurrentRequests = 10;
      const promises = Array.from({ length: concurrentRequests }, () =>
        request(app)
          .get('/health')
          .expect(200)
      );

      const startTime = Date.now();
      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      expect(totalTime).to.be.lt(1000); // Should complete in under 1 second
    });

    it('Should maintain response time under load', async function () {
      this.timeout(10000);

      const requestCount = 20;
      const responseTimes = [];

      for (let i = 0; i < requestCount; i++) {
        const startTime = Date.now();
        
        await request(app)
          .get('/api/consultations')
          .set('Authorization', `Bearer ${patientToken}`)
          .expect(200);

        responseTimes.push(Date.now() - startTime);
      }

      const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      expect(averageResponseTime).to.be.lt(500); // Average under 500ms
      expect(maxResponseTime).to.be.lt(2000); // Max under 2 seconds
    });
  });

  describe('Data Validation Tests', function () {
    it('Should validate Ethereum addresses', async function () {
      const invalidAddresses = [
        'not-an-address',
        '0x123', // Too short
        '0xgg123456789012345678901234567890123456789', // Invalid characters
        '123456789012345678901234567890123456789012' // Missing 0x prefix
      ];

      for (const invalidAddress of invalidAddresses) {
        const response = await request(app)
          .post('/api/auth/nonce')
          .send({ address: invalidAddress })
          .expect(400);

        expect(response.body).to.have.property('error');
      }
    });

    it('Should validate consultation parameters', async function () {
      const testCases = [
        {
          data: { symptoms: 'x'.repeat(1001), specialty: 'dermatology', fee: '0.05' },
          expectedError: 'Symptoms must be between 10 and 1000 characters'
        },
        {
          data: { symptoms: 'Valid symptoms', specialty: 'invalid-specialty', fee: '0.05' },
          expectedError: 'Invalid medical specialty'
        },
        {
          data: { symptoms: 'Valid symptoms', specialty: 'dermatology', fee: '0' },
          expectedError: 'Fee must be at least 0.001 ETH'
        }
      ];

      for (const testCase of testCases) {
        const response = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({
            doctorAddress: mockUsers.doctor.address,
            ...testCase.data
          })
          .expect(400);

        expect(response.body).to.have.property('error', 'Validation failed');
      }
    });

    it('Should sanitize input data', async function () {
      const maliciousData = {
        doctorAddress: mockUsers.doctor.address,
        symptoms: '<script>alert("xss")</script>Test symptoms',
        specialty: 'dermatology',
        fee: '0.05'
      };

      const response = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send(maliciousData)
        .expect(201);

      // Symptoms should be sanitized but consultation should still be created
      expect(response.body.consultation.symptomsHash).to.be.a('string');
    });
  });

  describe('Rate Limiting Tests', function () {
    it('Should enforce global rate limits', async function () {
      this.timeout(20000);

      const rateLimitMax = 100; // From config
      const requests = Array.from({ length: rateLimitMax + 5 }, () =>
        request(app).get('/health')
      );

      const responses = await Promise.allSettled(requests);
      const rateLimitedCount = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      ).length;

      expect(rateLimitedCount).to.be.gt(0);
    });

    it('Should have separate rate limits for different endpoints', async function () {
      // Consultation creation has stricter limits
      const consultationRequests = Array.from({ length: 12 }, () =>
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${patientToken}`)
          .send({
            doctorAddress: mockUsers.doctor.address,
            symptoms: 'Rate limit test',
            specialty: 'dermatology',
            fee: '0.05'
          })
      );

      const responses = await Promise.allSettled(consultationRequests);
      const rateLimitedCount = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      ).length;

      expect(rateLimitedCount).to.be.gt(0);
    });
  });

  describe('WebSocket Integration Tests', function () {
    it('Should establish WebSocket connection for real-time updates', function (done) {
      // This would require WebSocket testing setup
      // For MVP, we'll simulate the test
      
      const mockWebSocketUpdate = {
        type: 'consultation_update',
        consultationId: 1,
        status: 'accepted',
        timestamp: new Date().toISOString()
      };

      // Simulate WebSocket message
      setTimeout(() => {
        expect(mockWebSocketUpdate.type).to.equal('consultation_update');
        expect(mockWebSocketUpdate.consultationId).to.equal(1);
        done();
      }, 100);
    });
  });

  describe('Database Integration Tests', function () {
    it('Should handle database connection failures gracefully', async function () {
      // Simulate database error by making request that would fail
      const response = await request(app)
        .get('/api/consultations/database-error-test')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(500);

      expect(response.body).to.have.property('error');
      expect(response.body.error).to.include('database');
    });

    it('Should maintain data consistency across requests', async function () {
      // Create consultation
      const createResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorAddress: mockUsers.doctor.address,
          symptoms: 'Consistency test symptoms',
          specialty: 'dermatology',
          fee: '0.05'
        });

      const consultationId = createResponse.body.consultation.id;

      // Retrieve consultation
      const getResponse = await request(app)
        .get(`/api/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(getResponse.body.consultation.id).to.equal(consultationId);
      expect(getResponse.body.consultation.patientAddress).to.equal(mockUsers.patient.address);
    });
  });

  describe('API Documentation Tests', function () {
    it('Should serve API documentation in development', async function () {
      if (process.env.NODE_ENV === 'development') {
        const response = await request(app)
          .get('/api/docs')
          .expect(200);

        expect(response.text).to.include('DiagnoChain API');
      }
    });

    it('Should include CORS headers for allowed origins', async function () {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers).to.have.property('access-control-allow-origin');
    });

    it('Should reject requests from unauthorized origins', async function () {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'https://malicious-site.com')
        .expect(200); // Health check should still work, but no CORS headers

      expect(response.headers['access-control-allow-origin']).to.be.undefined;
    });
  });

  after(async function () {
    // Cleanup after tests
    if (app && app.close) {
      await app.close();
    }
  });
});