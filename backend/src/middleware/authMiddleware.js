const jwt = require('jsonwebtoken');
const Web3 = require('web3');
const rateLimit = require('express-rate-limit');

const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'diagnochain-dev-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const web3 = new Web3();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth attempts per window
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const verifySignature = (message, signature, address) => {
  try {
    const messageHash = web3.utils.sha3(message);
    const recoveredAddress = web3.eth.accounts.recover(messageHash, signature);
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (error) {
    logger.error('Signature verification error:', error);
    return false;
  }
};

const generateNonce = () => {
  return Math.floor(Math.random() * 1000000).toString();
};

const nonceStorage = new Map();

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid JWT token'
      });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const user = await getUserByAddress(decoded.address);
      if (!user) {
        return res.status(401).json({
          error: 'Invalid user',
          message: 'User not found or inactive'
        });
      }

      req.user = user;
      next();
      
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Please authenticate again'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Authentication token is malformed'
        });
      } else {
        throw jwtError;
      }
    }

  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error during authentication'
    });
  }
};

const generateAuthMessage = (address, nonce) => {
  return `DiagnoChain Authentication\n\nWallet: ${address}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
};

const requestNonce = (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || !web3.utils.isAddress(address)) {
      return res.status(400).json({
        error: 'Invalid address',
        message: 'Please provide a valid Ethereum address'
      });
    }

    const nonce = generateNonce();
    const message = generateAuthMessage(address, nonce);
    
    nonceStorage.set(address.toLowerCase(), {
      nonce,
      message,
      timestamp: Date.now(),
      expires: Date.now() + (5 * 60 * 1000) // 5 minutes
    });

    logger.info('Nonce requested:', { address, nonce });

    res.json({
      success: true,
      message,
      nonce
    });

  } catch (error) {
    logger.error('Error generating nonce:', error);
    res.status(500).json({
      error: 'Failed to generate nonce'
    });
  }
};

const authenticateWallet = authLimiter, async (req, res) => {
  try {
    const { address, signature } = req.body;

    if (!address || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Address and signature are required'
      });
    }

    if (!web3.utils.isAddress(address)) {
      return res.status(400).json({
        error: 'Invalid address format'
      });
    }

    const storedNonce = nonceStorage.get(address.toLowerCase());
    if (!storedNonce) {
      return res.status(400).json({
        error: 'Nonce not found',
        message: 'Please request a new nonce'
      });
    }

    if (Date.now() > storedNonce.expires) {
      nonceStorage.delete(address.toLowerCase());
      return res.status(400).json({
        error: 'Nonce expired',
        message: 'Please request a new nonce'
      });
    }

    const isValidSignature = verifySignature(storedNonce.message, signature, address);
    if (!isValidSignature) {
      return res.status(401).json({
        error: 'Invalid signature',
        message: 'Signature verification failed'
      });
    }

    nonceStorage.delete(address.toLowerCase());

    let user = await getUserByAddress(address);
    if (!user) {
      user = await createUser(address);
    }

    const token = jwt.sign(
      { 
        address: user.address,
        role: user.role,
        isAdmin: user.isAdmin || false
      },
      JWT_SECRET,
      { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'diagnochain-api',
        audience: 'diagnochain-frontend'
      }
    );

    logger.info('User authenticated:', { address: user.address, role: user.role });

    res.json({
      success: true,
      token,
      user: {
        address: user.address,
        role: user.role,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    logger.error('Wallet authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed'
    });
  }
};

const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    if (Array.isArray(requiredRole)) {
      if (!requiredRole.includes(req.user.role) && !req.user.isAdmin) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `Required role: ${requiredRole.join(' or ')}`
        });
      }
    } else {
      if (req.user.role !== requiredRole && !req.user.isAdmin) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `Required role: ${requiredRole}`
        });
      }
    }

    next();
  };
};

const requireSelfOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  const targetAddress = req.params.address || req.body.address;
  
  if (req.user.address.toLowerCase() !== targetAddress.toLowerCase() && !req.user.isAdmin) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'You can only access your own data'
    });
  }

  next();
};

const requireVerifiedDoctor = async (req, res, next) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({
        error: 'Doctor role required'
      });
    }

    const doctorInfo = await getVerifiedDoctorInfo(req.user.address);
    if (!doctorInfo || !doctorInfo.isVerified) {
      return res.status(403).json({
        error: 'Doctor verification required',
        message: 'Please complete the doctor verification process'
      });
    }

    req.doctor = doctorInfo;
    next();

  } catch (error) {
    logger.error('Doctor verification check error:', error);
    res.status(500).json({
      error: 'Verification check failed'
    });
  }
};

const logRequest = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('API Request:', {
      method: req.method,
      url: req.originalUrl,
      userAddress: req.user?.address || 'anonymous',
      userRole: req.user?.role || 'none',
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
};

async function getUserByAddress(address) {
  const mockUsers = {
    '0x1234567890123456789012345678901234567890': {
      address: '0x1234567890123456789012345678901234567890',
      role: 'patient',
      isVerified: true,
      isAdmin: false,
      createdAt: '2025-08-25T10:00:00Z'
    },
    '0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc': {
      address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      role: 'doctor',
      isVerified: true,
      isAdmin: false,
      createdAt: '2025-08-20T15:30:00Z'
    }
  };

  return mockUsers[address.toLowerCase()] || null;
}

async function createUser(address) {
  const newUser = {
    address,
    role: 'patient', // default role
    isVerified: false,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };

  logger.info('New user created:', { address });
  return newUser;
}

async function getVerifiedDoctorInfo(address) {
  const mockDoctors = {
    '0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc': {
      address: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
      isVerified: true,
      specialties: ['dermatology'],
      licenseNumber: 'MD12345',
      institution: 'Stanford Medical School',
      stakedAmount: '1000',
      reputationScore: 4800 // scaled by 1000
    }
  };

  return mockDoctors[address.toLowerCase()] || null;
}

module.exports = {
  authenticate,
  requestNonce,
  authenticateWallet,
  requireRole,
  requireSelfOrAdmin,
  requireVerifiedDoctor,
  logRequest,
  generateNonce,
  verifySignature
};