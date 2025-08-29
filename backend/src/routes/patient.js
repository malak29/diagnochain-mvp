const express = require('express');
const { body, query, param } = require('express-validator');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validation = require('../middleware/validation');
const patientController = require('../controllers/patientController');
const upload = require('../middleware/upload');

const router = express.Router();

router.get('/', [
  auth,
  authorize(['doctor', 'admin']),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('search').optional().isLength({ max: 100 }).withMessage('Search term too long'),
  query('status').optional().isIn(['active', 'inactive', 'suspended']),
  validation
], patientController.getAllPatients);

router.get('/my-profile', [
  auth,
  authorize(['patient'])
], patientController.getPatientProfile);

router.get('/:patientId', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  validation
], patientController.getPatientById);

router.post('/', [
  auth,
  authorize(['doctor', 'admin']),
  body('walletAddress')
    .isEthereumAddress()
    .withMessage('Invalid wallet address'),
  body('personalInfo.firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2-50 characters'),
  body('personalInfo.lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2-50 characters'),
  body('personalInfo.dateOfBirth')
    .isISO8601()
    .withMessage('Invalid date of birth'),
  body('personalInfo.gender')
    .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
    .withMessage('Invalid gender'),
  body('personalInfo.email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email'),
  body('personalInfo.phone')
    .optional()
    .isMobilePhone()
    .withMessage('Invalid phone number'),
  body('medicalInfo.bloodType')
    .optional()
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .withMessage('Invalid blood type'),
  body('medicalInfo.allergies')
    .optional()
    .isArray()
    .withMessage('Allergies must be an array'),
  body('medicalInfo.chronicConditions')
    .optional()
    .isArray()
    .withMessage('Chronic conditions must be an array'),
  body('emergencyContact.name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Emergency contact name required'),
  body('emergencyContact.phone')
    .isMobilePhone()
    .withMessage('Valid emergency contact phone required'),
  body('emergencyContact.relationship')
    .isIn(['spouse', 'parent', 'child', 'sibling', 'friend', 'other'])
    .withMessage('Invalid relationship'),
  validation
], patientController.createPatient);

router.put('/:patientId', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  body('personalInfo.firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 }),
  body('personalInfo.lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 }),
  body('personalInfo.phone')
    .optional()
    .isMobilePhone(),
  body('medicalInfo.bloodType')
    .optional()
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  body('medicalInfo.allergies')
    .optional()
    .isArray(),
  body('medicalInfo.chronicConditions')
    .optional()
    .isArray(),
  body('emergencyContact.name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }),
  body('emergencyContact.phone')
    .optional()
    .isMobilePhone(),
  body('emergencyContact.relationship')
    .optional()
    .isIn(['spouse', 'parent', 'child', 'sibling', 'friend', 'other']),
  validation
], patientController.updatePatient);

router.delete('/:patientId', [
  auth,
  authorize(['admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  validation
], patientController.deletePatient);

router.get('/:patientId/medical-records', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('recordType').optional().isIn(['diagnosis', 'prescription', 'lab_result', 'imaging']),
  validation
], patientController.getMedicalRecords);

router.post('/:patientId/medical-records', [
  auth,
  authorize(['doctor', 'admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  body('recordType')
    .isIn(['diagnosis', 'prescription', 'lab_result', 'imaging'])
    .withMessage('Invalid record type'),
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3-200 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Description must be between 10-2000 characters'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
  validation
], patientController.addMedicalRecord);

router.put('/:patientId/medical-records/:recordId', [
  auth,
  authorize(['doctor', 'admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  param('recordId').isMongoId().withMessage('Invalid record ID'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 }),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 2000 }),
  body('metadata')
    .optional()
    .isObject(),
  validation
], patientController.updateMedicalRecord);

router.delete('/:patientId/medical-records/:recordId', [
  auth,
  authorize(['doctor', 'admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  param('recordId').isMongoId().withMessage('Invalid record ID'),
  validation
], patientController.deleteMedicalRecord);

router.post('/:patientId/upload-document', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  upload.single('document'),
  body('documentType')
    .isIn(['lab_report', 'prescription', 'insurance_card', 'id_document', 'medical_image'])
    .withMessage('Invalid document type'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }),
  validation
], patientController.uploadDocument);

router.get('/:patientId/documents', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  query('documentType').optional().isIn(['lab_report', 'prescription', 'insurance_card', 'id_document', 'medical_image']),
  validation
], patientController.getDocuments);

router.delete('/:patientId/documents/:documentId', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  param('documentId').isMongoId().withMessage('Invalid document ID'),
  validation
], patientController.deleteDocument);

router.get('/:patientId/blockchain-records', [
  auth,
  authorize(['doctor', 'admin', 'patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  query('startBlock').optional().isInt({ min: 0 }),
  query('endBlock').optional().isInt({ min: 0 }),
  validation
], patientController.getBlockchainRecords);

router.post('/:patientId/grant-access', [
  auth,
  authorize(['patient']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  body('doctorWallet')
    .isEthereumAddress()
    .withMessage('Invalid doctor wallet address'),
  body('permissions')
    .isArray()
    .withMessage('Permissions must be an array'),
  body('permissions.*')
    .isIn(['read', 'write', 'delete'])
    .withMessage('Invalid permission type'),
  body('expirationDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid expiration date'),
  validation
], patientController.grantAccess);

router.post('/:patientId/revoke-access', [
  auth,
  authorize(['patient', 'admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  body('doctorWallet')
    .isEthereumAddress()
    .withMessage('Invalid doctor wallet address'),
  validation
], patientController.revokeAccess);

router.get('/:patientId/access-logs', [
  auth,
  authorize(['patient', 'admin']),
  param('patientId').isMongoId().withMessage('Invalid patient ID'),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('action').optional().isIn(['read', 'write', 'delete', 'grant', 'revoke']),
  validation
], patientController.getAccessLogs);

module.exports = router;