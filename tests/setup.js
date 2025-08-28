const { expect } = require('chai');
const sinon = require('sinon');
const nock = require('nock');
const path = require('path');
const fs = require('fs').promises;

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise during tests
process.env.DB_NAME = 'diagnochain_test';
process.env.REDIS_DB = '1'; // Separate Redis DB for tests
process.env.BTC_NETWORK = 'regtest';
process.env.ETH_NETWORK = 'localhost';

// Test configuration
const testConfig = {
  timeout: {
    unit: 5000,
    integration: 30000,
    e2e: 60000,
    security: 45000
  },
  
  retries: {
    unit: 1,
    integration: 2,
    e2e: 3,
    security: 1
  },

  contracts: {
    gasLimit: 8000000,
    gasPrice: '1', // 1 gwei for tests
    confirmations: 1
  },

  bitcoin: {
    network: 'regtest',
    mockPayments: true,
    mockLightning: true
  },

  ipfs: {
    useMock: true,
    mockUploadDelay: 100,
    mockDownloadDelay: 50
  },

  database: {
    resetBetweenTests: true,
    seedTestData: true,
    useTransactions: true
  }
};

// Global test utilities
global.testUtils = {
  
  // Generate test Ethereum addresses
  generateTestAddress: () => {
    return ethers.Wallet.createRandom().address;
  },

  // Generate test Bitcoin addresses  
  generateTestBtcAddress: (network = 'testnet') => {
    const prefix = network === 'testnet' ? 'tb1q' : 'bc1q';
    return prefix + crypto.randomBytes(20).toString('hex');
  },

  // Create test JWT tokens
  createTestToken: (address, role = 'patient', expiresIn = '1h') => {
    return jwt.sign(
      { address, role, isAdmin: false },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn }
    );
  },

  // Mock Web3 provider for contract tests
  mockWeb3Provider: () => ({
    getNetwork: () => Promise.resolve({ name: 'localhost', chainId: 1337 }),
    getBalance: () => Promise.resolve(ethers.utils.parseEther('100')),
    getGasPrice: () => Promise.resolve(ethers.utils.parseUnits('1', 'gwei')),
    getBlockNumber: () => Promise.resolve(12345),
    sendTransaction: sinon.stub().resolves({ hash: '0x' + '0'.repeat(64) })
  }),

  // Mock IPFS responses
  mockIPFS: {
    upload: (data) => ({
      hash: 'Qm' + crypto.randomBytes(22).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 44),
      size: JSON.stringify(data).length,
      timestamp: new Date().toISOString()
    }),
    
    download: (hash) => ({
      data: { 
        content: 'Mock decrypted content',
        timestamp: new Date().toISOString()
      },
      hash,
      downloaded: true
    })
  },

  // Mock Bitcoin responses
  mockBitcoin: {
    createWallet: () => ({
      address: global.testUtils.generateTestBtcAddress(),
      balance: 0.01 + Math.random() * 0.05,
      network: 'testnet'
    }),
    
    sendPayment: (amount) => ({
      txid: crypto.randomBytes(32).toString('hex'),
      amount: parseFloat(amount),
      fee: 0.00001,
      confirmations: 6,
      success: true
    }),
    
    lightningInvoice: (amount, memo) => ({
      paymentRequest: `lntb${Math.floor(amount * 100000000)}u1p${crypto.randomBytes(20).toString('hex')}`,
      paymentHash: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })
  },

  // Database utilities
  db: {
    async clean() {
      // Clean test database between tests
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'diagnochain_test',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password'
      });

      try {
        await pool.query('TRUNCATE TABLE consultation_feedback CASCADE');
        await pool.query('TRUNCATE TABLE diagnostic_nfts CASCADE');
        await pool.query('TRUNCATE TABLE btc_transactions CASCADE');
        await pool.query('TRUNCATE TABLE escrow_records CASCADE');
        await pool.query('TRUNCATE TABLE consultations CASCADE');
        await pool.query('TRUNCATE TABLE doctor_verifications CASCADE');
        await pool.query('TRUNCATE TABLE doctors CASCADE');
        await pool.query('TRUNCATE TABLE user_roles CASCADE');
        await pool.query('TRUNCATE TABLE users CASCADE');
        
        await pool.end();
      } catch (error) {
        console.warn('Database cleanup failed:', error.message);
      }
    },

    async seed() {
      // Seed test data
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'diagnochain_test',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password'
      });

      try {
        // Insert test users
        await pool.query(`
          INSERT INTO users (eth_address, btc_address, user_role, is_verified) VALUES
          ('0x1234567890123456789012345678901234567890', 'tb1qtest1patient', 'patient', TRUE),
          ('0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc', 'tb1qtest1doctor', 'doctor', TRUE),
          ('0x987fed321cba987fed321cba987fed321cba9876', 'tb1qtest1verifier', 'verifier', TRUE)
          ON CONFLICT (eth_address) DO NOTHING
        `);

        // Insert test doctor
        await pool.query(`
          INSERT INTO doctors (user_id, license_number, institution, specialties, staked_amount, verification_status, verified_at)
          SELECT 
            u.id, 'TEST12345', 'Test Medical School', 
            ARRAY['dermatology', 'general_practice'], 
            1000.00000000, 'approved', NOW()
          FROM users u WHERE u.eth_address = '0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc'
          ON CONFLICT DO NOTHING
        `);

        await pool.end();
      } catch (error) {
        console.warn('Database seeding failed:', error.message);
      }
    }
  },

  // Test data generators
  generateConsultationData: (overrides = {}) => ({
    doctorAddress: '0x742d35Cc9F8f34D9b9C8c7D2B4b1234567890abc',
    symptoms: 'Test symptoms for automated testing purposes',
    specialty: 'dermatology',
    isUrgent: false,
    fee: '0.05',
    ...overrides
  }),

  generateDoctorData: (overrides = {}) => ({
    licenseNumber: `TEST${Math.floor(Math.random() * 100000)}`,
    institution: 'Test Medical Institution',
    specialties: ['general_practice'],
    credentialsHash: 'QmTest' + crypto.randomBytes(20).toString('hex'),
    stakeAmount: '1000',
    ...overrides
  }),

  // Assertion helpers
  expectValidConsultation: (consultation) => {
    expect(consultation).to.have.property('id');
    expect(consultation).to.have.property('patientAddress');
    expect(consultation).to.have.property('doctorAddress');
    expect(consultation).to.have.property('fee');
    expect(consultation).to.have.property('status');
    expect(consultation).to.have.property('createdAt');
    
    expect(consultation.patientAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(consultation.doctorAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(parseFloat(consultation.fee)).to.be.gt(0);
  },

  expectValidBitcoinTransaction: (transaction) => {
    expect(transaction).to.have.property('txid');
    expect(transaction).to.have.property('amount');
    expect(transaction).to.have.property('status');
    expect(transaction).to.have.property('timestamp');
    
    expect(transaction.txid).to.match(/^[a-fA-F0-9]{64}$/);
    expect(parseFloat(transaction.amount)).to.be.gt(0);
    expect(['pending', 'confirmed', 'failed']).to.include(transaction.status);
  },

  expectValidIPFSHash: (hash) => {
    expect(hash).to.match(/^Qm[a-zA-Z0-9]{44}$/);
  },

  // Performance measurement utilities
  measureExecutionTime: async (asyncFn) => {
    const startTime = process.hrtime.bigint();
    const result = await asyncFn();
    const endTime = process.hrtime.bigint();
    const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    return { result, executionTime };
  },

  // Network mocking
  mockExternalAPIs: () => {
    // Mock Bitcoin price APIs
    nock('https://api.coingecko.com')
      .persist()
      .get('/api/v3/simple/price')
      .query(true)
      .reply(200, {
        bitcoin: { usd: 43000 },
        ethereum: { usd: 2000 }
      });

    // Mock BlockCypher API
    nock('https://api.blockcypher.com')
      .persist()
      .get(/.*/)
      .reply(200, { balance: 1000000, unconfirmed_balance: 0 });

    // Mock IPFS gateways
    nock('https://gateway.pinata.cloud')
      .persist()
      .get(/\/ipfs\/.*/)
      .reply(200, { content: 'mock ipfs data' });

    // Mock Lightning node
    nock('http://localhost:8080')
      .persist()
      .get('/v1/getinfo')
      .reply(200, {
        alias: 'test-node',
        identity_pubkey: '0'.repeat(66),
        synced_to_graph: true,
        block_height: 700000
      });
  },

  cleanupMocks: () => {
    nock.cleanAll();
    sinon.restore();
  }
};

// Global test hooks
before(async function () {
  this.timeout(30000);
  
  console.log('🧪 Setting up DiagnoChain test environment...');
  
  // Setup external API mocks
  global.testUtils.mockExternalAPIs();
  
  // Clean and seed database
  if (testConfig.database.resetBetweenTests) {
    await global.testUtils.db.clean();
  }
  
  if (testConfig.database.seedTestData) {
    await global.testUtils.db.seed();
  }

  console.log('✅ Test environment setup complete');
});

beforeEach(async function () {
  // Clean state between tests
  sinon.restore();
  
  // Reset any in-memory caches
  if (global.testCache) {
    global.testCache.clear();
  }
});

afterEach(function () {
  // Cleanup after each test
  if (this.currentTest.state === 'failed') {
    console.log(`❌ Test failed: ${this.currentTest.title}`);
    console.log(`   Error: ${this.currentTest.err.message}`);
  }
});

after(async function () {
  console.log('🧹 Cleaning up test environment...');
  
  // Cleanup mocks
  global.testUtils.cleanupMocks();
  
  // Reset database
  if (testConfig.database.resetBetweenTests) {
    await global.testUtils.db.clean();
  }
  
  console.log('✅ Test cleanup complete');
});

// Enhanced assertion helpers
const customAssertions = {
  
  // Smart contract specific assertions
  async toBeValidTransaction(received) {
    const transaction = await received;
    
    expect(transaction).to.have.property('hash');
    expect(transaction.hash).to.match(/^0x[a-fA-F0-9]{64}$/);
    expect(transaction).to.have.property('blockNumber');
    expect(transaction.blockNumber).to.be.a('number');
    
    return { pass: true };
  },

  // API response assertions
  toBeValidAPIResponse(received) {
    expect(received).to.have.property('success');
    expect(received).to.have.property('timestamp');
    expect(received.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    
    return { pass: true };
  },

  // Bitcoin transaction assertions
  toBeValidBitcoinTx(received) {
    expect(received).to.have.property('txid');
    expect(received.txid).to.match(/^[a-fA-F0-9]{64}$/);
    expect(received).to.have.property('amount');
    expect(parseFloat(received.amount)).to.be.gt(0);
    
    return { pass: true };
  },

  // Encryption assertions
  toBeEncrypted(received) {
    expect(received).to.have.property('encrypted', true);
    expect(received).to.have.property('hash');
    expect(received).to.have.property('metadata');
    
    // Should not contain plaintext sensitive data
    const responseStr = JSON.stringify(received);
    expect(responseStr).to.not.include('password');
    expect(responseStr).to.not.include('private');
    expect(responseStr).to.not.include('secret');
    
    return { pass: true };
  }
};

// Extend Chai with custom assertions
Object.keys(customAssertions).forEach(assertionName => {
  chai.use(function (chai, utils) {
    chai.Assertion.addMethod(assertionName, customAssertions[assertionName]);
  });
});

// Test data factories
class TestDataFactory {
  static createUser(role = 'patient', overrides = {}) {
    return {
      address: global.testUtils.generateTestAddress(),
      btcAddress: global.testUtils.generateTestBtcAddress(),
      role,
      isVerified: true,
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createDoctor(overrides = {}) {
    return {
      ...TestDataFactory.createUser('doctor'),
      licenseNumber: `TEST${Math.random().toString().substr(2, 6)}`,
      institution: 'Test Medical School',
      specialties: ['general_practice'],
      reputationScore: 1000 + Math.floor(Math.random() * 4000),
      ...overrides
    };
  }

  static createConsultation(patientAddress, doctorAddress, overrides = {}) {
    return {
      id: Math.floor(Math.random() * 10000),
      patientAddress,
      doctorAddress,
      symptoms: 'Test consultation symptoms',
      specialty: 'general_practice',
      fee: '0.05',
      btcEquivalent: '0.00234',
      status: 'pending',
      isUrgent: false,
      createdAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...overrides
    };
  }

  static createNFTMetadata(consultationId, overrides = {}) {
    return {
      name: `DiagnoChain Diagnostic #${consultationId}`,
      description: 'Test diagnostic NFT',
      image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      attributes: [
        { trait_type: 'Consultation ID', value: consultationId },
        { trait_type: 'Confidence', value: 8, max_value: 10 },
        { trait_type: 'Specialty', value: 'dermatology' }
      ],
      ...overrides
    };
  }
}

// Database test helpers
class DatabaseHelper {
  constructor() {
    this.pool = null;
  }

  async connect() {
    const { Pool } = require('pg');
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'diagnochain_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password'
    });
  }

  async insertTestUser(userData) {
    if (!this.pool) await this.connect();
    
    const query = `
      INSERT INTO users (eth_address, btc_address, user_role, is_verified)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    
    const result = await this.pool.query(query, [
      userData.address,
      userData.btcAddress,
      userData.role,
      userData.isVerified
    ]);
    
    return result.rows[0].id;
  }

  async insertTestConsultation(consultationData) {
    if (!this.pool) await this.connect();
    
    const query = `
      INSERT INTO consultations (
        consultation_id, patient_id, doctor_id, specialty,
        symptoms_ipfs_hash, fee_eth, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    
    const result = await this.pool.query(query, [
      consultationData.consultationId,
      consultationData.patientId,
      consultationData.doctorId,
      consultationData.specialty,
      consultationData.symptomsHash,
      consultationData.fee,
      consultationData.status,
      consultationData.createdAt
    ]);
    
    return result.rows[0].id;
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// Security testing utilities
class SecurityTestUtils {
  static generateSQLInjectionPayloads() {
    return [
      "'; DROP TABLE users; --",
      "' OR 1=1 --",
      "' UNION SELECT password FROM admin_users --",
      "'; UPDATE users SET role='admin' WHERE 1=1; --",
      "' AND (SELECT COUNT(*) FROM users) > 0 --"
    ];
  }

  static generateXSSPayloads() {
    return [
      '<script>alert("xss")</script>',
      'javascript:alert("xss")',
      '<img src="x" onerror="alert(\'xss\')">',
      '"><script>alert("xss")</script>',
      '<svg onload="alert(\'xss\')">',
      'onmouseover="alert(\'xss\')"'
    ];
  }

  static generatePathTraversalPayloads() {
    return [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '....//....//....//etc//passwd',
      '..%252f..%252f..%252fetc%252fpasswd'
    ];
  }

  static async testInputSanitization(endpoint, field, payloads, authToken) {
    const results = [];
    
    for (const payload of payloads) {
      try {
        const testData = {};
        testData[field] = payload;
        
        const response = await request(app)
          .post(endpoint)
          .set('Authorization', `Bearer ${authToken}`)
          .send(testData);

        results.push({
          payload,
          status: response.status,
          sanitized: !JSON.stringify(response.body).includes(payload),
          error: response.body.error || null
        });
      } catch (error) {
        results.push({
          payload,
          status: 500,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

// Performance testing utilities
class PerformanceTestUtils {
  static async measureResponseTime(requestFn) {
    const startTime = process.hrtime.bigint();
    const result = await requestFn();
    const endTime = process.hrtime.bigint();
    
    return {
      result,
      responseTime: Number(endTime - startTime) / 1000000 // milliseconds
    };
  }

  static async loadTest(requestFn, options = {}) {
    const {
      concurrency = 10,
      duration = 5000,
      rampUp = 1000
    } = options;

    const results = [];
    const startTime = Date.now();

    // Ramp up phase
    for (let i = 0; i < concurrency; i++) {
      setTimeout(async () => {
        while (Date.now() - startTime < duration) {
          try {
            const { result, responseTime } = await this.measureResponseTime(requestFn);
            results.push({ 
              success: true, 
              responseTime,
              timestamp: Date.now()
            });
          } catch (error) {
            results.push({ 
              success: false, 
              error: error.message,
              timestamp: Date.now()
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay
        }
      }, (i * rampUp) / concurrency);
    }

    // Wait for test completion
    await new Promise(resolve => setTimeout(resolve, duration + rampUp));

    return {
      totalRequests: results.length,
      successfulRequests: results.filter(r => r.success).length,
      failedRequests: results.filter(r => !r.success).length,
      averageResponseTime: results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.responseTime, 0) / results.filter(r => r.success).length || 0,
      maxResponseTime: Math.max(...results.filter(r => r.success).map(r => r.responseTime)),
      minResponseTime: Math.min(...results.filter(r => r.success).map(r => r.responseTime))
    };
  }
}

// Export utilities for use in test files
global.TestDataFactory = TestDataFactory;
global.DatabaseHelper = new DatabaseHelper();
global.SecurityTestUtils = SecurityTestUtils;
global.PerformanceTestUtils = PerformanceTestUtils;

// Configure test framework
const originalIt = global.it;
global.it = function(title, testFn) {
  return originalIt(title, async function() {
    // Add automatic timeout based on test type
    const testType = this.parent.title.toLowerCase();
    
    if (testType.includes('security')) {
      this.timeout(testConfig.timeout.security);
    } else if (testType.includes('integration') || testType.includes('e2e')) {
      this.timeout(testConfig.timeout.integration);
    } else {
      this.timeout(testConfig.timeout.unit);
    }
    
    // Execute test with error handling
    try {
      return await testFn.call(this);
    } catch (error) {
      // Enhanced error reporting
      console.error(`Test failed: ${title}`);
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(`Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
      }
      throw error;
    }
  });
};

// Enhanced describe with automatic setup
const originalDescribe = global.describe;
global.describe = function(title, testSuite) {
  return originalDescribe(title, function() {
    // Auto-retry for flaky tests
    if (title.toLowerCase().includes('integration') || title.toLowerCase().includes('e2e')) {
      this.retries(testConfig.retries.integration);
    } else if (title.toLowerCase().includes('security')) {
      this.retries(testConfig.retries.security);
    } else {
      this.retries(testConfig.retries.unit);
    }
    
    return testSuite.call(this);
  });
};

// Test result reporter
class TestReporter {
  static generateTestReport(results) {
    const report = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'test',
      summary: {
        total: results.tests,
        passed: results.passes,
        failed: results.failures,
        pending: results.pending,
        duration: results.duration
      },
      coverage: results.coverage || null,
      performance: {
        slowestTest: results.slowestTest || null,
        averageTestTime: results.duration / results.tests || 0
      }
    };

    return report;
  }

  static async saveTestReport(report) {
    try {
      const reportsDir = path.join(__dirname, '../reports');
      await fs.mkdir(reportsDir, { recursive: true });
      
      const filename = `test-report-${Date.now()}.json`;
      const filepath = path.join(reportsDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));
      console.log(`📊 Test report saved: ${filepath}`);
    } catch (error) {
      console.warn('Failed to save test report:', error.message);
    }
  }
}

global.TestReporter = TestReporter;

// Uncaught exception handler for tests
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in tests:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection in tests:', reason);
  process.exit(1);
});

// Test environment validation
function validateTestEnvironment() {
  const requiredEnvVars = [
    'NODE_ENV',
    'DB_HOST',
    'DB_NAME',
    'DB_USER'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.warn(`⚠️  Missing test environment variables: ${missingVars.join(', ')}`);
  }

  // Check test dependencies
  try {
    require('puppeteer');
    console.log('✅ E2E testing dependencies available');
  } catch (error) {
    console.warn('⚠️  E2E testing dependencies missing (install puppeteer)');
  }

  try {
    require('hardhat');
    console.log('✅ Smart contract testing dependencies available');
  } catch (error) {
    console.warn('⚠️  Smart contract testing dependencies missing');
  }
}

validateTestEnvironment();

// Export test configuration
module.exports = {
  testConfig,
  TestDataFactory,
  DatabaseHelper: global.DatabaseHelper,
  SecurityTestUtils,
  PerformanceTestUtils,
  TestReporter,
  testUtils: global.testUtils
};

console.log('🚀 DiagnoChain test setup loaded successfully');
console.log(`📋 Test configuration:`, {
  environment: process.env.NODE_ENV,
  database: process.env.DB_NAME,
  bitcoin: testConfig.bitcoin.network,
  ipfs: testConfig.ipfs.useMock ? 'mock' : 'real'
});