const cors = require('cors');
const logger = require('../utils/logger');

class CorsMiddleware {
  constructor() {
    this.allowedOrigins = this.buildAllowedOrigins();
    this.corsOptions = this.buildCorsOptions();
  }

  buildAllowedOrigins() {
    const origins = [];
    
    if (process.env.FRONTEND_URL) {
      origins.push(process.env.FRONTEND_URL);
    }

    if (process.env.ALLOWED_ORIGINS) {
      const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
      origins.push(...additionalOrigins);
    }

    if (process.env.NODE_ENV === 'development') {
      origins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:8080'
      );
    }

    if (process.env.NODE_ENV === 'test') {
      origins.push(
        'http://localhost:3000',
        'http://localhost:3001'
      );
    }

    const uniqueOrigins = [...new Set(origins)];
    
    logger.info('CORS allowed origins configured', {
      count: uniqueOrigins.length,
      origins: uniqueOrigins,
      environment: process.env.NODE_ENV
    });

    return uniqueOrigins;
  }

  buildCorsOptions() {
    return {
      origin: this.originHandler.bind(this),
      methods: this.getAllowedMethods(),
      allowedHeaders: this.getAllowedHeaders(),
      exposedHeaders: this.getExposedHeaders(),
      credentials: process.env.CORS_CREDENTIALS !== 'false',
      maxAge: parseInt(process.env.CORS_MAX_AGE || '86400'),
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }

  getAllowedMethods() {
    const defaultMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    
    if (process.env.CORS_ALLOWED_METHODS) {
      return process.env.CORS_ALLOWED_METHODS.split(',').map(method => method.trim().toUpperCase());
    }

    return defaultMethods;
  }

  getAllowedHeaders() {
    const defaultHeaders = [
      'Accept',
      'Accept-Language',
      'Content-Language',
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'X-Forwarded-For',
      'X-Real-IP',
      'X-Session-ID',
      'X-API-Key',
      'X-Client-Version',
      'Cache-Control',
      'Pragma',
      'Expires',
      'Last-Modified',
      'ETag',
      'If-Match',
      'If-None-Match',
      'If-Modified-Since',
      'If-Unmodified-Since'
    ];

    if (process.env.CORS_ALLOWED_HEADERS) {
      const customHeaders = process.env.CORS_ALLOWED_HEADERS.split(',').map(header => header.trim());
      return [...new Set([...defaultHeaders, ...customHeaders])];
    }

    return defaultHeaders;
  }

  getExposedHeaders() {
    const defaultExposedHeaders = [
      'Content-Length',
      'Content-Range',
      'Content-Type',
      'Date',
      'ETag',
      'Expires',
      'Last-Modified',
      'Server',
      'Transfer-Encoding',
      'X-Total-Count',
      'X-Page-Count',
      'X-Rate-Limit-Limit',
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset',
      'X-Request-ID'
    ];

    if (process.env.CORS_EXPOSED_HEADERS) {
      const customHeaders = process.env.CORS_EXPOSED_HEADERS.split(',').map(header => header.trim());
      return [...new Set([...defaultExposedHeaders, ...customHeaders])];
    }

    return defaultExposedHeaders;
  }

  originHandler(origin, callback) {
    if (!origin) {
      if (process.env.ALLOW_NULL_ORIGIN === 'true') {
        logger.debug('Allowing request with null origin');
        return callback(null, true);
      } else {
        logger.warn('Rejecting request with null origin');
        return callback(new Error('Origin not allowed by CORS policy'), false);
      }
    }

    if (this.isOriginAllowed(origin)) {
      logger.debug('Origin allowed', { origin });
      callback(null, true);
    } else {
      logger.warn('Origin not allowed', { origin });
      callback(new Error(`Origin ${origin} not allowed by CORS policy`), false);
    }
  }

  isOriginAllowed(origin) {
    if (process.env.NODE_ENV === 'development' && process.env.CORS_ALLOW_ALL_DEV === 'true') {
      return true;
    }

    if (this.allowedOrigins.includes('*')) {
      return true;
    }

    if (this.allowedOrigins.includes(origin)) {
      return true;
    }

    for (const allowedOrigin of this.allowedOrigins) {
      if (this.matchesWildcardPattern(origin, allowedOrigin)) {
        return true;
      }
    }

    return false;
  }

  matchesWildcardPattern(origin, pattern) {
    if (!pattern.includes('*')) {
      return origin === pattern;
    }

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(origin);
  }

  createCorsMiddleware() {
    const corsMiddleware = cors(this.corsOptions);
    
    return (req, res, next) => {
      req.startTime = Date.now();
      
      const originalEnd = res.end;
      res.end = function(...args) {
        const duration = Date.now() - req.startTime;
        
        logger.debug('CORS request completed', {
          method: req.method,
          origin: req.get('Origin') || 'none',
          userAgent: req.get('User-Agent'),
          duration: `${duration}ms`,
          statusCode: res.statusCode
        });
        
        originalEnd.apply(this, args);
      };

      corsMiddleware(req, res, next);
    };
  }

  createStrictCorsMiddleware() {
    const strictOptions = {
      ...this.corsOptions,
      origin: (origin, callback) => {
        if (!origin) {
          logger.warn('Strict CORS: Rejecting request with null origin');
          return callback(new Error('Origin required'), false);
        }

        if (this.allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn('Strict CORS: Origin not allowed', { origin });
          callback(new Error(`Origin ${origin} not allowed`), false);
        }
      },
      credentials: true
    };

    return cors(strictOptions);
  }

  createSecurityHeaders() {
    return (req, res, next) => {
      const origin = req.get('Origin');
      
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': process.env.X_FRAME_OPTIONS || 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': process.env.REFERRER_POLICY || 'strict-origin-when-cross-origin',
        'Permissions-Policy': this.buildPermissionsPolicy(),
        'Strict-Transport-Security': process.env.NODE_ENV === 'production' 
          ? 'max-age=31536000; includeSubDomains; preload'
          : undefined
      });

      if (origin && this.isOriginAllowed(origin)) {
        const cspNonce = this.generateNonce();
        req.cspNonce = cspNonce;
        
        res.set({
          'Content-Security-Policy': this.buildContentSecurityPolicy(origin, cspNonce),
          'Cross-Origin-Embedder-Policy': process.env.COEP || 'require-corp',
          'Cross-Origin-Opener-Policy': process.env.COOP || 'same-origin',
          'Cross-Origin-Resource-Policy': process.env.CORP || 'same-site'
        });
      }

      if (process.env.NODE_ENV === 'production') {
        res.set({
          'Expect-CT': `max-age=86400, enforce, report-uri="${process.env.CT_REPORT_URI || ''}"`,
          'Report-To': JSON.stringify({
            group: 'default',
            max_age: 31536000,
            endpoints: [{ url: process.env.REPORT_URI || '' }]
          })
        });
      }

      next();
    };
  }

  buildContentSecurityPolicy(origin, nonce) {
    const basePolicy = {
      'default-src': ["'self'"],
      'script-src': [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(process.env.CSP_SCRIPT_SRC ? process.env.CSP_SCRIPT_SRC.split(' ') : [])
      ],
      'style-src': [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        ...(process.env.CSP_STYLE_SRC ? process.env.CSP_STYLE_SRC.split(' ') : [])
      ],
      'font-src': [
        "'self'",
        'https://fonts.gstatic.com',
        'data:',
        ...(process.env.CSP_FONT_SRC ? process.env.CSP_FONT_SRC.split(' ') : [])
      ],
      'img-src': [
        "'self'",
        'data:',
        'https:',
        ...(process.env.CSP_IMG_SRC ? process.env.CSP_IMG_SRC.split(' ') : [])
      ],
      'media-src': [
        "'self'",
        ...(process.env.CSP_MEDIA_SRC ? process.env.CSP_MEDIA_SRC.split(' ') : [])
      ],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'connect-src': [
        "'self'",
        origin,
        'wss:',
        'https://api.etherscan.io',
        'https://mainnet.infura.io',
        'https://goerli.infura.io',
        ...(process.env.CSP_CONNECT_SRC ? process.env.CSP_CONNECT_SRC.split(' ') : [])
      ],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'frame-src': ["'none'"],
      'manifest-src': ["'self'"],
      'worker-src': ["'self'"],
      'upgrade-insecure-requests': []
    };

    if (process.env.CSP_REPORT_URI) {
      basePolicy['report-uri'] = [process.env.CSP_REPORT_URI];
    }

    if (process.env.NODE_ENV === 'development') {
      basePolicy['script-src'].push("'unsafe-eval'");
      basePolicy['connect-src'].push('ws://localhost:*', 'http://localhost:*');
    }

    const policyString = Object.entries(basePolicy)
      .map(([directive, values]) => 
        values.length > 0 ? `${directive} ${values.join(' ')}` : directive
      )
      .join('; ');

    return policyString;
  }

  buildPermissionsPolicy() {
    const policies = {
      'accelerometer': '()',
      'ambient-light-sensor': '()',
      'autoplay': '(self)',
      'battery': '()',
      'camera': '(self)',
      'cross-origin-isolated': '()',
      'display-capture': '()',
      'document-domain': '()',
      'encrypted-media': '()',
      'execution-while-not-rendered': '()',
      'execution-while-out-of-viewport': '()',
      'fullscreen': '(self)',
      'geolocation': '()',
      'gyroscope': '()',
      'magnetometer': '()',
      'microphone': '(self)',
      'midi': '()',
      'navigation-override': '()',
      'payment': '(self)',
      'picture-in-picture': '()',
      'publickey-credentials-get': '(self)',
      'screen-wake-lock': '()',
      'sync-xhr': '()',
      'usb': '()',
      'web-share': '(self)',
      'xr-spatial-tracking': '()'
    };

    if (process.env.PERMISSIONS_POLICY) {
      const customPolicies = process.env.PERMISSIONS_POLICY.split(',');
      customPolicies.forEach(policy => {
        const [directive, value] = policy.split('=');
        if (directive && value) {
          policies[directive.trim()] = value.trim();
        }
      });
    }

    return Object.entries(policies)
      .map(([directive, value]) => `${directive}=${value}`)
      .join(', ');
  }

  generateNonce() {
    return require('crypto').randomBytes(16).toString('base64');
  }

  createPreflightHandler() {
    return (req, res, next) => {
      if (req.method === 'OPTIONS') {
        const origin = req.get('Origin');
        const requestMethod = req.get('Access-Control-Request-Method');
        const requestHeaders = req.get('Access-Control-Request-Headers');

        logger.debug('Handling preflight request', {
          origin,
          method: requestMethod,
          headers: requestHeaders
        });

        if (!origin || !this.isOriginAllowed(origin)) {
          logger.warn('Preflight request rejected - invalid origin', { origin });
          return res.status(403).json({ error: 'Origin not allowed' });
        }

        if (requestMethod && !this.getAllowedMethods().includes(requestMethod.toUpperCase())) {
          logger.warn('Preflight request rejected - invalid method', { 
            method: requestMethod 
          });
          return res.status(405).json({ error: 'Method not allowed' });
        }

        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Methods', this.getAllowedMethods().join(', '));
        res.set('Access-Control-Allow-Headers', this.getAllowedHeaders().join(', '));
        res.set('Access-Control-Max-Age', this.corsOptions.maxAge.toString());
        
        if (this.corsOptions.credentials) {
          res.set('Access-Control-Allow-Credentials', 'true');
        }

        return res.status(204).end();
      }

      next();
    };
  }

  createRateLimitByOrigin() {
    const originRequests = new Map();
    const windowMs = 15 * 60 * 1000;
    const maxRequests = 1000;

    setInterval(() => {
      originRequests.clear();
    }, windowMs);

    return (req, res, next) => {
      const origin = req.get('Origin') || req.ip;
      const now = Date.now();
      
      if (!originRequests.has(origin)) {
        originRequests.set(origin, []);
      }

      const requests = originRequests.get(origin);
      const windowStart = now - windowMs;
      
      const recentRequests = requests.filter(timestamp => timestamp > windowStart);
      recentRequests.push(now);
      
      originRequests.set(origin, recentRequests);

      if (recentRequests.length > maxRequests) {
        logger.warn('Rate limit exceeded for origin', {
          origin,
          requestCount: recentRequests.length,
          maxRequests,
          windowMs
        });

        res.set({
          'X-RateLimit-Limit': maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil((now + windowMs) / 1000).toString(),
          'Retry-After': Math.ceil(windowMs / 1000).toString()
        });

        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded for this origin'
        });
      }

      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': (maxRequests - recentRequests.length).toString(),
        'X-RateLimit-Reset': Math.ceil((now + windowMs) / 1000).toString()
      });

      next();
    };
  }

  createErrorHandler() {
    return (err, req, res, next) => {
      if (err.message && err.message.includes('CORS')) {
        logger.error('CORS error occurred', {
          error: err.message,
          origin: req.get('Origin'),
          method: req.method,
          url: req.originalUrl,
          userAgent: req.get('User-Agent'),
          referer: req.get('Referer')
        });

        return res.status(403).json({
          error: 'CORS Error',
          message: 'Cross-Origin Request Blocked',
          details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
      }

      next(err);
    };
  }

  logCorsActivity() {
    return (req, res, next) => {
      const origin = req.get('Origin');
      
      if (origin) {
        const logData = {
          method: req.method,
          url: req.originalUrl,
          origin: origin,
          userAgent: req.get('User-Agent'),
          referer: req.get('Referer'),
          timestamp: new Date().toISOString(),
          ip: req.ip
        };

        if (req.method === 'OPTIONS') {
          logger.debug('CORS preflight request', logData);
        } else {
          logger.debug('CORS actual request', logData);
        }
      }

      next();
    };
  }

  getHealthCheck() {
    return {
      cors: {
        status: 'active',
        allowedOrigins: this.allowedOrigins.length,
        allowedMethods: this.getAllowedMethods(),
        credentials: this.corsOptions.credentials,
        maxAge: this.corsOptions.maxAge
      }
    };
  }
}

const corsMiddleware = new CorsMiddleware();

module.exports = {
  cors: corsMiddleware.createCorsMiddleware(),
  strictCors: corsMiddleware.createStrictCorsMiddleware(),
  securityHeaders: corsMiddleware.createSecurityHeaders(),
  preflightHandler: corsMiddleware.createPreflightHandler(),
  rateLimitByOrigin: corsMiddleware.createRateLimitByOrigin(),
  errorHandler: corsMiddleware.createErrorHandler(),
  logActivity: corsMiddleware.logCorsActivity(),
  healthCheck: corsMiddleware.getHealthCheck(),
  corsMiddleware
};