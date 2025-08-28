const logger = require('../utils/logger');

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }
}

const handleValidationError = (error) => {
  const errors = error.details || error.errors || [];
  const message = errors.map(err => err.message || err.msg).join(', ');
  return new AppError(`Validation Error: ${message}`, 400, 'VALIDATION_ERROR');
};

const handleWeb3Error = (error) => {
  if (error.message.includes('revert')) {
    const revertReason = error.message.split('revert ')[1] || 'Transaction reverted';
    return new AppError(`Smart Contract Error: ${revertReason}`, 400, 'CONTRACT_REVERT');
  }
  
  if (error.message.includes('insufficient funds')) {
    return new AppError('Insufficient funds for transaction', 400, 'INSUFFICIENT_FUNDS');
  }
  
  if (error.message.includes('nonce')) {
    return new AppError('Transaction nonce error', 400, 'NONCE_ERROR');
  }

  return new AppError('Blockchain transaction failed', 500, 'WEB3_ERROR');
};

const handleDatabaseError = (error) => {
  if (error.code === 'ER_DUP_ENTRY' || error.code === 11000) {
    return new AppError('Duplicate entry found', 409, 'DUPLICATE_ENTRY');
  }
  
  if (error.code === 'ER_NO_REFERENCED_ROW') {
    return new AppError('Referenced record not found', 400, 'REFERENCE_ERROR');
  }

  return new AppError('Database operation failed', 500, 'DATABASE_ERROR');
};

const handleJWTError = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return new AppError('Invalid authentication token', 401, 'INVALID_TOKEN');
  }
  
  if (error.name === 'TokenExpiredError') {
    return new AppError('Authentication token expired', 401, 'TOKEN_EXPIRED');
  }
  
  if (error.name === 'NotBeforeError') {
    return new AppError('Authentication token not active', 401, 'TOKEN_NOT_ACTIVE');
  }

  return new AppError('Authentication failed', 401, 'AUTH_ERROR');
};

const handleIPFSError = (error) => {
  if (error.message.includes('timeout')) {
    return new AppError('IPFS operation timeout', 504, 'IPFS_TIMEOUT');
  }
  
  if (error.message.includes('gateway')) {
    return new AppError('IPFS gateway unavailable', 502, 'IPFS_GATEWAY_ERROR');
  }

  return new AppError('IPFS operation failed', 500, 'IPFS_ERROR');
};

const handleBitcoinError = (error) => {
  if (error.message.includes('insufficient balance')) {
    return new AppError('Insufficient Bitcoin balance', 400, 'INSUFFICIENT_BTC_BALANCE');
  }
  
  if (error.message.includes('invalid address')) {
    return new AppError('Invalid Bitcoin address', 400, 'INVALID_BTC_ADDRESS');
  }
  
  if (error.message.includes('network')) {
    return new AppError('Bitcoin network error', 502, 'BTC_NETWORK_ERROR');
  }

  return new AppError('Bitcoin operation failed', 500, 'BTC_ERROR');
};

const sendErrorDev = (error, req, res) => {
  const errorResponse = {
    status: 'error',
    error: {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
      stack: error.stack,
      timestamp: error.timestamp || new Date().toISOString()
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query,
      userAddress: req.user?.address
    }
  };

  res.status(error.statusCode).json(errorResponse);
};

const sendErrorProd = (error, req, res) => {
  if (error.isOperational) {
    const errorResponse = {
      status: 'error',
      message: error.message,
      code: error.code,
      timestamp: error.timestamp || new Date().toISOString()
    };

    if (error.statusCode === 401) {
      errorResponse.action = 'Please authenticate and try again';
    } else if (error.statusCode === 403) {
      errorResponse.action = 'Please check your permissions';
    } else if (error.statusCode === 404) {
      errorResponse.action = 'Please verify the resource exists';
    } else if (error.statusCode >= 500) {
      errorResponse.action = 'Please try again later or contact support';
    }

    res.status(error.statusCode).json(errorResponse);
  } else {
    logger.error('Programming Error:', {
      error: error.message,
      stack: error.stack,
      request: {
        method: req.method,
        url: req.originalUrl,
        userAddress: req.user?.address
      }
    });

    res.status(500).json({
      status: 'error',
      message: 'Something went wrong on our end',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
      action: 'Please try again later or contact support if the problem persists'
    });
  }
};

const globalErrorHandler = (error, req, res, next) => {
  error.statusCode = error.statusCode || 500;

  logger.error('Global error handler triggered:', {
    message: error.message,
    statusCode: error.statusCode,
    code: error.code,
    method: req.method,
    url: req.originalUrl,
    userAddress: req.user?.address,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  let modifiedError = error;

  if (error.name === 'ValidationError' || error.name === 'CastError') {
    modifiedError = handleValidationError(error);
  } else if (error.message.includes('Web3') || error.message.includes('contract')) {
    modifiedError = handleWeb3Error(error);
  } else if (error.code && (error.code.startsWith('ER_') || typeof error.code === 'number')) {
    modifiedError = handleDatabaseError(error);
  } else if (error.name.includes('JsonWebToken') || error.name.includes('Token')) {
    modifiedError = handleJWTError(error);
  } else if (error.message.includes('IPFS') || error.message.includes('gateway')) {
    modifiedError = handleIPFSError(error);
  } else if (error.message.includes('Bitcoin') || error.message.includes('BTC')) {
    modifiedError = handleBitcoinError(error);
  }

  if (isDevelopment) {
    sendErrorDev(modifiedError, req, res);
  } else {
    sendErrorProd(modifiedError, req, res);
  }
};

const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Cannot ${req.method} ${req.originalUrl}`,
    404,
    'ENDPOINT_NOT_FOUND'
  );
  next(error);
};

const validationErrorHandler = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    const error = new AppError(
      'Validation failed',
      400,
      'VALIDATION_ERROR'
    );
    error.details = errorMessages;
    
    return next(error);
  }
  
  next();
};

const rateLimitErrorHandler = (req, res, next) => {
  const error = new AppError(
    'Too many requests, please try again later',
    429,
    'RATE_LIMIT_EXCEEDED'
  );
  error.retryAfter = Math.ceil(req.rateLimit?.resetTime / 1000) || 60;
  
  res.set('Retry-After', error.retryAfter);
  next(error);
};

const corsErrorHandler = (req, res, next) => {
  const origin = req.get('Origin');
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  
  if (origin && !allowedOrigins.includes(origin)) {
    const error = new AppError(
      'CORS policy violation',
      403,
      'CORS_ERROR'
    );
    return next(error);
  }
  
  next();
};

const healthCheck = (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    services: {
      database: 'connected',
      ipfs: 'available',
      bitcoin: 'connected',
      redis: process.env.REDIS_URL ? 'connected' : 'not_configured'
    }
  };

  res.status(200).json(healthData);
};

const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'same-origin');
  
  if (isProduction) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'");
  }
  
  next();
};

const requestLogger = (req, res, next) => {
  const requestId = crypto.randomBytes(16).toString('hex');
  req.requestId = requestId;
  
  res.setHeader('X-Request-ID', requestId);
  
  logger.info('Incoming request:', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  next();
};

module.exports = {
  AppError,
  globalErrorHandler,
  asyncHandler,
  notFoundHandler,
  validationErrorHandler,
  rateLimitErrorHandler,
  corsErrorHandler,
  healthCheck,
  securityHeaders,
  requestLogger,
  handleValidationError,
  handleWeb3Error,
  handleDatabaseError,
  handleJWTError,
  handleIPFSError,
  handleBitcoinError
};