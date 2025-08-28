const path = require('path');
const fs = require('fs');

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const loadEnvFile = (envPath) => {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log(`Environment loaded from: ${envPath}`);
  }
};

if (isDevelopment) {
  loadEnvFile(path.join(__dirname, '../.env.development'));
} else if (isTest) {
  loadEnvFile(path.join(__dirname, '../.env.test'));
} else if (isProduction) {
  loadEnvFile(path.join(__dirname, '../.env.production'));
}

loadEnvFile(path.join(__dirname, '../.env.local'));
loadEnvFile(path.join(__dirname, '../.env'));

const requiredEnvVars = [
  'DB_HOST',
  'DB_NAME', 
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'WEB3_PROVIDER_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0 && isProduction) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

const config = {
  app: {
    name: 'DiagnoChain',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT) || 3001,
    host: process.env.HOST || '0.0.0.0',
    baseUrl: process.env.BASE_URL || 'http://localhost:3001',
    logLevel: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    timezone: process.env.TZ || 'UTC'
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'diagnochain',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    ssl: process.env.DB_SSL === 'true',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000
    },
    migrations: {
      tableName: 'schema_migrations',
      directory: path.join(__dirname, '../database/migrations')
    }
  },

  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    ttl: parseInt(process.env.REDIS_TTL) || 3600,
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'diagnochain:'
  },

  blockchain: {
    ethereum: {
      network: process.env.ETH_NETWORK || 'sepolia',
      providerUrl: process.env.WEB3_PROVIDER_URL || 'http://localhost:8545',
      privateKey: process.env.DEPLOYER_PRIVATE_KEY,
      gasLimit: parseInt(process.env.GAS_LIMIT) || 8000000,
      gasPrice: process.env.GAS_PRICE || 'auto',
      confirmations: parseInt(process.env.CONFIRMATION_BLOCKS) || 2
    },
    bitcoin: {
      network: process.env.BTC_NETWORK || 'testnet',
      rpcUrl: process.env.BTC_RPC_URL || 'http://localhost:18332',
      rpcUser: process.env.BTC_RPC_USER,
      rpcPassword: process.env.BTC_RPC_PASSWORD,
      minConfirmations: parseInt(process.env.BTC_MIN_CONFIRMATIONS) || 1,
      feeRate: parseInt(process.env.BTC_FEE_RATE) || 1
    }
  },

  contracts: {
    accessControl: {
      address: process.env.ACCESS_CONTROL_ADDRESS,
      deploymentBlock: parseInt(process.env.ACCESS_CONTROL_DEPLOY_BLOCK) || 0
    },
    doctorRegistry: {
      address: process.env.DOCTOR_REGISTRY_ADDRESS,
      deploymentBlock: parseInt(process.env.DOCTOR_REGISTRY_DEPLOY_BLOCK) || 0
    },
    consultationEscrow: {
      address: process.env.ESCROW_CONTRACT_ADDRESS,
      deploymentBlock: parseInt(process.env.ESCROW_DEPLOY_BLOCK) || 0
    },
    diagnosticNFT: {
      address: process.env.NFT_CONTRACT_ADDRESS,
      deploymentBlock: parseInt(process.env.NFT_DEPLOY_BLOCK) || 0
    },
    reputationSystem: {
      address: process.env.REPUTATION_CONTRACT_ADDRESS,
      deploymentBlock: parseInt(process.env.REPUTATION_DEPLOY_BLOCK) || 0
    },
    btcOracle: {
      address: process.env.ORACLE_CONTRACT_ADDRESS,
      deploymentBlock: parseInt(process.env.ORACLE_DEPLOY_BLOCK) || 0
    }
  },

  lightning: {
    enabled: process.env.LIGHTNING_ENABLED === 'true',
    endpoint: process.env.LIGHTNING_ENDPOINT || 'http://localhost:8080',
    macaroonPath: process.env.LIGHTNING_MACAROON_PATH,
    macaroon: process.env.LIGHTNING_MACAROON,
    cert: process.env.LIGHTNING_CERT,
    certPath: process.env.LIGHTNING_CERT_PATH,
    network: process.env.BTC_NETWORK || 'testnet'
  },

  ipfs: {
    provider: process.env.IPFS_PROVIDER || 'pinata', // 'pinata', 'infura', 'local'
    gateway: process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs',
    
    pinata: {
      apiKey: process.env.PINATA_API_KEY,
      secretKey: process.env.PINATA_SECRET_KEY,
      jwt: process.env.PINATA_JWT
    },
    
    infura: {
      projectId: process.env.INFURA_PROJECT_ID,
      secret: process.env.INFURA_SECRET,
      endpoint: 'https://ipfs.infura.io:5001'
    },
    
    local: {
      endpoint: process.env.LOCAL_IPFS_URL || 'http://localhost:5001'
    }
  },

  external: {
    blockchainAPI: {
      key: process.env.BLOCKCHAIN_API_KEY,
      provider: process.env.BLOCKCHAIN_API_PROVIDER || 'blockcypher'
    },
    
    priceFeeds: {
      coinGecko: {
        enabled: true,
        apiKey: process.env.COINGECKO_API_KEY,
        endpoint: 'https://api.coingecko.com/api/v3'
      },
      coinMarketCap: {
        enabled: !!process.env.CMC_API_KEY,
        apiKey: process.env.CMC_API_KEY,
        endpoint: 'https://pro-api.coinmarketcap.com/v1'
      },
      binance: {
        enabled: true,
        endpoint: 'https://api.binance.com/api/v3'
      }
    }
  },

  security: {
    jwt: {
      secret: process.env.JWT_SECRET || 'diagnochain-dev-secret-change-in-production',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      issuer: 'diagnochain-api',
      audience: 'diagnochain-frontend'
    },
    
    cors: {
      origin: process.env.CORS_ORIGINS ? 
        process.env.CORS_ORIGINS.split(',') : 
        ['http://localhost:3000', 'http://127.0.0.1:3000'],
      credentials: true
    },
    
    rateLimiting: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      skipSuccessfulRequests: false,
      skipFailedRequests: false
    },
    
    encryption: {
      algorithm: 'aes-256-gcm',
      keyDerivationIterations: 100000,
      saltLength: 32
    }
  },

  features: {
    doctorVerification: {
      enabled: true,
      minimumStake: process.env.MIN_DOCTOR_STAKE || '1000',
      verificationPeriodDays: parseInt(process.env.VERIFICATION_PERIOD_DAYS) || 7,
      minimumVerifierVotes: parseInt(process.env.MIN_VERIFIER_VOTES) || 3
    },
    
    consultation: {
      timeouts: {
        standard: parseInt(process.env.STANDARD_TIMEOUT_HOURS) || 24,
        urgent: parseInt(process.env.URGENT_TIMEOUT_HOURS) || 2
      },
      fees: {
        platform: parseInt(process.env.PLATFORM_FEE_BASIS_POINTS) || 300, // 3%
        minimum: process.env.MIN_CONSULTATION_FEE || '0.001'
      }
    },
    
    reputation: {
      dailyRewards: {
        enabled: true,
        poolAmount: process.env.DAILY_REWARD_POOL || '0.001',
        minimumRating: parseFloat(process.env.MIN_REWARD_RATING) || 4.0,
        minimumRatings: parseInt(process.env.MIN_RATING_COUNT) || 5
      },
      streakBonuses: {
        enabled: true,
        threshold: parseInt(process.env.STREAK_THRESHOLD) || 10,
        bonusAmount: process.env.STREAK_BONUS_AMOUNT || '0.00025'
      }
    },

    payments: {
      bitcoin: {
        enabled: true,
        preferLightning: process.env.PREFER_LIGHTNING === 'true',
        lightningTimeout: parseInt(process.env.LIGHTNING_TIMEOUT) || 30,
        onChainFallback: true
      },
      escrow: {
        enabled: true,
        multisigEnabled: process.env.MULTISIG_ENABLED === 'true',
        disputeTimeoutHours: parseInt(process.env.DISPUTE_TIMEOUT_HOURS) || 72,
        arbitratorCount: parseInt(process.env.ARBITRATOR_COUNT) || 3
      }
    }
  },

  monitoring: {
    healthCheck: {
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000
    },
    
    metrics: {
      enabled: process.env.METRICS_ENABLED === 'true',
      endpoint: process.env.METRICS_ENDPOINT || '/metrics',
      collectInterval: parseInt(process.env.METRICS_INTERVAL) || 60000
    },
    
    alerts: {
      enabled: process.env.ALERTS_ENABLED === 'true',
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
      emailEnabled: process.env.EMAIL_ALERTS === 'true',
      slackEnabled: process.env.SLACK_ALERTS === 'true'
    }
  },

  testing: {
    database: {
      host: process.env.TEST_DB_HOST || 'localhost',
      name: process.env.TEST_DB_NAME || 'diagnochain_test',
      username: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'password'
    },
    
    ethereum: {
      network: 'localhost',
      providerUrl: 'http://localhost:8545',
      accounts: [
        '0x8ba1f109551bD432803012645Hac136c63128f0F',
        '0x21CfD9B5a2BD36c00E3B04f7F0eC2e5C36DCC5E1'
      ]
    },
    
    bitcoin: {
      network: 'regtest',
      rpcUrl: 'http://localhost:18443',
      addresses: [
        'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      ]
    },
    
    mockData: {
      enabled: true,
      doctors: 5,
      patients: 20,
      consultations: 50
    }
  }
};

