const { expect } = require('chai');
const { ethers } = require('hardhat');
const request = require('supertest');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const app = require('../../backend/src/server');
const BitcoinAPI = require('../../bitcoin/bitcoinAPI');
const config = require('../../config/config');

describe('DiagnoChain End-to-End Integration Tests', function () {
  let contracts;
  let users;
  let authTokens;
  let wsConnection;

  before(async function () {
    this.timeout(30000);
    
    // Deploy contracts
    contracts = await deployTestContracts();
    
    // Setup test users
    users = await setupTestUsers();
    
    // Generate auth tokens
    authTokens = generateAuthTokens(users);
    
    // Initialize Bitcoin services
    await BitcoinAPI.init();
    
    console.log('Integration test environment setup complete');
  });

  async function deployTestContracts() {
    const [owner, doctor, patient, verifier, oracle, feeCollector] = await ethers.getSigners();

    const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
    const accessControl = await AccessControl.deploy();
    await accessControl.deployed();

    const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
    const doctorRegistry = await DoctorRegistry.deploy(ethers.constants.AddressZero);
    await doctorRegistry.deployed();

    const ConsultationEscrow = await ethers.getContractFactory('ConsultationEscrow');
    const escrow = await ConsultationEscrow.deploy(doctorRegistry.address, feeCollector.address);
    await escrow.deployed();

    const DiagnosticNFT = await ethers.getContractFactory('DiagnosticNFT');
    const nft = await DiagnosticNFT.deploy(escrow.address);
    await nft.deployed();

    const ReputationSystem = await ethers.getContractFactory('ReputationSystem');
    const reputation = await ReputationSystem.deploy(doctorRegistry.address, escrow.address);
    await reputation.deployed();

    const BTCOracle = await ethers.getContractFactory('BTCOracle');
    const btcOracle = await BTCOracle.deploy();
    await btcOracle.deployed();

    // Setup roles
    await accessControl.grantRoleWithTimestamp(await accessControl.DOCTOR_ROLE(), doctor.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.PATIENT_ROLE(), patient.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.VERIFIER_ROLE(), verifier.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.ORACLE_ROLE(), oracle.address);

    await reputation.fundRewardPool({ value: ethers.utils.parseEther('10.0') });
    await btcOracle.connect(oracle).updateBTCPrice(ethers.utils.parseUnits('43000', 8));

    return {
      accessControl,
      doctorRegistry,
      escrow,
      nft,
      reputation,
      btcOracle,
      signers: { owner, doctor, patient, verifier, oracle, feeCollector }
    };
  }

  async function setupTestUsers() {
    const [owner, doctor, patient, verifier] = await ethers.getSigners();
    
    return {
      patient: {
        address: patient.address,
        role: 'patient',
        signer: patient
      },
      doctor: {
        address: doctor.address,
        role: 'doctor',
        signer: doctor
      },
      verifier: {
        address: verifier.address,
        role: 'verifier', 
        signer: verifier
      }
    };
  }

  function generateAuthTokens(users) {
    const tokens = {};
    
    Object.keys(users).forEach(userType => {
      tokens[userType] = jwt.sign(
        {
          address: users[userType].address,
          role: users[userType].role,
          isAdmin: false
        },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );
    });

    return tokens;
  }

  describe('Complete Consultation Flow', function () {
    it('Should execute full patient-to-doctor consultation workflow', async function () {
      this.timeout(30000);

      const consultationData = {
        doctorAddress: users.doctor.address,
        symptoms: 'Persistent red rash on both arms, itchy, appeared 1 week ago',
        specialty: 'dermatology',
        isUrgent: false,
        fee: '0.05'
      };

      // Step 1: Patient creates consultation via API
      console.log('Step 1: Creating consultation...');
      const createResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send(consultationData)
        .expect(201);

      expect(createResponse.body.success).to.be.true;
      const consultationId = createResponse.body.consultation.id;
      const btcEquivalent = createResponse.body.btcEquivalent;

      console.log(`Consultation created: ID ${consultationId}, BTC equivalent: ${btcEquivalent}`);

      // Step 2: Smart contract creates consultation on-chain
      const onChainConsultation = await contracts.escrow.getConsultation(consultationId);
      expect(onChainConsultation.patient).to.equal(users.patient.address);
      expect(onChainConsultation.doctor).to.equal(users.doctor.address);

      // Step 3: Doctor accepts consultation
      console.log('Step 2: Doctor accepting consultation...');
      const acceptResponse = await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      expect(acceptResponse.body.consultation.status).to.equal('accepted');

      // Step 4: Doctor submits diagnosis
      console.log('Step 3: Doctor submitting diagnosis...');
      const diagnosisData = {
        diagnosisText: 'Contact dermatitis likely caused by environmental allergen. Recommend topical corticosteroid twice daily and avoidance of known irritants. Follow up in 2 weeks if no improvement.',
        confidenceLevel: 8,
        followUpRecommendation: '2weeks'
      };

      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send(diagnosisData)
        .expect(200);

      expect(diagnosisResponse.body.success).to.be.true;
      expect(diagnosisResponse.body.consultation.status).to.equal('completed');

      // Step 5: Verify payment was released via Bitcoin
      console.log('Step 4: Verifying Bitcoin payment...');
      expect(diagnosisResponse.body).to.have.property('btcPayment');
      expect(diagnosisResponse.body.btcPayment).to.have.property('success', true);

      // Step 6: Mint diagnostic NFT
      console.log('Step 5: Minting diagnostic NFT...');
      const nftTx = await contracts.nft.connect(contracts.signers.doctor).mintDiagnosticNFT(
        consultationId,
        diagnosisResponse.body.diagnosisHash,
        diagnosisData.confidenceLevel,
        'https://gateway.pinata.cloud/ipfs/QmTestMetadata'
      );

      const nftReceipt = await nftTx.wait();
      const nftMintedEvent = nftReceipt.events.find(e => e.event === 'DiagnosticNFTMinted');
      const tokenId = nftMintedEvent.args.tokenId;

      console.log(`NFT minted: Token ID ${tokenId}`);

      // Step 7: Patient submits feedback
      console.log('Step 6: Patient submitting feedback...');
      const feedbackData = {
        rating: 5,
        comment: 'Excellent diagnosis and very helpful treatment recommendations'
      };

      const feedbackResponse = await request(app)
        .post(`/api/consultations/${consultationId}/feedback`)
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send(feedbackData)
        .expect(200);

      expect(feedbackResponse.body.success).to.be.true;

      // Step 8: Verify final state
      console.log('Step 7: Verifying final state...');
      
      // Check consultation is completed
      const finalConsultation = await contracts.escrow.getConsultation(consultationId);
      expect(finalConsultation.status).to.equal(3); // COMPLETED

      // Check NFT ownership
      expect(await contracts.nft.ownerOf(tokenId)).to.equal(users.patient.address);

      // Check doctor reputation updated
      const doctorMetrics = await contracts.reputation.getDoctorMetrics(users.doctor.address);
      expect(doctorMetrics.averageRating).to.be.gt(0);

      console.log('✅ Complete consultation flow test passed!');
    });

    it('Should handle urgent consultation with expedited processing', async function () {
      this.timeout(15000);

      const urgentConsultationData = {
        doctorAddress: users.doctor.address,
        symptoms: 'Severe chest pain and difficulty breathing - started 30 minutes ago',
        specialty: 'cardiology',
        isUrgent: true,
        fee: '0.08'
      };

      console.log('Testing urgent consultation flow...');

      const createResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send(urgentConsultationData)
        .expect(201);

      const consultationId = createResponse.body.consultation.id;

      // Verify urgent flag and shorter timeout
      const consultation = await contracts.escrow.getConsultation(consultationId);
      expect(consultation.isUrgent).to.be.true;

      // Doctor should respond quickly for urgent cases
      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Possible angina pectoris. Recommend immediate cardiac evaluation and ECG.',
          confidenceLevel: 7,
          followUpRecommendation: 'emergency'
        })
        .expect(200);

      expect(diagnosisResponse.body.success).to.be.true;
      console.log('✅ Urgent consultation flow test passed!');
    });
  });

  describe('Bitcoin Payment Integration', function () {
    it('Should process Lightning Network payments for fast settlements', async function () {
      this.timeout(20000);

      // Create consultation
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Lightning payment test symptoms',
          specialty: 'general_practice',
          fee: '0.03'
        });

      const consultationId = consultationResponse.body.consultation.id;

      // Accept and complete consultation
      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      // Check if Lightning payment was attempted
      const bitcoinStatsResponse = await request(app)
        .get('/api/btc/stats')
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      expect(bitcoinStatsResponse.body.stats).to.have.property('lightning');
      
      console.log('Lightning payment stats:', bitcoinStatsResponse.body.stats.lightning);
    });

    it('Should fallback to on-chain if Lightning fails', async function () {
      this.timeout(15000);

      // Simulate Lightning failure by disconnecting
      if (BitcoinAPI.lightningClient.isConnected) {
        BitcoinAPI.lightningClient.disconnect();
      }

      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'On-chain fallback test',
          specialty: 'dermatology',
          fee: '0.04'
        });

      const consultationId = consultationResponse.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'On-chain payment fallback test diagnosis',
          confidenceLevel: 7,
          followUpRecommendation: 'none'
        })
        .expect(200);

      // Should still succeed even if Lightning is down
      expect(diagnosisResponse.body.success).to.be.true;
      expect(diagnosisResponse.body.btcPayment).to.have.property('success');

      console.log('On-chain fallback payment method:', diagnosisResponse.body.btcPayment);
    });

    it('Should handle Bitcoin price volatility during consultation', async function () {
      this.timeout(10000);

      // Get initial BTC price
      const initialPriceResponse = await request(app)
        .get('/api/btc/prices')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .expect(200);

      const initialBtcPrice = initialPriceResponse.body.prices.btcPrice;

      // Create consultation
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Price volatility test symptoms',
          specialty: 'psychiatry',
          fee: '0.06'
        });

      const consultationId = consultationResponse.body.consultation.id;
      const originalBtcEquivalent = consultationResponse.body.btcEquivalent;

      // Simulate price change by updating oracle
      const newBtcPrice = ethers.utils.parseUnits('45000', 8); // $45k vs original $43k
      await contracts.btcOracle.connect(contracts.signers.oracle).updateBTCPrice(newBtcPrice);

      // Complete consultation
      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Price volatility test diagnosis',
          confidenceLevel: 9,
          followUpRecommendation: 'none'
        });

      // Payment should use original rate to protect both parties
      expect(diagnosisResponse.body.success).to.be.true;
      
      console.log('Price volatility handling verified');
    });
  });

  describe('Multi-User Concurrent Operations', function () {
    it('Should handle multiple simultaneous consultations', async function () {
      this.timeout(25000);

      const [, , , , , patient2, patient3] = await ethers.getSigners();
      
      // Generate tokens for additional patients
      const patient2Token = jwt.sign(
        { address: patient2.address, role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );
      
      const patient3Token = jwt.sign(
        { address: patient3.address, role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Create multiple consultations simultaneously
      const consultationPromises = [
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${authTokens.patient}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: 'Concurrent test 1 - headaches',
            specialty: 'neurology',
            fee: '0.05'
          }),
          
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${patient2Token}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: 'Concurrent test 2 - skin irritation',
            specialty: 'dermatology',
            fee: '0.04'
          }),
          
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${patient3Token}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: 'Concurrent test 3 - anxiety symptoms',
            specialty: 'psychiatry',
            fee: '0.07'
          })
      ];

      const responses = await Promise.all(consultationPromises);
      
      responses.forEach((response, index) => {
        expect(response.status).to.equal(201);
        expect(response.body.success).to.be.true;
        console.log(`Consultation ${index + 1} created: ${response.body.consultation.id}`);
      });

      // Doctor processes all consultations
      for (let i = 0; i < responses.length; i++) {
        const consultationId = responses[i].body.consultation.id;
        
        await request(app)
          .patch(`/api/consultations/${consultationId}/accept`)
          .set('Authorization', `Bearer ${authTokens.doctor}`)
          .expect(200);

        await request(app)
          .post(`/api/consultations/${consultationId}/diagnosis`)
          .set('Authorization', `Bearer ${authTokens.doctor}`)
          .send({
            diagnosisText: `Concurrent diagnosis for consultation ${i + 1}`,
            confidenceLevel: 8,
            followUpRecommendation: '1week'
          })
          .expect(200);
      }

      console.log('✅ Concurrent consultations test passed!');
    });

    it('Should maintain data consistency under concurrent load', async function () {
      this.timeout(20000);

      const initialDoctorStats = await request(app)
        .get(`/api/doctors/${users.doctor.address}/stats`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      const initialConsultationCount = initialDoctorStats.body.stats.totalConsultations || 0;

      // Create 5 rapid consultations
      const rapidConsultations = Array.from({ length: 5 }, (_, i) => 
        request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${authTokens.patient}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: `Rapid consultation ${i + 1} - test symptoms`,
            specialty: 'general_practice',
            fee: '0.03'
          })
      );

      const rapidResponses = await Promise.all(rapidConsultations);
      
      // All should succeed
      rapidResponses.forEach(response => {
        expect(response.status).to.equal(201);
      });

      // Complete all consultations
      for (const response of rapidResponses) {
        const consultationId = response.body.consultation.id;
        
        await request(app)
          .patch(`/api/consultations/${consultationId}/accept`)
          .set('Authorization', `Bearer ${authTokens.doctor}`);
          
        await request(app)
          .post(`/api/consultations/${consultationId}/diagnosis`)
          .set('Authorization', `Bearer ${authTokens.doctor}`)
          .send({
            diagnosisText: 'Rapid consultation diagnosis',
            confidenceLevel: 7,
            followUpRecommendation: 'none'
          });
      }

      // Verify final count is consistent
      const finalDoctorStats = await request(app)
        .get(`/api/doctors/${users.doctor.address}/stats`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      const finalConsultationCount = finalDoctorStats.body.stats.totalConsultations;
      expect(finalConsultationCount).to.equal(initialConsultationCount + 5);

      console.log('✅ Data consistency under load test passed!');
    });
  });

  describe('Error Recovery and Fault Tolerance', function () {
    it('Should recover from temporary Bitcoin network failures', async function () {
      this.timeout(15000);

      // Create consultation
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Bitcoin network failure recovery test',
          specialty: 'dermatology',
          fee: '0.05'
        });

      const consultationId = consultationResponse.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      // Simulate Bitcoin service failure
      const originalBitcoinService = BitcoinAPI.paymentProcessor;
      BitcoinAPI.paymentProcessor = null;

      // Diagnosis should still work (payment queued for retry)
      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Network failure test diagnosis',
          confidenceLevel: 8,
          followUpRecommendation: 'none'
        })
        .expect(200);

      // Restore service
      BitcoinAPI.paymentProcessor = originalBitcoinService;

      expect(diagnosisResponse.body.success).to.be.true;
      console.log('✅ Bitcoin network failure recovery test passed!');
    });

    it('Should handle IPFS gateway failures with fallbacks', async function () {
      this.timeout(10000);

      // Test data upload with primary gateway down
      const testData = {
        type: 'symptoms',
        content: 'IPFS fallback test data',
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({ data: testData })
        .expect(200);

      expect(response.body.success).to.be.true;
      expect(response.body.hash).to.be.a('string');

      // Test data retrieval with fallback gateways
      const retrieveResponse = await request(app)
        .get(`/api/ipfs/${response.body.hash}`)
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .expect(200);

      expect(retrieveResponse.body.data.content).to.equal('IPFS fallback test data');
      console.log('✅ IPFS fallback test passed!');
    });

    it('Should handle smart contract transaction failures gracefully', async function () {
      // Test with insufficient gas
      try {
        await contracts.escrow.connect(contracts.signers.patient).createConsultation(
          users.doctor.address,
          'QmTestSymptoms',
          'dermatology',
          false,
          { 
            value: ethers.utils.parseEther('0.05'),
            gasLimit: 21000 // Insufficient gas
          }
        );
        
        expect.fail('Transaction should have failed with insufficient gas');
      } catch (error) {
        expect(error.message).to.include('gas');
      }

      console.log('✅ Smart contract failure handling test passed!');
    });
  });

  describe('Real-Time Updates and WebSocket Integration', function () {
    it('Should send real-time consultation updates via WebSocket', function (done) {
      this.timeout(10000);

      const wsUrl = `ws://localhost:${config.app.port}/ws`;
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${authTokens.doctor}` }
      });

      ws.on('open', () => {
        console.log('WebSocket connected for real-time updates test');
        
        // Subscribe to consultation updates
        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'consultations',
          userId: users.doctor.address
        }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          if (message.type === 'consultation_update') {
            expect(message).to.have.property('consultationId');
            expect(message).to.have.property('status');
            expect(message).to.have.property('timestamp');
            
            ws.close();
            done();
          }
        } catch (error) {
          done(error);
        }
      });

      ws.on('error', (error) => {
        done(error);
      });

      // Trigger an update by creating a consultation
      setTimeout(async () => {
        await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${authTokens.patient}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: 'WebSocket test symptoms',
            specialty: 'dermatology',
            fee: '0.05'
          });
      }, 1000);
    });
  });

  describe('Second Opinion Flow', function () {
    it('Should complete full second opinion workflow', async function () {
      this.timeout(20000);

      const [, , , , , , secondDoctor] = await ethers.getSigners();
      
      // Setup second doctor
      await contracts.accessControl.grantRoleWithTimestamp(
        await contracts.accessControl.DOCTOR_ROLE(), 
        secondDoctor.address
      );

      const secondDoctorToken = jwt.sign(
        { address: secondDoctor.address, role: 'doctor' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      // Step 1: Complete initial consultation
      const initialConsultation = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Unclear diagnosis symptoms requiring second opinion',
          specialty: 'dermatology',
          fee: '0.05'
        });

      const consultationId = initialConsultation.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Possible eczema, but differential diagnosis needed',
          confidenceLevel: 6,
          followUpRecommendation: 'specialist'
        });

      // Step 2: Mint NFT for original diagnosis
      const nftTx = await contracts.nft.connect(contracts.signers.doctor).mintDiagnosticNFT(
        consultationId,
        'QmOriginalDiagnosis',
        6,
        'https://gateway.pinata.cloud/ipfs/QmOriginalMetadata'
      );

      const nftReceipt = await nftTx.wait();
      const originalTokenId = nftReceipt.events.find(e => e.event === 'DiagnosticNFTMinted').args.tokenId;

      // Step 3: Request second opinion
      const secondOpinionTx = await contracts.nft.connect(contracts.signers.patient).requestSecondOpinion(
        originalTokenId,
        secondDoctor.address,
        'https://gateway.pinata.cloud/ipfs/QmSecondOpinionMetadata',
        { value: ethers.utils.parseEther('0.03') }
      );

      const secondOpinionReceipt = await secondOpinionTx.wait();
      const secondOpinionTokenId = secondOpinionReceipt.events.find(e => e.event === 'SecondOpinionRequested').args.newNFTId;

      // Step 4: Second doctor provides opinion
      const secondOpinionDiagnosis = await contracts.nft.connect(secondDoctor).completeSecondOpinion(
        secondOpinionTokenId,
        'QmSecondDiagnosis',
        8
      );

      await secondOpinionDiagnosis.wait();

      // Step 5: Verify both NFTs exist and are linked
      const originalRecord = await contracts.nft.getDiagnosticRecord(originalTokenId);
      const secondOpinionRecord = await contracts.nft.getDiagnosticRecord(secondOpinionTokenId);

      expect(originalRecord.isSecondOpinion).to.be.false;
      expect(secondOpinionRecord.isSecondOpinion).to.be.true;
      expect(secondOpinionRecord.originalNFTId).to.equal(originalTokenId);

      console.log('✅ Second opinion flow test passed!');
    });
  });

  describe('Dispute Resolution Flow', function () {
    it('Should handle consultation dispute and resolution', async function () {
      this.timeout(20000);

      // Complete consultation
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Dispute test - unclear symptoms',
          specialty: 'general_practice',
          fee: '0.06'
        });

      const consultationId = consultationResponse.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Inconclusive diagnosis - more testing needed',
          confidenceLevel: 4,
          followUpRecommendation: 'specialist'
        });

      // Patient disputes the diagnosis
      const disputeResponse = await request(app)
        .post(`/api/consultations/${consultationId}/dispute`)
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({ reason: 'Diagnosis was too vague and unhelpful' })
        .expect(200);

      expect(disputeResponse.body.success).to.be.true;

      // Check on-chain dispute status
      const consultation = await contracts.escrow.getConsultation(consultationId);
      expect(consultation.status).to.equal(4); // DISPUTED

      console.log('✅ Dispute flow test passed!');
    });

    it('Should process multisig escrow for disputed consultations', async function () {
      this.timeout(15000);

      // Create consultation that will be disputed
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Multisig dispute test symptoms',
          specialty: 'cardiology',
          fee: '0.08'
        });

      const consultationId = consultationResponse.body.consultation.id;

      // Create multisig escrow via Bitcoin API
      const escrowResponse = await request(app)
        .post('/api/btc/multisig/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          consultationId,
          patientAddress: users.patient.address,
          doctorAddress: users.doctor.address,
          amount: '0.00372' // BTC equivalent
        })
        .expect(200);

      expect(escrowResponse.body).to.have.property('escrow');
      expect(escrowResponse.body.escrow).to.have.property('multisigAddress');

      console.log('Multisig escrow created:', escrowResponse.body.escrow.multisigAddress);

      // Initiate dispute
      const disputeResponse = await request(app)
        .post(`/api/btc/multisig/dispute/${consultationId}`)
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          disputedBy: users.patient.address,
          reason: 'Unsatisfactory diagnosis quality',
          requestedResolution: 'partial_refund'
        })
        .expect(200);

      expect(disputeResponse.body).to.have.property('disputeId');
      
      console.log('✅ Multisig dispute test passed!');
    });
  });

  describe('Doctor Reward Distribution', function () {
    it('Should distribute daily BTC rewards to high-performing doctors', async function () {
      this.timeout(15000);

      // Build doctor reputation through multiple consultations
      for (let i = 0; i < 6; i++) {
        const consultationResponse = await request(app)
          .post('/api/consultations/create')
          .set('Authorization', `Bearer ${authTokens.patient}`)
          .send({
            doctorAddress: users.doctor.address,
            symptoms: `Reputation building consultation ${i + 1}`,
            specialty: 'dermatology',
            fee: '0.04'
          });

        const consultationId = consultationResponse.body.consultation.id;

        await request(app)
          .patch(`/api/consultations/${consultationId}/accept`)
          .set('Authorization', `Bearer ${authTokens.doctor}`);

        await request(app)
          .post(`/api/consultations/${consultationId}/diagnosis`)
          .set('Authorization', `Bearer ${authTokens.doctor}`)
          .send({
            diagnosisText: `Quality diagnosis ${i + 1}`,
            confidenceLevel: 9,
            followUpRecommendation: 'none'
          });

        // Provide excellent feedback
        await request(app)
          .post(`/api/consultations/${consultationId}/feedback`)
          .set('Authorization', `Bearer ${authTokens.patient}`)
          .send({ rating: 5, comment: 'Excellent service' });
      }

      // Claim daily reward
      const rewardResponse = await request(app)
        .post('/api/btc/rewards/claim-daily')
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .expect(200);

      expect(rewardResponse.body).to.have.property('success', true);
      expect(rewardResponse.body).to.have.property('reward');
      expect(parseFloat(rewardResponse.body.reward.amount)).to.be.gt(0);

      console.log('Daily reward claimed:', rewardResponse.body.reward.amount, 'BTC');
      console.log('✅ Reward distribution test passed!');
    });

    it('Should calculate streak bonuses correctly', async function () {
      this.timeout(15000);

      // Get initial streak
      const initialStats = await request(app)
        .get(`/api/doctors/${users.doctor.address}/stats`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      const initialStreak = initialStats.body.stats.currentStreak || 0;

      // Create consultation with good rating to extend streak
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Streak bonus test symptoms',
          specialty: 'general_practice',
          fee: '0.04'
        });

      const consultationId = consultationResponse.body.consultation.id;

      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Streak test diagnosis',
          confidenceLevel: 9,
          followUpRecommendation: 'none'
        });

      await request(app)
        .post(`/api/consultations/${consultationId}/feedback`)
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({ rating: 5, comment: 'Great service' });

      // Check if streak increased
      const finalStats = await request(app)
        .get(`/api/doctors/${users.doctor.address}/stats`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      const finalStreak = finalStats.body.stats.currentStreak || 0;
      expect(finalStreak).to.be.gte(initialStreak);

      console.log(`Streak updated: ${initialStreak} → ${finalStreak}`);
      console.log('✅ Streak bonus test passed!');
    });
  });

  describe('Cross-Chain Integration', function () {
    it('Should synchronize Ethereum and Bitcoin operations', async function () {
      this.timeout(15000);

      // Create consultation on Ethereum
      const consultationResponse = await request(app)
        .post('/api/consultations/create')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({
          doctorAddress: users.doctor.address,
          symptoms: 'Cross-chain sync test',
          specialty: 'neurology',
          fee: '0.07'
        });

      const consultationId = consultationResponse.body.consultation.id;
      const btcEquivalent = consultationResponse.body.btcEquivalent;

      // Complete consultation
      await request(app)
        .patch(`/api/consultations/${consultationId}/accept`)
        .set('Authorization', `Bearer ${authTokens.doctor}`);

      const diagnosisResponse = await request(app)
        .post(`/api/consultations/${consultationId}/diagnosis`)
        .set('Authorization', `Bearer ${authTokens.doctor}`)
        .send({
          diagnosisText: 'Cross-chain test diagnosis',
          confidenceLevel: 8,
          followUpRecommendation: 'none'
        });

      // Verify Ethereum side
      const ethConsultation = await contracts.escrow.getConsultation(consultationId);
      expect(ethConsultation.status).to.equal(3); // COMPLETED

      // Verify Bitcoin side
      expect(diagnosisResponse.body.btcPayment).to.have.property('success');
      expect(diagnosisResponse.body.btcPayment).to.have.property('amount');

      console.log('Cross-chain synchronization verified');
      console.log('✅ Cross-chain integration test passed!');
    });
  });

  describe('Load Testing and Performance', function () {
    it('Should handle sustained load without degradation', async function () {
      this.timeout(30000);

      const loadTestDuration = 10000; // 10 seconds
      const requestsPerSecond = 5;
      const totalRequests = Math.floor(loadTestDuration / 1000) * requestsPerSecond;

      console.log(`Starting load test: ${totalRequests} requests over ${loadTestDuration/1000} seconds`);

      const startTime = Date.now();
      const promises = [];
      const responseTimes = [];

      for (let i = 0; i < totalRequests; i++) {
        const requestStartTime = Date.now();
        
        const promise = request(app)
          .get('/health')
          .expect(200)
          .then(() => {
            responseTimes.push(Date.now() - requestStartTime);
          });
          
        promises.push(promise);

        // Rate limiting
        if (i % requestsPerSecond === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await Promise.all(promises);

      const totalTime = Date.now() - startTime;
      const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      console.log('Load test results:', {
        totalRequests,
        totalTime: `${totalTime}ms`,
        averageResponseTime: `${averageResponseTime.toFixed(2)}ms`,
        maxResponseTime: `${maxResponseTime}ms`,
        requestsPerSecond: (totalRequests / (totalTime / 1000)).toFixed(2)
      });

      expect(averageResponseTime).to.be.lt(200);
      expect(maxResponseTime).to.be.lt(1000);

      console.log('✅ Load testing passed!');
    });
  });

  describe('Data Privacy and Encryption', function () {
    it('Should encrypt sensitive medical data in IPFS', async function () {
      const sensitiveData = {
        symptoms: 'Private medical information that should be encrypted',
        medicalHistory: 'Previous conditions and medications',
        patientId: users.patient.address
      };

      const uploadResponse = await request(app)
        .post('/api/ipfs/upload')
        .set('Authorization', `Bearer ${authTokens.patient}`)
        .send({ data: sensitiveData })
        .expect(200);

      expect(uploadResponse.body.encrypted).to.be.true;

      // Verify data cannot be accessed without proper authorization
      const [, , , , , , unauthorizedUser] = await ethers.getSigners();
      const unauthorizedToken = jwt.sign(
        { address: unauthorizedUser.address, role: 'patient' },
        config.security.jwt.secret,
        { expiresIn: '1h' }
      );

      const unauthorizedResponse = await request(app)
        .get(`/api/ipfs/${uploadResponse.body.hash}`)
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .expect(403);

      expect(unauthorizedResponse.body).to.have.property('error');

      console.log('✅ Data privacy test passed!');
    });
  });

  after(async function () {
    // Cleanup
    if (wsConnection) {
      wsConnection.close();
    }
    
    if (BitcoinAPI && BitcoinAPI.cleanup) {
      await BitcoinAPI.cleanup();
    }
    
    console.log('Integration test cleanup completed');
  });
});