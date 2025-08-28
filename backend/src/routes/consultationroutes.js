const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const Web3 = require('web3');
const Contract = require('web3-eth-contract');

const authMiddleware = require('../middleware/authMiddleware');
const btcService = require('../services/btcService');
const ipfsService = require('../services/ipfsService');
const logger = require('../utils/logger');

const router = express.Router();

const consultationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each user to 10 consultation requests per hour
  message: 'Too many consultation requests, please try again later',
  keyGenerator: (req) => req.user.address
});

const web3 = new Web3(process.env.WEB3_PROVIDER_URL || 'http://localhost:8545');

const consultationEscrowABI = require('../contracts/ConsultationEscrow.json');
const escrowContract = new web3.eth.Contract(
  consultationEscrowABI.abi,
  process.env.ESCROW_CONTRACT_ADDRESS
);

const validateConsultationCreation = [
  body('doctorAddress')
    .isEthereumAddress()
    .withMessage('Invalid doctor Ethereum address'),
  body('symptoms')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Symptoms must be between 10 and 1000 characters'),
  body('specialty')
    .isIn(['dermatology', 'cardiology', 'neurology', 'oncology', 'psychiatry', 'general_practice'])
    .withMessage('Invalid medical specialty'),
  body('isUrgent')
    .isBoolean()
    .withMessage('isUrgent must be true or false'),
  body('fee')
    .isNumeric({ min: 0.001 })
    .withMessage('Fee must be at least 0.001 ETH')
];

const validateConsultationId = [
  param('consultationId')
    .isInt({ min: 1 })
    .withMessage('Invalid consultation ID')
];

const validateDiagnosis = [
  body('diagnosisText')
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Diagnosis must be between 20 and 2000 characters'),
  body('confidenceLevel')
    .isInt({ min: 1, max: 10 })
    .withMessage('Confidence level must be between 1 and 10'),
  body('followUpRecommendation')
    .isIn(['none', '1week', '2weeks', '1month', 'specialist', 'emergency'])
    .withMessage('Invalid follow-up recommendation')
];

router.post('/create', 
  consultationLimiter,
  authMiddleware.requireRole('patient'),
  validateConsultationCreation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { doctorAddress, symptoms, specialty, isUrgent, fee } = req.body;

      const encryptedSymptoms = await ipfsService.uploadEncryptedData({
        symptoms,
        patientAddress: req.user.address,
        timestamp: new Date().toISOString(),
        metadata: {
          specialty,
          isUrgent,
          consultationFee: fee
        }
      });

      const btcEquivalent = await btcService.calculateBTCEquivalent(fee);

      const consultation = {
        id: Date.now(),
        patientAddress: req.user.address,
        doctorAddress,
        symptomsHash: encryptedSymptoms.hash,
        specialty,
        fee: fee.toString(),
        btcEquivalent: btcEquivalent.toString(),
        isUrgent,
        status: 'pending',
        createdAt: new Date().toISOString(),
        deadline: new Date(Date.now() + (isUrgent ? 2 : 24) * 60 * 60 * 1000).toISOString()
      };

      logger.info('Consultation created:', {
        consultationId: consultation.id,
        patient: req.user.address,
        doctor: doctorAddress,
        specialty,
        fee,
        isUrgent
      });

      res.status(201).json({
        success: true,
        consultation,
        ipfsHash: encryptedSymptoms.hash,
        btcEquivalent
      });

    } catch (error) {
      logger.error('Error creating consultation:', error);
      res.status(500).json({
        error: 'Failed to create consultation',
        message: error.message
      });
    }
  }
);

router.get('/patient/:address', 
  authMiddleware.requireSelfOrAdmin,
  [query('status').optional().isIn(['pending', 'accepted', 'completed', 'disputed', 'cancelled'])],
  async (req, res) => {
    try {
      const { address } = req.params;
      const { status, limit = 20, offset = 0 } = req.query;

      const consultations = await getPatientConsultations(address, status, limit, offset);

      res.json({
        success: true,
        consultations,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: consultations.length
        }
      });

    } catch (error) {
      logger.error('Error fetching patient consultations:', error);
      res.status(500).json({
        error: 'Failed to fetch consultations'
      });
    }
  }
);

