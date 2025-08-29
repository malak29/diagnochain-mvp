const { validationResult, body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      errors: errors.array(),
      userId: req.user?.id,
      ip: req.ip
    });

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  
  next();
};

const validateObjectId = (field = 'id') => {
  return param(field)
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`Invalid ${field} format`);
      }
      return true;
    });
};

const validateWalletAddress = (field) => {
  return body(field)
    .custom((value) => {
      const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!ethAddressRegex.test(value)) {
        throw new Error('Invalid Ethereum wallet address format');
      }
      return true;
    });
};

const validateIpfsHash = (field) => {
  return body(field)
    .custom((value) => {
      const ipfsHashRegex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
      if (!ipfsHashRegex.test(value)) {
        throw new Error('Invalid IPFS hash format');
      }
      return true;
    });
};

const validateMedicalRecordType = () => {
  return body('recordType')
    .isIn([
      'diagnosis',
      'prescription', 
      'lab_result',
      'imaging',
      'surgery',
      'consultation',
      'treatment_plan',
      'progress_note'
    ])
    .withMessage('Invalid medical record type');
};

const validateUserPermissions = () => {
  return body('permissions')
    .isArray({ min: 1 })
    .withMessage('Permissions must be a non-empty array')
    .custom((permissions) => {
      const validPermissions = ['read', 'write', 'delete', 'share'];
      const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));
      
      if (invalidPermissions.length > 0) {
        throw new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`);
      }
      
      return true;
    });
};

const validateDateRange = (startField = 'startDate', endField = 'endDate') => {
  return [
    query(startField)
      .optional()
      .isISO8601()
      .withMessage(`${startField} must be valid ISO 8601 date`),
    query(endField)
      .optional()
      .isISO8601()
      .withMessage(`${endField} must be valid ISO 8601 date`)
      .custom((endDate, { req }) => {
        const startDate = req.query[startField];
        if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      })
  ];
};

const validatePagination = () => {
  return [
    query('page')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Page must be between 1 and 1000'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('sortBy')
      .optional()
      .isIn(['createdAt', 'updatedAt', 'name', 'email', 'lastActive'])
      .withMessage('Invalid sort field'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Sort order must be asc or desc')
  ];
};

const validateSearchQuery = () => {
  return [
    query('search')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Search query must be between 2-100 characters')
      .matches(/^[a-zA-Z0-9\s\-\.@]+$/)
      .withMessage('Search query contains invalid characters'),
    query('searchFields')
      .optional()
      .isArray()
      .withMessage('Search fields must be an array')
      .custom((fields) => {
        const validFields = ['firstName', 'lastName', 'email', 'phone', 'walletAddress'];
        const invalidFields = fields.filter(f => !validFields.includes(f));
        
        if (invalidFields.length > 0) {
          throw new Error(`Invalid search fields: ${invalidFields.join(', ')}`);
        }
        
        return true;
      })
  ];
};

const validateFileUpload = () => {
  return [
    body('documentType')
      .isIn([
        'lab_report',
        'prescription', 
        'insurance_card',
        'id_document',
        'medical_image',
        'treatment_plan',
        'consent_form'
      ])
      .withMessage('Invalid document type'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('isPublic')
      .optional()
      .isBoolean()
      .withMessage('isPublic must be a boolean'),
    body('expirationDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid expiration date format')
      .custom((date) => {
        if (new Date(date) <= new Date()) {
          throw new Error('Expiration date must be in the future');
        }
        return true;
      })
  ];
};

const validateBlockchainTransaction = () => {
  return [
    body('transactionHash')
      .matches(/^0x[a-fA-F0-9]{64}$/)
      .withMessage('Invalid transaction hash format'),
    body('blockNumber')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Block number must be non-negative integer'),
    body('gasUsed')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Gas used must be non-negative integer'),
    body('gasPrice')
      .optional()
      .isDecimal({ decimal_digits: '0,18' })
      .withMessage('Invalid gas price format')
  ];
};

const validateAccessPermission = () => {
  return [
    body('resourceType')
      .isIn(['medical_record', 'document', 'full_profile'])
      .withMessage('Invalid resource type'),
    body('accessLevel')
      .isIn(['read', 'write', 'admin'])
      .withMessage('Invalid access level'),
    body('expirationDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid expiration date')
      .custom((date) => {
        const expiration = new Date(date);
        const now = new Date();
        const maxExpiration = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        
        if (expiration <= now) {
          throw new Error('Expiration date must be in the future');
        }
        
        if (expiration > maxExpiration) {
          throw new Error('Expiration date cannot be more than 1 year from now');
        }
        
        return true;
      }),
    body('conditions')
      .optional()
      .isObject()
      .withMessage('Conditions must be an object'),
    body('purpose')
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Purpose must be between 10-500 characters')
  ];
};

const validateBitcoinTransaction = () => {
  return [
    body('amount')
      .isDecimal({ decimal_digits: '0,8' })
      .withMessage('Invalid Bitcoin amount format')
      .custom((amount) => {
        const btcAmount = parseFloat(amount);
        if (btcAmount <= 0 || btcAmount > 21000000) {
          throw new Error('Bitcoin amount must be between 0 and 21,000,000 BTC');
        }
        return true;
      }),
    body('recipientAddress')
      .matches(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/)
      .withMessage('Invalid Bitcoin address format'),
    body('memo')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Memo must not exceed 255 characters')
  ];
};

const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].trim();
        
        obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        obj[key] = obj[key].replace(/javascript:/gi, '');
        obj[key] = obj[key].replace(/on\w+\s*=/gi, '');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };

  if (req.body && typeof req.body === 'object') {
    sanitize(req.body);
  }
  
  if (req.query && typeof req.query === 'object') {
    sanitize(req.query);
  }

  next();
};

const validateApiKey = () => {
  return query('apiKey')
    .optional()
    .matches(/^dk_[a-zA-Z0-9]{32}$/)
    .withMessage('Invalid API key format');
};

const validateWebhookSignature = () => {
  return [
    body('timestamp')
      .isInt({ min: 0 })
      .withMessage('Invalid timestamp')
      .custom((timestamp) => {
        const now = Date.now();
        const requestTime = parseInt(timestamp) * 1000;
        const timeDiff = Math.abs(now - requestTime);
        
        if (timeDiff > 300000) {
          throw new Error('Request timestamp too old');
        }
        
        return true;
      }),
    body('signature')
      .matches(/^[a-fA-F0-9]{64}$/)
      .withMessage('Invalid signature format')
  ];
};

module.exports = {
  handleValidationErrors,
  validateObjectId,
  validateWalletAddress,
  validateIpfsHash,
  validateMedicalRecordType,
  validateUserPermissions,
  validateDateRange,
  validatePagination,
  validateSearchQuery,
  validateFileUpload,
  validateBlockchainTransaction,
  validateAccessPermission,
  validateBitcoinTransaction,
  sanitizeInput,
  validateApiKey,
  validateWebhookSignature
};