const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const morgan = require('morgan');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const databaseConfig = require('./config/database');
const redisClient = require('./config/redis');
const logger = require('./utils/logger');
const { cors, securityHeaders, errorHandler } = require('./middleware/cors');
const routes = require('./routes');
const blockchainService = require('./services/blockchainService');

class DiagnoChainApp {
  constructor() {
    this.app = express();
    this.server = null;
    this.isShuttingDown = false;
    this.activeConnections = new Set();
  }

  async initialize() {
    try {
      await this.connectDatabase();
      await this.connectRedis();
      await this.initializeBlockchain();
      
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandling();
      this.setupGracefulShutdown();

      logger.info('DiagnoChain application initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize application', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async connectDatabase() {
    try {
      await databaseConfig.connect();
      logger.info('Database connection established');
    } catch (error) {
      logger.error('Database connection failed', {
        error: error.message
      });
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  async connectRedis() {
    try {
      await redisClient.connect();
      logger.info('Redis connection established');
    } catch (error) {
      logger.error('Redis connection failed', {
        error: error.message
      });
      throw new Error(`Redis connection failed: ${error.message}`);
    }
  }

  async initializeBlockchain() {
    try {
      await blockchainService.initialize();
      logger.info('Blockchain service initialized');
    } catch (error) {
      logger.warn('Blockchain service initialization failed', {
        error: error.message
      });
    }
  }

  setupMiddleware() {
    this.app.set('trust proxy', 1);

    if (process.env.NODE_ENV === 'production') {
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'"],
            connectSrc: [
              "'self'",
              "https://api.etherscan.io",
              "https://mainnet.infura.io",
              "https://goerli.infura.io",
              "wss://mainnet.infura.io",
              "wss://goerli.infura.io"
            ],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
          },
        },
        crossOriginEmbedderPolicy: false,
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      }));
    }

    this.app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024,
      level: 6
    }));

    if (process.env.NODE_ENV !== 'test') {
      const morganFormat = process.env.NODE_ENV === 'production' 
        ? 'combined' 
        : 'dev';
        
      this.app.use(morgan(morganFormat, {
        stream: {
          write: (message) => {
            logger.info(message.trim(), { source: 'http' });
          }
        },
        skip: (req) => {
          return req.originalUrl === '/health' || 
                 req.originalUrl === '/metrics' ||
                 req.originalUrl.startsWith('/static/');
        }
      }));
    }

    this.app.use(express.json({ 
      limit: '50mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '50mb' 
    }));

    this.app.use(mongoSanitize({
      allowDots: true,
      replaceWith: '_'
    }));

    this.app.use(xss());

    this.app.use(hpp({
      whitelist: ['tags', 'categories', 'permissions']
    }));

    this.app.use(cors);
    this.app.use(securityHeaders);

    const generalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === 'production' ? 1000 : 10000,
      message: {
        error: 'Too many requests from this IP, please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl
        });
        
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded, please try again later',
          retryAfter: Math.round(15 * 60)
        });
      }
    });

    this.app.use('/api/', generalLimiter);

    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: {
        error: 'Too many authentication attempts, please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false
    });

    this.app.use('/api/auth/login', authLimiter);
    this.app.use('/api/auth/register', authLimiter);
    this.app.use('/api/auth/wallet-login', authLimiter);

    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      req.id = require('crypto').randomUUID();
      
      res.on('finish', () => {
        const duration = Date.now() - req.startTime;
        
        if (duration > 1000) {
          logger.warn('Slow request detected', {
            method: req.method,
            url: req.originalUrl,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
        }
      });
      
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', async (req, res) => {
      try {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: process.env.NODE_ENV,
          version: process.env.npm_package_version || '1.0.0',
          services: {
            database: databaseConfig.isConnected ? 'connected' : 'disconnected',
            redis: redisClient.status === 'ready' ? 'connected' : 'disconnected',
            blockchain: 'checking...'
          },
          system: {
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            platform: process.platform,
            nodeVersion: process.version
          }
        };

        const blockchainHealth = await blockchainService.healthCheck();
        health.services.blockchain = blockchainHealth.status;

        const overallStatus = Object.values(health.services).every(status => 
          status === 'connected' || status === 'healthy'
        ) ? 'healthy' : 'degraded';

        health.status = overallStatus;

        res.status(overallStatus === 'healthy' ? 200 : 503).json(health);
      } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    });

    this.app.get('/metrics', async (req, res) => {
      try {
        const dbStats = await databaseConfig.getStats();
        const networkStats = await blockchainService.getNetworkStats();
        
        const metrics = {
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          activeConnections: this.activeConnections.size,
          database: dbStats,
          blockchain: networkStats,
          environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          }
        };

        res.json(metrics);
      } catch (error) {
        logger.error('Metrics collection failed', { error: error.message });
        res.status(500).json({
          error: 'Failed to collect metrics',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.use('/api', routes);

    if (process.env.NODE_ENV === 'production') {
      const frontendPath = path.join(__dirname, '../../frontend/build');
      
      this.app.use(express.static(frontendPath, {
        maxAge: '1d',
        etag: true,
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        }
      }));

      this.app.get('*', (req, res) => {
        res.sendFile(path.join(frontendPath, 'index.html'));
      });
    }

    if (process.env.NODE_ENV === 'development') {
      this.app.use('/frontend', createProxyMiddleware({
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        logLevel: 'silent'
      }));
    }

    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);

    this.app.use((err, req, res, next) => {
      const errorId = require('crypto').randomUUID();
      
      logger.error('Unhandled application error', {
        errorId,
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id
      });

      if (res.headersSent) {
        return next(err);
      }

      const statusCode = err.statusCode || err.status || 500;
      const message = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;

      res.status(statusCode).json({
        error: 'Internal Server Error',
        message,
        errorId,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
      
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', {
        reason: reason?.message || reason,
        promise: promise.toString()
      });
      
      this.gracefulShutdown('UNHANDLED_REJECTION');
    });
  }

  setupGracefulShutdown() {
    const shutdownSignals = ['SIGTERM', 'SIGINT'];
    
    shutdownSignals.forEach((signal) => {
      process.on(signal, () => {
        logger.info(`Received ${signal}, starting graceful shutdown`);
        this.gracefulShutdown(signal);
      });
    });
  }

  trackConnection(socket) {
    this.activeConnections.add(socket);
    
    socket.on('close', () => {
      this.activeConnections.delete(socket);
    });
  }

  async start(port = process.env.PORT || 3001) {
    try {
      await this.initialize();

      this.server = this.app.listen(port, '0.0.0.0', () => {
        logger.info(`DiagnoChain server started`, {
          port: port,
          environment: process.env.NODE_ENV,
          pid: process.pid,
          nodeVersion: process.version
        });
      });

      this.server.on('connection', (socket) => {
        this.trackConnection(socket);
      });

      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;

      return this.server;
    } catch (error) {
      logger.error('Failed to start server', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Graceful shutdown initiated by ${signal}`);

    const shutdownTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000);

    try {
      if (this.server) {
        logger.info('Closing HTTP server');
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
      }

      logger.info('Closing active connections');
      for (const socket of this.activeConnections) {
        socket.destroy();
      }

      logger.info('Closing database connection');
      await databaseConfig.disconnect();

      logger.info('Closing Redis connection');
      await redisClient.quit();

      logger.info('Cleaning up blockchain service');
      await blockchainService.cleanup();

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown', {
        error: error.message
      });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  getApp() {
    return this.app;
  }

  getServer() {
    return this.server;
  }

  isHealthy() {
    return !this.isShuttingDown && 
           databaseConfig.isConnected && 
           redisClient.status === 'ready';
  }
}

const diagnoChainApp = new DiagnoChainApp();

if (require.main === module) {
  diagnoChainApp.start().catch((error) => {
    logger.error('Failed to start application', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = diagnoChainApp;