const validateConfig = () => {
  const errors = [];

  // Database validation
  if (!config.database.host) {
    errors.push('Database host is required');
  }

  if (!config.database.name) {
    errors.push('Database name is required');
  }

  // Blockchain validation
  if (!config.blockchain.ethereum.providerUrl) {
    errors.push('Ethereum provider URL is required');
  }

  if (isProduction) {
    if (!config.security.jwt.secret || config.security.jwt.secret === 'diagnochain-dev-secret-change-in-production') {
      errors.push('Production JWT secret must be set');
    }

    if (!config.blockchain.ethereum.privateKey) {
      errors.push('Deployer private key required for production');
    }

    if (config.app.logLevel === 'debug') {
      errors.push('Debug logging should not be used in production');
    }
  }

  // Lightning validation
  if (config.lightning.enabled && !config.lightning.endpoint) {
    errors.push('Lightning endpoint required when Lightning is enabled');
  }

  // IPFS validation
  if (config.ipfs.provider === 'pinata' && (!config.ipfs.pinata.apiKey || !config.ipfs.pinata.secretKey)) {
    errors.push('Pinata credentials required when using Pinata provider');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
};

const getContractAddress = (contractName) => {
  const contract = config.contracts[contractName];
  if (!contract || !contract.address) {
    throw new Error(`Contract address not configured: ${contractName}`);
  }
  return contract.address;
};

const getDatabaseUrl = () => {
  const { host, port, name, username, password, ssl } = config.database;
  const sslParam = ssl ? '?sslmode=require' : '';
  return `postgresql://${username}:${password}@${host}:${port}/${name}${sslParam}`;
};

const getRedisUrl = () => {
  const { host, port, password, db } = config.redis;
  const auth = password ? `:${password}@` : '';
  return `redis://${auth}${host}:${port}/${db}`;
};

const logConfiguration = () => {
  const safeConfig = {
    app: config.app,
    database: {
      ...config.database,
      password: config.database.password ? '[REDACTED]' : null
    },
    blockchain: {
      ethereum: {
        ...config.blockchain.ethereum,
        privateKey: config.blockchain.ethereum.privateKey ? '[REDACTED]' : null
      },
      bitcoin: {
        ...config.blockchain.bitcoin,
        rpcPassword: config.blockchain.bitcoin.rpcPassword ? '[REDACTED]' : null
      }
    },
    lightning: {
      ...config.lightning,
      macaroon: config.lightning.macaroon ? '[REDACTED]' : null
    },
    security: {
      ...config.security,
      jwt: {
        ...config.security.jwt,
        secret: '[REDACTED]'
      }
    }
  };

  console.log('DiagnoChain Configuration:');
  console.log(JSON.stringify(safeConfig, null, 2));
};

const getNetworkConfig = (network = config.blockchain.ethereum.network) => {
  const networks = {
    // Ethereum networks
    mainnet: {
      chainId: 1,
      name: 'Ethereum Mainnet',
      currency: 'ETH',
      explorer: 'https://etherscan.io',
      rpc: 'https://mainnet.infura.io/v3/'
    },
    goerli: {
      chainId: 5,
      name: 'Goerli Testnet', 
      currency: 'ETH',
      explorer: 'https://goerli.etherscan.io',
      rpc: 'https://goerli.infura.io/v3/'
    },
    sepolia: {
      chainId: 11155111,
      name: 'Sepolia Testnet',
      currency: 'ETH', 
      explorer: 'https://sepolia.etherscan.io',
      rpc: 'https://sepolia.infura.io/v3/'
    },
    localhost: {
      chainId: 1337,
      name: 'Local Network',
      currency: 'ETH',
      explorer: 'http://localhost:8545',
      rpc: 'http://localhost:8545'
    },

    // Bitcoin networks
    bitcoin: {
      name: 'Bitcoin Mainnet',
      explorer: 'https://blockstream.info',
      api: 'https://blockstream.info/api'
    },
    testnet: {
      name: 'Bitcoin Testnet',
      explorer: 'https://blockstream.info/testnet',
      api: 'https://blockstream.info/testnet/api'
    },
    regtest: {
      name: 'Bitcoin Regtest',
      explorer: 'http://localhost:3002',
      api: 'http://localhost:3001'
    }
  };

  return networks[network] || null;
};

const createDatabaseConfig = () => {
  return {
    development: {
      client: 'postgresql',
      connection: getDatabaseUrl(),
      pool: config.database.pool,
      migrations: {
        directory: './database/migrations'
      },
      seeds: {
        directory: './database/seeds'
      }
    },
    
    test: {
      client: 'postgresql',
      connection: getDatabaseUrl().replace(config.database.name, config.testing.database.name),
      pool: { min: 1, max: 5 },
      migrations: {
        directory: './database/migrations'
      }
    },
    
    production: {
      client: 'postgresql',
      connection: getDatabaseUrl(),
      pool: config.database.pool,
      migrations: {
        directory: './database/migrations'
      },
      acquireConnectionTimeout: 60000,
      asyncStackTraces: false
    }
  };
};

const createWeb3Config = () => {
  return {
    provider: config.blockchain.ethereum.providerUrl,
    network: config.blockchain.ethereum.network,
    chainId: getNetworkConfig(config.blockchain.ethereum.network)?.chainId,
    gas: config.blockchain.ethereum.gasLimit,
    gasPrice: config.blockchain.ethereum.gasPrice,
    confirmations: config.blockchain.ethereum.confirmations,
    timeout: 60000,
    polling: {
      interval: 4000,
      timeout: 60000
    }
  };
};

const createLightningConfig = () => {
  if (!config.lightning.enabled) {
    return { enabled: false };
  }

  const lnConfig = {
    enabled: true,
    endpoint: config.lightning.endpoint,
    network: config.lightning.network,
    timeout: 30000
  };

  if (config.lightning.macaroon) {
    lnConfig.macaroon = config.lightning.macaroon;
  } else if (config.lightning.macaroonPath && fs.existsSync(config.lightning.macaroonPath)) {
    lnConfig.macaroon = fs.readFileSync(config.lightning.macaroonPath, 'hex');
  }

  if (config.lightning.cert) {
    lnConfig.cert = config.lightning.cert;
  } else if (config.lightning.certPath && fs.existsSync(config.lightning.certPath)) {
    lnConfig.cert = fs.readFileSync(config.lightning.certPath);
  }

  return lnConfig;
};

const getEnvironmentDefaults = () => {
  if (isDevelopment) {
    return {
      database: { pool: { min: 2, max: 10 } },
      logging: { level: 'debug' },
      security: { rateLimiting: { max: 1000 } },
      features: { mockData: { enabled: true } }
    };
  }

  if (isTest) {
    return {
      database: { pool: { min: 1, max: 5 } },
      logging: { level: 'warn' },
      security: { rateLimiting: { max: 10000 } },
      features: { mockData: { enabled: true } }
    };
  }

  if (isProduction) {
    return {
      database: { pool: { min: 5, max: 50 } },
      logging: { level: 'info' },
      security: { rateLimiting: { max: 100 } },
      features: { mockData: { enabled: false } }
    };
  }

  return {};
};

// Apply environment-specific defaults
const envDefaults = getEnvironmentDefaults();
Object.keys(envDefaults).forEach(key => {
  if (config[key]) {
    config[key] = { ...config[key], ...envDefaults[key] };
  }
});

// Validate configuration
validateConfig();

// Log configuration in development
if (isDevelopment && process.env.SHOW_CONFIG === 'true') {
  logConfiguration();
}

module.exports = {
  ...config,
  
  // Helper functions
  getDatabaseUrl,
  getRedisUrl,
  getContractAddress,
  getNetworkConfig,
  createDatabaseConfig,
  createWeb3Config,
  createLightningConfig,
  validateConfig,
  
  // Environment checks
  isDevelopment,
  isProduction,
  isTest,
  
  // Factory functions for common configurations
  createExpressApp: () => require('../backend/src/server'),
  createDatabase: () => require('../database/migrations/migrations'),
  createBitcoinAPI: () => require('../bitcoin/bitcoinAPI')
};