router.get('/doctor/:address',
  authMiddleware.requireRole('doctor'),
  async (req, res) => {
    try {
      const { address } = req.params;
      
      if (req.user.address !== address && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const consultations = await getDoctorConsultations(address);
      
      res.json({
        success: true,
        consultations
      });

    } catch (error) {
      logger.error('Error fetching doctor consultations:', error);
      res.status(500).json({
        error: 'Failed to fetch consultations'
      });
    }
  }
);

router.patch('/:consultationId/accept',
  authMiddleware.requireRole('doctor'),
  validateConsultationId,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { consultationId } = req.params;
      
      const consultation = await getConsultationById(consultationId);
      if (!consultation) {
        return res.status(404).json({ error: 'Consultation not found' });
      }

      if (consultation.doctorAddress !== req.user.address) {
        return res.status(403).json({ error: 'Not assigned doctor' });
      }

      if (consultation.status !== 'pending') {
        return res.status(400).json({ error: 'Consultation already processed' });
      }

      if (new Date() > new Date(consultation.deadline)) {
        return res.status(400).json({ error: 'Consultation expired' });
      }

      consultation.status = 'accepted';
      consultation.acceptedAt = new Date().toISOString();

      logger.info('Consultation accepted:', {
        consultationId,
        doctor: req.user.address,
        acceptedAt: consultation.acceptedAt
      });

      res.json({
        success: true,
        consultation,
        message: 'Consultation accepted successfully'
      });

    } catch (error) {
      logger.error('Error accepting consultation:', error);
      res.status(500).json({
        error: 'Failed to accept consultation'
      });
    }
  }
);

router.post('/:consultationId/diagnosis',
  authMiddleware.requireRole('doctor'),
  validateConsultationId,
  validateDiagnosis,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { consultationId } = req.params;
      const { diagnosisText, confidenceLevel, followUpRecommendation } = req.body;

      const consultation = await getConsultationById(consultationId);
      if (!consultation) {
        return res.status(404).json({ error: 'Consultation not found' });
      }

      if (consultation.doctorAddress !== req.user.address) {
        return res.status(403).json({ error: 'Not assigned doctor' });
      }

      if (consultation.status !== 'accepted') {
        return res.status(400).json({ error: 'Consultation not in progress' });
      }

      const diagnosisData = {
        consultationId,
        doctorAddress: req.user.address,
        diagnosisText,
        confidenceLevel,
        followUpRecommendation,
        timestamp: new Date().toISOString(),
        metadata: {
          patientAddress: consultation.patientAddress,
          specialty: consultation.specialty,
          originalSymptoms: consultation.symptomsHash
        }
      };

      const encryptedDiagnosis = await ipfsService.uploadEncryptedData(diagnosisData);

      consultation.diagnosisHash = encryptedDiagnosis.hash;
      consultation.status = 'completed';
      consultation.completedAt = new Date().toISOString();
      consultation.confidenceLevel = confidenceLevel;

      const btcPayment = await btcService.processDoctorPayment(
        req.user.address,
        consultation.fee,
        consultation.btcEquivalent
      );

      logger.info('Diagnosis submitted:', {
        consultationId,
        doctor: req.user.address,
        confidenceLevel,
        ipfsHash: encryptedDiagnosis.hash,
        btcPayment: btcPayment.txId
      });

      res.json({
        success: true,
        consultation,
        diagnosisHash: encryptedDiagnosis.hash,
        btcPayment,
        message: 'Diagnosis submitted and payment released'
      });

    } catch (error) {
      logger.error('Error submitting diagnosis:', error);
      res.status(500).json({
        error: 'Failed to submit diagnosis',
        message: error.message
      });
    }
  }
);

router.post('/:consultationId/feedback',
  authMiddleware.requireRole('patient'),
  validateConsultationId,
  [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().trim().isLength({ max: 500 }).withMessage('Comment too long')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { consultationId } = req.params;
      const { rating, comment } = req.body;

      const consultation = await getConsultationById(consultationId);
      if (!consultation) {
        return res.status(404).json({ error: 'Consultation not found' });
      }

      if (consultation.patientAddress !== req.user.address) {
        return res.status(403).json({ error: 'Not your consultation' });
      }

      if (consultation.status !== 'completed') {
        return res.status(400).json({ error: 'Consultation not completed yet' });
      }

      const feedbackData = {
        consultationId,
        patientAddress: req.user.address,
        doctorAddress: consultation.doctorAddress,
        rating,
        comment: comment || '',
        timestamp: new Date().toISOString()
      };

      consultation.feedback = feedbackData;

      if (rating >= 4) {
        await btcService.distributeReputationReward(consultation.doctorAddress, rating);
      }

      logger.info('Feedback submitted:', {
        consultationId,
        patient: req.user.address,
        doctor: consultation.doctorAddress,
        rating
      });

      res.json({
        success: true,
        feedback: feedbackData,
        message: 'Feedback submitted successfully'
      });

    } catch (error) {
      logger.error('Error submitting feedback:', error);
      res.status(500).json({
        error: 'Failed to submit feedback'
      });
    }
  }
);

