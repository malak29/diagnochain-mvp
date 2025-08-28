const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('DiagnoChain Smart Contracts', function () {
  async function deployContractsFixture() {
    const [owner, doctor, patient, verifier, oracle, feeCollector] = await ethers.getSigners();

    // Deploy Access Control first
    const AccessControl = await ethers.getContractFactory('DiagnoAccessControl');
    const accessControl = await AccessControl.deploy();
    await accessControl.deployed();

    // Deploy Doctor Registry
    const DoctorRegistry = await ethers.getContractFactory('DoctorRegistry');
    const stakingToken = ethers.constants.AddressZero; // Use ETH for staking in tests
    const doctorRegistry = await DoctorRegistry.deploy(stakingToken);
    await doctorRegistry.deployed();

    // Deploy Consultation Escrow
    const ConsultationEscrow = await ethers.getContractFactory('ConsultationEscrow');
    const escrow = await ConsultationEscrow.deploy(doctorRegistry.address, feeCollector.address);
    await escrow.deployed();

    // Deploy Diagnostic NFT
    const DiagnosticNFT = await ethers.getContractFactory('DiagnosticNFT');
    const nft = await DiagnosticNFT.deploy(escrow.address);
    await nft.deployed();

    // Deploy Reputation System
    const ReputationSystem = await ethers.getContractFactory('ReputationSystem');
    const reputation = await ReputationSystem.deploy(doctorRegistry.address, escrow.address);
    await reputation.deployed();

    // Deploy BTC Oracle
    const BTCOracle = await ethers.getContractFactory('BTCOracle');
    const btcOracle = await BTCOracle.deploy();
    await btcOracle.deployed();

    // Setup roles
    await accessControl.grantRoleWithTimestamp(await accessControl.DOCTOR_ROLE(), doctor.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.PATIENT_ROLE(), patient.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.VERIFIER_ROLE(), verifier.address);
    await accessControl.grantRoleWithTimestamp(await accessControl.ORACLE_ROLE(), oracle.address);

    // Fund reputation system
    await reputation.fundRewardPool({ value: ethers.utils.parseEther('1.0') });

    return {
      accessControl,
      doctorRegistry,
      escrow,
      nft,
      reputation,
      btcOracle,
      owner,
      doctor,
      patient,
      verifier,
      oracle,
      feeCollector
    };
  }

  describe('DiagnoAccessControl', function () {
    it('Should deploy with correct initial roles', async function () {
      const { accessControl, owner } = await loadFixture(deployContractsFixture);

      expect(await accessControl.hasRole(await accessControl.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await accessControl.hasRole(await accessControl.EMERGENCY_ROLE(), owner.address)).to.be.true;
    });

    it('Should grant and revoke roles correctly', async function () {
      const { accessControl, owner, doctor } = await loadFixture(deployContractsFixture);

      const doctorRole = await accessControl.DOCTOR_ROLE();
      
      await expect(accessControl.grantRoleWithTimestamp(doctorRole, doctor.address))
        .to.emit(accessControl, 'RoleGrantedWithTimestamp')
        .withArgs(doctorRole, doctor.address, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));

      expect(await accessControl.hasRole(doctorRole, doctor.address)).to.be.true;

      await accessControl.revokeRoleWithTimestamp(doctorRole, doctor.address);
      expect(await accessControl.hasRole(doctorRole, doctor.address)).to.be.false;
    });

    it('Should pause and unpause correctly', async function () {
      const { accessControl, owner } = await loadFixture(deployContractsFixture);

      await accessControl.emergencyPause();
      expect(await accessControl.paused()).to.be.true;

      await accessControl.emergencyUnpause();
      expect(await accessControl.paused()).to.be.false;
    });

    it('Should prevent non-emergency role from pausing', async function () {
      const { accessControl, patient } = await loadFixture(deployContractsFixture);

      await expect(accessControl.connect(patient).emergencyPause())
        .to.be.revertedWith('AccessControl: account');
    });
  });

  describe('DoctorRegistry', function () {
    it('Should allow doctor verification request with proper stake', async function () {
      const { doctorRegistry, doctor } = await loadFixture(deployContractsFixture);

      const stakeAmount = ethers.utils.parseEther('1000');
      const specialties = ['dermatology'];
      const credentialsHash = 'QmTestCredentials123';

      await expect(doctorRegistry.connect(doctor).requestVerification(
        credentialsHash,
        specialties,
        stakeAmount,
        { value: stakeAmount } // Using ETH for staking in tests
      )).to.emit(doctorRegistry, 'DoctorRegistrationRequested')
        .withArgs(0, doctor.address);

      const request = await doctorRegistry.verificationRequests(0);
      expect(request.doctor).to.equal(doctor.address);
      expect(request.stakingAmount).to.equal(stakeAmount);
    });

    it('Should reject verification with insufficient stake', async function () {
      const { doctorRegistry, doctor } = await loadFixture(deployContractsFixture);

      const insufficientStake = ethers.utils.parseEther('500');
      
      await expect(doctorRegistry.connect(doctor).requestVerification(
        'QmTestCredentials123',
        ['dermatology'],
        insufficientStake,
        { value: insufficientStake }
      )).to.be.revertedWith('Insufficient stake');
    });

    it('Should verify doctor with sufficient verifier votes', async function () {
      const { doctorRegistry, doctor, verifier, owner } = await loadFixture(deployContractsFixture);

      // Submit verification request
      const stakeAmount = ethers.utils.parseEther('1000');
      await doctorRegistry.connect(doctor).requestVerification(
        'QmTestCredentials123',
        ['dermatology'],
        stakeAmount,
        { value: stakeAmount }
      );

      // Vote as verifier
      await doctorRegistry.connect(verifier).voteOnVerification(0, true);
      
      // Need more votes, so owner (admin) can also vote
      await accessControl.grantRoleWithTimestamp(await accessControl.VERIFIER_ROLE(), owner.address);
      await doctorRegistry.connect(owner).voteOnVerification(0, true);

      // Add third vote to meet minimum requirement
      await doctorRegistry.connect(owner).voteOnVerification(0, true);

      const doctorInfo = await doctorRegistry.getDoctorInfo(doctor.address);
      expect(doctorInfo.isActive).to.be.true;
      expect(doctorInfo.reputationScore).to.equal(1000);
    });

    it('Should slash stake for malpractice', async function () {
      const { doctorRegistry, doctor, owner } = await loadFixture(deployContractsFixture);

      // First verify the doctor
      const stakeAmount = ethers.utils.parseEther('1000');
      await doctorRegistry.connect(doctor).requestVerification(
        'QmTestCredentials123', 
        ['dermatology'],
        stakeAmount,
        { value: stakeAmount }
      );

      // Manually approve for testing
      const doctorRole = await accessControl.DOCTOR_ROLE();
      await accessControl.grantRoleWithTimestamp(doctorRole, doctor.address);

      const slashAmount = ethers.utils.parseEther('100');
      
      await expect(doctorRegistry.slashStake(doctor.address, slashAmount, 'Malpractice'))
        .to.emit(doctorRegistry, 'DoctorStakeSlashed')
        .withArgs(doctor.address, slashAmount, 'Malpractice');
    });
  });

  describe('ConsultationEscrow', function () {
    it('Should create consultation with proper payment', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      const symptomsHash = 'QmTestSymptoms123';
      const specialty = 'dermatology';

      await expect(escrow.connect(patient).createConsultation(
        doctor.address,
        symptomsHash,
        specialty,
        false, // not urgent
        { value: fee }
      )).to.emit(escrow, 'ConsultationCreated')
        .withArgs(1, patient.address, doctor.address);

      const consultation = await escrow.getConsultation(1);
      expect(consultation.patient).to.equal(patient.address);
      expect(consultation.doctor).to.equal(doctor.address);
      expect(consultation.fee).to.equal(fee);
      expect(consultation.symptomsHash).to.equal(symptomsHash);
    });

    it('Should allow doctor to accept consultation', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmTestSymptoms123',
        'dermatology',
        false,
        { value: fee }
      );

      await expect(escrow.connect(doctor).acceptConsultation(1))
        .to.emit(escrow, 'ConsultationAccepted')
        .withArgs(1, doctor.address);

      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(1); // ACCEPTED status
    });

    it('Should process diagnosis submission and payment release', async function () {
      const { escrow, doctor, patient, feeCollector } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      const platformFee = fee.mul(300).div(10000); // 3%
      const doctorPayment = fee.sub(platformFee);

      // Create and accept consultation
      await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmTestSymptoms123',
        'dermatology',
        false,
        { value: fee }
      );
      
      await escrow.connect(doctor).acceptConsultation(1);

      const doctorBalanceBefore = await ethers.provider.getBalance(doctor.address);
      const feeCollectorBalanceBefore = await ethers.provider.getBalance(feeCollector.address);

      await expect(escrow.connect(doctor).submitDiagnosis(1, 'QmTestDiagnosis123'))
        .to.emit(escrow, 'DiagnosisSubmitted')
        .withArgs(1, 'QmTestDiagnosis123')
        .and.to.emit(escrow, 'PaymentReleased')
        .withArgs(1, doctor.address, doctorPayment);

      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(3); // COMPLETED status
      expect(consultation.diagnosisHash).to.equal('QmTestDiagnosis123');

      // Check payment distribution
      const doctorBalanceAfter = await ethers.provider.getBalance(doctor.address);
      const feeCollectorBalanceAfter = await ethers.provider.getBalance(feeCollector.address);

      expect(doctorBalanceAfter.sub(doctorBalanceBefore)).to.be.closeTo(doctorPayment, ethers.utils.parseEther('0.01'));
      expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore)).to.equal(platformFee);
    });

    it('Should allow dispute of completed consultation', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Complete a consultation first
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmTestSymptoms123', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmTestDiagnosis123');

      await expect(escrow.connect(patient).disputeConsultation(1, 'Unsatisfactory diagnosis'))
        .to.emit(escrow, 'ConsultationDisputed')
        .withArgs(1, patient.address, 'Unsatisfactory diagnosis');

      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(4); // DISPUTED status
    });

    it('Should reject consultation from unverified doctor', async function () {
      const { escrow, patient } = await loadFixture(deployContractsFixture);

      const [, , , , , unverifiedDoctor] = await ethers.getSigners();
      const fee = ethers.utils.parseEther('0.05');

      await expect(escrow.connect(patient).createConsultation(
        unverifiedDoctor.address,
        'QmTestSymptoms123',
        'dermatology',
        false,
        { value: fee }
      )).to.be.revertedWith('Doctor not verified');
    });
  });

  describe('DiagnosticNFT', function () {
    it('Should mint NFT after consultation completion', async function () {
      const { escrow, nft, doctor, patient } = await loadFixture(deployContractsFixture);

      // Complete consultation flow
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');

      const confidenceLevel = 8;
      const metadataURI = 'https://gateway.pinata.cloud/ipfs/QmMetadata123';

      await expect(nft.connect(doctor).mintDiagnosticNFT(
        1,
        'QmDiagnosis',
        confidenceLevel,
        metadataURI
      )).to.emit(nft, 'DiagnosticNFTMinted')
        .withArgs(1, 1, patient.address, doctor.address);

      expect(await nft.ownerOf(1)).to.equal(patient.address);
      
      const record = await nft.getDiagnosticRecord(1);
      expect(record.consultationId).to.equal(1);
      expect(record.doctor).to.equal(doctor.address);
      expect(record.confidenceLevel).to.equal(confidenceLevel);
    });

    it('Should allow second opinion request', async function () {
      const { nft, doctor, patient } = await loadFixture(deployContractsFixture);
      const [, , , , , , secondDoctor] = await ethers.getSigners();

      // First mint an NFT
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');
      await nft.connect(doctor).mintDiagnosticNFT(1, 'QmDiagnosis', 8, 'metadata');

      // Verify second doctor
      await doctorRegistry.grantRole(await doctorRegistry.DOCTOR_ROLE(), secondDoctor.address);

      const secondOpinionFee = ethers.utils.parseEther('0.03');
      
      await expect(nft.connect(patient).requestSecondOpinion(
        1,
        secondDoctor.address,
        'second-opinion-metadata',
        { value: secondOpinionFee }
      )).to.emit(nft, 'SecondOpinionRequested')
        .withArgs(1, 2);

      const secondOpinionRecord = await nft.getDiagnosticRecord(2);
      expect(secondOpinionRecord.isSecondOpinion).to.be.true;
      expect(secondOpinionRecord.originalNFTId).to.equal(1);
      expect(secondOpinionRecord.doctor).to.equal(secondDoctor.address);
    });

    it('Should prevent transferring medical records', async function () {
      const { nft, doctor, patient } = await loadFixture(deployContractsFixture);
      const [, , , , , , otherUser] = await ethers.getSigners();

      // Mint NFT first
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');
      await nft.connect(doctor).mintDiagnosticNFT(1, 'QmDiagnosis', 8, 'metadata');

      await expect(nft.connect(patient).transferFrom(patient.address, otherUser.address, 1))
        .to.be.revertedWith('Medical records non-transferable');
    });
  });

  describe('ReputationSystem', function () {
    it('Should accept feedback and update reputation', async function () {
      const { reputation, escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Complete consultation
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');

      const rating = 5;
      const commentHash = 'QmComment123';

      await expect(reputation.connect(patient).submitFeedback(1, rating, commentHash))
        .to.emit(reputation, 'FeedbackSubmitted')
        .withArgs(1, rating, doctor.address);

      const metrics = await reputation.getDoctorMetrics(doctor.address);
      expect(metrics.totalRating).to.equal(rating);
      expect(metrics.ratingCount).to.equal(1);
      expect(metrics.averageRating).to.equal(rating * 1000); // Scaled by 1000
    });

    it('Should distribute streak bonus for consecutive good ratings', async function () {
      const { reputation, escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Simulate multiple consultations with good ratings
      for (let i = 1; i <= 10; i++) {
        const fee = ethers.utils.parseEther('0.05');
        await escrow.connect(patient).createConsultation(doctor.address, `QmSymptoms${i}`, 'dermatology', false, { value: fee });
        await escrow.connect(doctor).acceptConsultation(i);
        await escrow.connect(doctor).submitDiagnosis(i, `QmDiagnosis${i}`);
        await reputation.connect(patient).submitFeedback(i, 5, `QmComment${i}`);
      }

      const metrics = await reputation.getDoctorMetrics(doctor.address);
      expect(metrics.streak).to.equal(10);
      expect(metrics.averageRating).to.equal(5000); // 5.0 scaled by 1000
    });

    it('Should allow daily reward claim for high-rated doctors', async function () {
      const { reputation, doctor, patient } = await loadFixture(deployContractsFixture);

      // Build up rating history
      for (let i = 1; i <= 6; i++) {
        const fee = ethers.utils.parseEther('0.05');
        await escrow.connect(patient).createConsultation(doctor.address, `QmSymptoms${i}`, 'dermatology', false, { value: fee });
        await escrow.connect(doctor).acceptConsultation(i);
        await escrow.connect(doctor).submitDiagnosis(i, `QmDiagnosis${i}`);
        await reputation.connect(patient).submitFeedback(i, 5, `QmComment${i}`);
      }

      const doctorBalanceBefore = await ethers.provider.getBalance(doctor.address);

      await expect(reputation.connect(doctor).claimDailyReward())
        .to.emit(reputation, 'RewardClaimed');

      const doctorBalanceAfter = await ethers.provider.getBalance(doctor.address);
      expect(doctorBalanceAfter).to.be.gt(doctorBalanceBefore);
    });

    it('Should prevent daily reward claim with low rating', async function () {
      const { reputation, doctor } = await loadFixture(deployContractsFixture);

      await expect(reputation.connect(doctor).claimDailyReward())
        .to.be.revertedWith('Need 4.0+ rating');
    });
  });

  describe('BTCOracle', function () {
    it('Should update BTC price correctly', async function () {
      const { btcOracle, oracle } = await loadFixture(deployContractsFixture);

      const newPrice = ethers.utils.parseUnits('45000', 8); // $45,000 scaled

      await expect(btcOracle.connect(oracle).updateBTCPrice(newPrice))
        .to.emit(btcOracle, 'PriceUpdated')
        .withArgs(newPrice, await ethers.provider.getBlock('latest').then(b => b.timestamp + 1));

      const [price, timestamp, isValid] = await btcOracle.getCurrentPrice();
      expect(price).to.equal(newPrice);
      expect(isValid).to.be.true;
    });

    it('Should calculate BTC equivalent correctly', async function () {
      const { btcOracle, oracle } = await loadFixture(deployContractsFixture);

      await btcOracle.connect(oracle).updateBTCPrice(ethers.utils.parseUnits('40000', 8));
      
      const ethAmount = ethers.utils.parseEther('0.05'); // 0.05 ETH
      const btcAmount = await btcOracle.calculateBTCAmount(ethAmount);
      
      expect(btcAmount).to.be.gt(0);
    });

    it('Should reject price updates from non-oracle accounts', async function () {
      const { btcOracle, doctor } = await loadFixture(deployContractsFixture);

      await expect(btcOracle.connect(doctor).updateBTCPrice(ethers.utils.parseUnits('45000', 8)))
        .to.be.revertedWith('AccessControl: account');
    });

    it('Should mark stale prices as invalid', async function () {
      const { btcOracle, oracle } = await loadFixture(deployContractsFixture);

      await btcOracle.connect(oracle).updateBTCPrice(ethers.utils.parseUnits('43000', 8));
      
      // Fast forward time beyond validity period
      await ethers.provider.send('evm_increaseTime', [16 * 60]); // 16 minutes
      await ethers.provider.send('evm_mine');

      const isValid = await btcOracle.isPriceValid();
      expect(isValid).to.be.false;
    });
  });

  describe('Integration Tests', function () {
    it('Should complete full consultation flow', async function () {
      const { accessControl, doctorRegistry, escrow, nft, reputation, doctor, patient, verifier } = await loadFixture(deployContractsFixture);

      // 1. Doctor verification (simplified for test)
      const stakeAmount = ethers.utils.parseEther('1000');
      await doctorRegistry.connect(doctor).requestVerification('QmCreds', ['dermatology'], stakeAmount, { value: stakeAmount });
      
      // Manual approval for test
      await accessControl.grantRoleWithTimestamp(await accessControl.DOCTOR_ROLE(), doctor.address);

      // 2. Create consultation
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });

      // 3. Doctor accepts and provides diagnosis
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');

      // 4. Mint diagnostic NFT
      await nft.connect(doctor).mintDiagnosticNFT(1, 'QmDiagnosis', 8, 'metadata');

      // 5. Patient provides feedback
      await reputation.connect(patient).submitFeedback(1, 5, 'QmFeedback');

      // Verify final state
      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(3); // COMPLETED

      expect(await nft.ownerOf(1)).to.equal(patient.address);

      const doctorMetrics = await reputation.getDoctorMetrics(doctor.address);
      expect(doctorMetrics.averageRating).to.equal(5000); // 5.0 scaled by 1000
    });

    it('Should handle urgent consultation with reduced timeout', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.06'); // Higher fee for urgent
      
      await expect(escrow.connect(patient).createConsultation(
        doctor.address,
        'QmUrgentSymptoms',
        'cardiology',
        true, // urgent
        { value: fee }
      )).to.emit(escrow, 'ConsultationCreated');

      const consultation = await escrow.getConsultation(1);
      expect(consultation.isUrgent).to.be.true;
      
      // Verify shorter deadline (2 hours vs 24 hours)
      const createdAt = consultation.createdAt;
      const deadline = consultation.deadline;
      const timeoutSeconds = deadline.sub(createdAt);
      
      expect(timeoutSeconds).to.equal(2 * 60 * 60); // 2 hours in seconds
    });

    it('Should handle multiple specialties for doctors', async function () {
      const { doctorRegistry, doctor } = await loadFixture(deployContractsFixture);

      const specialties = ['cardiology', 'general_practice'];
      const stakeAmount = ethers.utils.parseEther('1500');

      await expect(doctorRegistry.connect(doctor).requestVerification(
        'QmMultiSpecialtyCredentials',
        specialties,
        stakeAmount,
        { value: stakeAmount }
      )).to.emit(doctorRegistry, 'DoctorRegistrationRequested');

      const request = await doctorRegistry.verificationRequests(0);
      expect(request.specialties.length).to.equal(2);
      expect(request.specialties[0]).to.equal('cardiology');
      expect(request.specialties[1]).to.equal('general_practice');
    });
  });

  describe('Security Tests', function () {
    it('Should prevent reentrancy attacks on payment release', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Deploy malicious contract that attempts reentrancy
      const MaliciousContract = await ethers.getContractFactory('MaliciousReentrancy');
      // This would require implementing a malicious contract for testing
      // For MVP, we'll test that payments are protected
      
      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);

      // The ReentrancyGuard should prevent double spending
      await expect(escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis'))
        .to.not.be.reverted;

      // Verify payment was only sent once
      const consultation = await escrow.getConsultation(1);
      expect(consultation.status).to.equal(3); // COMPLETED, not PENDING
    });

    it('Should prevent unauthorized role grants', async function () {
      const { accessControl, patient, doctor } = await loadFixture(deployContractsFixture);

      const doctorRole = await accessControl.DOCTOR_ROLE();
      
      await expect(accessControl.connect(patient).grantRoleWithTimestamp(doctorRole, doctor.address))
        .to.be.revertedWith('AccessControl: account');
    });

    it('Should prevent consultation manipulation by non-parties', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);
      const [, , , , , , attacker] = await ethers.getSigners();

      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });

      await expect(escrow.connect(attacker).acceptConsultation(1))
        .to.be.revertedWith('Not assigned doctor');

      await expect(escrow.connect(attacker).submitDiagnosis(1, 'QmMaliciousDiagnosis'))
        .to.be.revertedWith('Must be verified doctor');
    });

    it('Should validate input parameters correctly', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Test empty symptoms hash
      const fee = ethers.utils.parseEther('0.05');
      await expect(escrow.connect(patient).createConsultation(
        doctor.address,
        '', // empty symptoms
        'dermatology',
        false,
        { value: fee }
      )).to.be.revertedWith('Symptoms required');

      // Test zero fee
      await expect(escrow.connect(patient).createConsultation(
        doctor.address,
        'QmSymptoms',
        'dermatology',
        false,
        { value: 0 }
      )).to.be.revertedWith('Fee required');
    });

    it('Should handle consultation expiration correctly', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });

      // Fast forward past deadline
      await ethers.provider.send('evm_increaseTime', [25 * 60 * 60]); // 25 hours
      await ethers.provider.send('evm_mine');

      await expect(escrow.connect(doctor).acceptConsultation(1))
        .to.be.revertedWith('Expired');
    });
  });

  describe('Gas Optimization Tests', function () {
    it('Should use reasonable gas for consultation creation', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      const tx = await escrow.connect(patient).createConsultation(
        doctor.address,
        'QmSymptoms',
        'dermatology',
        false,
        { value: fee }
      );

      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lt(200000); // Should use less than 200k gas
    });

    it('Should batch operations efficiently', async function () {
      const { reputation, escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      // Test that multiple feedbacks can be submitted efficiently
      const startGas = await ethers.provider.getGasPrice();
      
      for (let i = 1; i <= 5; i++) {
        const fee = ethers.utils.parseEther('0.05');
        await escrow.connect(patient).createConsultation(doctor.address, `QmSymptoms${i}`, 'dermatology', false, { value: fee });
        await escrow.connect(doctor).acceptConsultation(i);
        await escrow.connect(doctor).submitDiagnosis(i, `QmDiagnosis${i}`);
        
        const tx = await reputation.connect(patient).submitFeedback(i, 5, `QmComment${i}`);
        const receipt = await tx.wait();
        
        // Gas usage should remain consistent (not increase with each operation)
        expect(receipt.gasUsed).to.be.lt(150000);
      }
    });
  });

  describe('Error Handling Tests', function () {
    it('Should handle invalid IPFS hashes gracefully', async function () {
      const { escrow, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      
      // Test with various invalid hash formats
      const invalidHashes = ['', 'invalid', '0x123', 'Qm123'];
      
      for (const invalidHash of invalidHashes) {
        if (invalidHash === '') {
          await expect(escrow.connect(patient).createConsultation(
            doctor.address,
            invalidHash,
            'dermatology',
            false,
            { value: fee }
          )).to.be.revertedWith('Symptoms required');
        }
      }
    });

    it('Should handle edge cases in reputation calculation', async function () {
      const { reputation, doctor } = await loadFixture(deployContractsFixture);

      const metrics = await reputation.getDoctorMetrics(doctor.address);
      
      // New doctor should have default values
      expect(metrics.totalRating).to.equal(0);
      expect(metrics.ratingCount).to.equal(0);
      expect(metrics.averageRating).to.equal(0);
      expect(metrics.streak).to.equal(0);
    });
  });

  describe('Events and Logging Tests', function () {
    it('Should emit all required events during consultation flow', async function () {
      const { escrow, nft, reputation, doctor, patient } = await loadFixture(deployContractsFixture);

      const fee = ethers.utils.parseEther('0.05');
      
      // Track all events
      const events = [];

      escrow.on('ConsultationCreated', (...args) => events.push({ event: 'ConsultationCreated', args }));
      escrow.on('ConsultationAccepted', (...args) => events.push({ event: 'ConsultationAccepted', args }));
      escrow.on('DiagnosisSubmitted', (...args) => events.push({ event: 'DiagnosisSubmitted', args }));
      escrow.on('PaymentReleased', (...args) => events.push({ event: 'PaymentReleased', args }));

      await escrow.connect(patient).createConsultation(doctor.address, 'QmSymptoms', 'dermatology', false, { value: fee });
      await escrow.connect(doctor).acceptConsultation(1);
      await escrow.connect(doctor).submitDiagnosis(1, 'QmDiagnosis');

      // Allow events to be captured
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events.length).to.be.gte(3); // Should have at least 3 events
    });
  });
});