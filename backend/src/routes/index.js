const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { sanitizeInput } = require('../middleware/validation');
const logger = require('../utils/logger');

const authRoutes = require('./auth');
const patientRoutes = require('./patients');

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'API rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Strict rate limit exceeded for sensitive operations'
  },
  standardHeaders: true,
  legacyHeaders: false
});

router.use(sanitizeInput);

router.use((req, res, next) => {
  req.apiStartTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - req.apiStartTime;
    
    logger.info('API request completed', {
      method: req.method,
      endpoint: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id
    });
  });
  
  next();
});

router.get('/', (req, res) => {
  res.json({
    message: 'DiagnoChain API v1.0',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      patients: '/api/patients',
      medicalRecords: '/api/medical-records',
      appointments: '/api/appointments',
      documents: '/api/documents',
      blockchain: '/api/blockchain',
      payments: '/api/payments',
      health: '/health',
      metrics: '/metrics'
    },
    documentation: 'https://docs.diagnochain.com/api',
    support: 'https://support.diagnochain.com'
  });
});

router.use('/auth', authRoutes);

router.use('/patients', auth, patientRoutes);

router.use('/medical-records', auth, (req, res, next) => {
  logger.debug('Medical records route accessed', {
    userId: req.user?.id,
    userType: req.user?.userType,
    method: req.method,
    endpoint: req.originalUrl
  });
  next();
}, require('./medicalRecords'));

router.use('/appointments', auth, require('./appointments'));

router.use('/documents', auth, apiLimiter, require('./documents'));

router.use('/access-grants', auth, strictLimiter, require('./accessGrants'));

router.use('/access-logs', auth, require('./accessLogs'));

router.use('/health-metrics', auth, require('./healthMetrics'));

router.use('/blockchain', auth, require('./blockchain'));

router.use('/payments', auth, strictLimiter, require('./payments'));

router.use('/notifications', auth, require('./notifications'));

router.use('/settings', auth, require('./settings'));

router.use('/reports', auth, apiLimiter, require('./reports'));

router.use('/admin', auth, require('./admin'));

router.use('/doctors', require('./doctors'));

router.use('/analytics', auth, require('./analytics'));

router.use('/export', auth, strictLimiter, require('./export'));

router.use('/webhooks', require('./webhooks'));

router.get('/status', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'ok',
    uptime: Math.floor(uptime),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform
  });
});

router.get('/version', (req, res) => {
  res.json({
    version: process.env.npm_package_version || '1.0.0',
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
    commitHash: process.env.COMMIT_HASH || 'unknown',
    branch: process.env.GIT_BRANCH || 'main',
    environment: process.env.NODE_ENV || 'development'
  });
});

router.use('/debug', (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      error: 'Debug endpoints only available in development'
    });
  }
  next();
}, require('./debug'));

router.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
});

router.use((err, req, res, next) => {
  const errorId = require('crypto').randomUUID();
  
  logger.error('Route error', {
    errorId,
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    query: req.query,
    params: req.params,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  const statusCode = err.status || err.statusCode || 500;
  
  res.status(statusCode).json({
    success: false,
    error: err.name || 'Error',
    message: err.message || 'An error occurred',
    errorId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: {
        method: req.method,
        url: req.originalUrl,
        body: req.body,
        query: req.query,
        params: req.params
      }
    })
  });
});

module.exports = router;