router.get('/:consultationId',
  validateConsultationId,
  async (req, res) => {
    try {
      const { consultationId } = req.params;
      
      const consultation = await getConsultationById(consultationId);
      if (!consultation) {
        return res.status(404).json({ error: 'Consultation not found' });
      }

      if (consultation.patientAddress !== req.user.address && 
          consultation.doctorAddress !== req.user.address && 
          !req.user.isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (consultation.status === 'completed' && req.user.address === consultation.patientAddress) {
        try {
          const diagnosisData = await ipfsService.decryptData(
            consultation.diagnosisHash, 
            consultation.patientAddress
          );
          consultation.diagnosis = diagnosisData;
        } catch (error) {
          logger.warn('Failed to decrypt diagnosis for patient:', error);
        }
      }

      res.json({
        success: true,
        consultation
      });

    } catch (error) {
      logger.error('Error fetching consultation:', error);
      res.status(500).json({
        error: 'Failed to fetch consultation'
      });
    }
  }
);

router.post('/:consultationId/dispute',
  validateConsultationId,
  [body('reason').trim().isLength({ min: 10, max: 500 }).withMessage('Dispute reason required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { consultationId } = req.params;
      const { reason } = req.body;

      const consultation = await getConsultationById(consultationId);
      if (!consultation) {
        return res.status(404).json({ error: 'Consultation not found' });
      }

      if (consultation.patientAddress !== req.user.address && 
          consultation.doctorAddress !== req.user.address) {
        return res.status(403).json({ error: 'Only consultation parties can dispute' });
      }

      if (consultation.status !== 'completed') {
        return res.status(400).json({ error: 'Can only dispute completed consultations' });
      }

      consultation.status = 'disputed';
      consultation.disputeInfo = {
        disputedBy: req.user.address,
        reason,
        timestamp: new Date().toISOString()
      };

      logger.info('Consultation disputed:', {
        consultationId,
        disputedBy: req.user.address,
        reason
      });

      res.json({
        success: true,
        consultation,
        message: 'Dispute submitted successfully'
      });

    } catch (error) {
      logger.error('Error disputing consultation:', error);
      res.status(500).json({
        error: 'Failed to submit dispute'
      });
    }
  }
);

router.get('/', 
  [
    query('status').optional().isIn(['pending', 'accepted', 'completed', 'disputed', 'cancelled']),
    query('specialty').optional().isIn(['dermatology', 'cardiology', 'neurology', 'oncology', 'psychiatry', 'general_practice']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  async (req, res) => {
    try {
      const { status, specialty, limit = 20, offset = 0 } = req.query;
      
      let consultations = [];
      
      if (req.user.role === 'patient') {
        consultations = await getPatientConsultations(req.user.address, status, limit, offset);
      } else if (req.user.role === 'doctor') {
        consultations = await getDoctorConsultations(req.user.address, status, limit, offset);
      } else if (req.user.isAdmin) {
        consultations = await getAllConsultations(status, specialty, limit, offset);
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        success: true,
        consultations,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: consultations.length
        }
      });

    } catch (error) {
      logger.error('Error fetching consultations:', error);
      res.status(500).json({
        error: 'Failed to fetch consultations'
      });
    }
  }
);

async function getConsultationById(consultationId) {
  const mockConsultations = {
    '1': {
      id: '1',
      patientAddress: '0x1234567890123456789012345678901234567890',
      doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      symptomsHash: 'QmX1Y2Z3...',
      specialty: 'dermatology',
      fee: '0.05',
      btcEquivalent: '0.00234',
      isUrgent: false,
      status: 'pending',
      createdAt: '2025-08-28T10:30:00Z',
      deadline: '2025-08-29T10:30:00Z'
    }
  };
  
  return mockConsultations[consultationId] || null;
}

async function getPatientConsultations(patientAddress, status, limit, offset) {
  const allConsultations = [
    {
      id: 1,
      doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      doctorName: 'Dr. Sarah Chen',
      specialty: 'dermatology',
      status: 'completed',
      fee: '0.05',
      createdAt: '2025-08-25T10:30:00Z'
    },
    {
      id: 2,
      doctorAddress: '0x123def456789abcdef123456789abcdef12345678',
      doctorName: 'Dr. Michael Rodriguez',
      specialty: 'cardiology',
      status: 'in_progress',
      fee: '0.08',
      createdAt: '2025-08-28T14:15:00Z'
    }
  ];

  let filtered = allConsultations;
  if (status) {
    filtered = allConsultations.filter(c => c.status === status);
  }

  return filtered.slice(offset, offset + limit);
}

async function getDoctorConsultations(doctorAddress, status, limit, offset) {
  const allConsultations = [
    {
      id: 1,
      patientAddress: '0x1234567890123456789012345678901234567890',
      symptoms: 'Persistent skin rash on arms',
      specialty: 'dermatology',
      status: 'pending',
      fee: '0.05',
      isUrgent: false,
      createdAt: '2025-08-28T10:30:00Z'
    }
  ];

  let filtered = allConsultations;
  if (status) {
    filtered = allConsultations.filter(c => c.status === status);
  }

  return filtered.slice(offset, offset + limit);
}

async function getAllConsultations(status, specialty, limit, offset) {
  return [];
}

module.exports = router;