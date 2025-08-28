const EventEmitter = require('events');
const express = require('express');

const LightningClient = require('./lightning/lightningClient');
const WalletManager = require('./wallet/walletManager');
const PaymentProcessor = require('./escrow/paymentProcessor');
const MultisigEscrow = require('./escrow/multisigEscrow');
const BitcoinOracle = require('./oracles/bitcoinOracle');

const logger = require('../backend/src/utils/logger');

class BitcoinAPI extends EventEmitter {
  constructor() {
    super();
    
    this.lightningClient = LightningClient;
    this.walletManager = WalletManager;
    this.paymentProcessor = PaymentProcessor;
    this.multisigEscrow = MultisigEscrow;
    this.bitcoinOracle = BitcoinOracle;
    
    this.router = express.Router();
    this.isInitialized = false;
    
    this.healthStatus = {
      lightning: false,
      wallets: true,
      payments: true,
      oracle: false,
      multisig: true
    };

    this.statistics = {
      totalTransactions: 0,
      totalVolume: 0,
      activeEscrows: 0,
      successRate: 0,
      averageConfirmationTime: 0,
      lastActivity: null
    };

    this.setupRoutes();
    this.setupEventListeners();
    this.init();
  }

  async init() {
    try {
      await this.initializeServices();
      await this.performHealthChecks();
      this.startMonitoring();
      
      this.isInitialized = true;
      logger.info('Bitcoin API initialized successfully');
      
      this.emit('initialized', this.healthStatus);
      
    } catch (error) {
      logger.error('Bitcoin API initialization failed:', error);
      this.emit('initialization_failed', error);
    }
  }

  async initializeServices() {
    try {
      this.healthStatus.oracle = await this.testOracleConnection();
      
      if (this.lightningClient.isConnected) {
        this.healthStatus.lightning = true;
      }

      logger.info('Bitcoin services initialized:', this.healthStatus);
      
    } catch (error) {
      logger.warn('Some Bitcoin services failed to initialize:', error);
    }
  }

  setupEventListeners() {
    this.lightningClient.on('connected', () => {
      this.healthStatus.lightning = true;
      logger.info('Lightning client connected');
    });

    this.lightningClient.on('disconnected', () => {
      this.healthStatus.lightning = false;
      logger.warn('Lightning client disconnected');
    });

    this.paymentProcessor.on('escrow_released', (data) => {
      this.statistics.totalTransactions++;
      this.statistics.totalVolume += data.amount;
      this.statistics.lastActivity = new Date().toISOString();
      logger.info('Payment processed:', data);
    });

    this.multisigEscrow.on('dispute_resolved', (data) => {
      logger.info('Dispute resolved via multisig:', data);
    });

    this.bitcoinOracle.on('price_updated', (prices) => {
      this.statistics.lastActivity = new Date().toISOString();
    });
  }

  setupRoutes() {
    // Wallet management routes
    this.router.post('/wallet/create', async (req, res) => {
      try {
        const { userAddress, customMnemonic } = req.body;
        
        if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
          return res.status(400).json({ error: 'Valid Ethereum address required' });
        }

        const wallet = await this.walletManager.createWallet(userAddress, customMnemonic);
        
        res.json({
          success: true,
          wallet: {
            address: wallet.address,
            network: wallet.network,
            balance: wallet.balance,
            createdAt: wallet.createdAt
          }
        });

      } catch (error) {
        logger.error('Error creating wallet:', error);
        res.status(500).json({ 
          error: 'Failed to create wallet',
          message: error.message 
        });
      }
    });

    this.router.post('/wallet/import', async (req, res) => {
      try {
        const { userAddress, btcAddress, privateKey } = req.body;
        
        const wallet = await this.walletManager.importWallet(userAddress, btcAddress, privateKey);
        
        res.json({
          success: true,
          wallet
        });

      } catch (error) {
        logger.error('Error importing wallet:', error);
        res.status(500).json({ error: 'Failed to import wallet' });
      }
    });

    this.router.get('/wallet/:userAddress', async (req, res) => {
      try {
        const { userAddress } = req.params;
        const wallet = await this.walletManager.getWallet(userAddress);
        
        if (!wallet) {
          return res.status(404).json({ error: 'Wallet not found' });
        }

        res.json({
          success: true,
          wallet
        });

      } catch (error) {
        logger.error('Error fetching wallet:', error);
        res.status(500).json({ error: 'Failed to fetch wallet' });
      }
    });

    // Lightning Network routes
    this.router.post('/lightning/invoice', async (req, res) => {
      try {
        const { amount, memo, expiry = 3600 } = req.body;
        
        if (!amount || amount <= 0) {
          return res.status(400).json({ error: 'Valid amount required' });
        }

        const invoice = await this.lightningClient.createInvoice(amount, memo, expiry);
        
        res.json({
          success: true,
          invoice: {
            paymentRequest: invoice.payment_request,
            paymentHash: invoice.r_hash,
            amount,
            memo,
            expiresAt: new Date(Date.now() + expiry * 1000).toISOString()
          }
        });

      } catch (error) {
        logger.error('Error creating Lightning invoice:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
      }
    });

    this.router.post('/lightning/pay', async (req, res) => {
      try {
        const { paymentRequest, timeoutSeconds = 60 } = req.body;
        
        const payment = await this.lightningClient.payInvoice(paymentRequest, timeoutSeconds);
        
        res.json({
          success: true,
          payment: {
            paymentHash: payment.payment_hash,
            preimage: payment.payment_preimage,
            status: payment.status,
            fee: payment.payment_route?.total_fees
          }
        });

      } catch (error) {
        logger.error('Error sending Lightning payment:', error);
        res.status(500).json({ error: 'Failed to send payment' });
      }
    });

    // Payment processing routes
    this.router.post('/payment/consultation', async (req, res) => {
      try {
        const paymentResult = await this.paymentProcessor.processConsultationPayment(req.body);
        
        res.json(paymentResult);

      } catch (error) {
        logger.error('Error processing consultation payment:', error);
        res.status(500).json({ error: 'Failed to process payment' });
      }
    });

    this.router.post('/escrow/release/:escrowId', async (req, res) => {
      try {
        const { escrowId } = req.params;
        const { reason = 'consultation_completed' } = req.body;
        
        const result = await this.paymentProcessor.releaseEscrow(escrowId, reason);
        
        res.json(result);

      } catch (error) {
        logger.error('Error releasing escrow:', error);
        res.status(500).json({ error: 'Failed to release escrow' });
      }
    });

    // Multisig escrow routes
    this.router.post('/multisig/create', async (req, res) => {
      try {
        const escrow = await this.multisigEscrow.createMultisigEscrow(req.body);
        
        res.json({
          success: true,
          escrow
        });

      } catch (error) {
        logger.error('Error creating multisig escrow:', error);
        res.status(500).json({ error: 'Failed to create multisig escrow' });
      }
    });

    this.router.post('/multisig/dispute/:consultationId', async (req, res) => {
      try {
        const { consultationId } = req.params;
        const dispute = await this.multisigEscrow.initiateDispute(consultationId, req.body);
        
        res.json(dispute);

      } catch (error) {
        logger.error('Error initiating dispute:', error);
        res.status(500).json({ error: 'Failed to initiate dispute' });
      }
    });

    // Oracle routes
    this.router.get('/oracle/prices', async (req, res) => {
      try {
        const prices = this.bitcoinOracle.getCurrentPrices();
        
        if (!prices) {
          return res.status(503).json({ error: 'Price data not available' });
        }

        res.json({
          success: true,
          prices
        });

      } catch (error) {
        logger.error('Error fetching prices:', error);
        res.status(500).json({ error: 'Failed to fetch prices' });
      }
    });

    this.router.post('/oracle/convert/eth-to-btc', async (req, res) => {
      try {
        const { ethAmount } = req.body;
        
        if (!ethAmount || ethAmount <= 0) {
          return res.status(400).json({ error: 'Valid ETH amount required' });
        }

        const conversion = await this.bitcoinOracle.convertETHToBTC(ethAmount);
        
        res.json({
          success: true,
          conversion
        });

      } catch (error) {
        logger.error('Error converting ETH to BTC:', error);
        res.status(500).json({ error: 'Failed to convert currency' });
      }
    });

    this.router.get('/oracle/history', async (req, res) => {
      try {
        const { hours = 24, interval = 'hourly' } = req.query;
        const history = await this.bitcoinOracle.getHistoricalData(parseInt(hours), interval);
        
        res.json({
          success: true,
          history
        });

      } catch (error) {
        logger.error('Error fetching price history:', error);
        res.status(500).json({ error: 'Failed to fetch price history' });
      }
    });

    // Statistics and monitoring routes
    this.router.get('/stats', async (req, res) => {
      try {
        const stats = await this.getComprehensiveStats();
        res.json({
          success: true,
          stats
        });

      } catch (error) {
        logger.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
      }
    });

    this.router.get('/health', (req, res) => {
      res.json({
        status: this.isInitialized ? 'healthy' : 'initializing',
        services: this.healthStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  async processConsultationPayment(consultationData) {
    try {
      const { consultationId, patientAddress, doctorAddress, ethAmount } = consultationData;

      const conversion = await this.bitcoinOracle.convertETHToBTC(ethAmount);
      
      const payment = await this.paymentProcessor.processConsultationPayment({
        ...consultationData,
        btcAmount: conversion.btcAmount
      });

      this.updateStatistics('payment_processed', {
        consultationId,
        amount: conversion.btcAmount,
        method: payment.payment?.method || 'escrow'
      });

      return {
        success: true,
        consultationId,
        escrowId: payment.escrowId,
        btcAmount: conversion.btcAmount,
        ethAmount,
        conversionRate: conversion.rate,
        paymentMethod: payment.payment?.method,
        expiresAt: payment.expiresAt
      };

    } catch (error) {
      logger.error('Error in consultation payment flow:', error);
      throw error;
    }
  }

  async setupDoctorBitcoinIntegration(doctorData) {
    try {
      const { doctorAddress, btcAddress, preferredPaymentMethod = 'lightning' } = doctorData;

      let walletInfo;
      if (btcAddress) {
        walletInfo = await this.walletManager.importWallet(doctorAddress, btcAddress);
      } else {
        walletInfo = await this.walletManager.createWallet(doctorAddress);
      }

      const lightningSetup = preferredPaymentMethod === 'lightning' ? 
        await this.setupDoctorLightning(doctorAddress) : null;

      const doctorBitcoinProfile = {
        doctorAddress,
        btcWallet: walletInfo,
        lightningEnabled: !!lightningSetup,
        preferredPaymentMethod,
        setupAt: new Date().toISOString(),
        totalEarnings: 0,
        paymentHistory: []
      };

      logger.info('Doctor Bitcoin integration setup:', {
        doctorAddress,
        btcAddress: walletInfo.address,
        lightning: !!lightningSetup
      });

      return {
        success: true,
        profile: doctorBitcoinProfile
      };

    } catch (error) {
      logger.error('Error setting up doctor Bitcoin integration:', error);
      throw error;
    }
  }

  async setupDoctorLightning(doctorAddress) {
    try {
      if (!this.lightningClient.isConnected) {
        throw new Error('Lightning node not available');
      }

      const nodeInfo = await this.lightningClient.getNodeInfo();
      
      return {
        enabled: true,
        nodeAlias: nodeInfo.alias,
        nodePubkey: nodeInfo.pubkey,
        setupAt: new Date().toISOString()
      };

    } catch (error) {
      logger.warn('Lightning setup failed for doctor:', error);
      return null;
    }
  }

  async processDoctorReward(rewardData) {
    try {
      const { doctorAddress, consultationId, rating, responseTime } = rewardData;

      let rewardAmount = 0;
      let rewardType = 'none';

      if (rating >= 4) {
        const baseReward = 0.00005; // 5000 sats base reward
        const ratingBonus = (rating - 4) * 0.00002; // Bonus for 5-star ratings
        const speedBonus = responseTime <= 30 ? 0.00001 : 0; // Fast response bonus
        
        rewardAmount = baseReward + ratingBonus + speedBonus;
        rewardType = 'quality_bonus';
      }

      if (rewardAmount > 0) {
        const payment = await this.paymentProcessor.addToPaymentQueue({
          type: 'consultation_reward',
          doctorAddress,
          amount: rewardAmount,
          consultationId,
          rating,
          responseTime,
          priority: 'medium'
        });

        logger.info('Doctor reward queued:', {
          doctorAddress,
          consultationId,
          reward: `${rewardAmount} BTC`,
          rating,
          responseTime: `${responseTime}min`
        });

        return {
          success: true,
          rewardAmount,
          rewardType,
          paymentId: payment
        };
      }

      return {
        success: true,
        rewardAmount: 0,
        rewardType: 'none',
        message: 'No reward earned (rating < 4 stars)'
      };

    } catch (error) {
      logger.error('Error processing doctor reward:', error);
      throw error;
    }
  }

  async handleConsultationComplete(consultationData) {
    try {
      const { 
        consultationId, 
        doctorAddress, 
        patientRating, 
        responseTime,
        diagnosisConfidence 
      } = consultationData;

      const escrowId = await this.findEscrowByConsultation(consultationId);
      if (escrowId) {
        await this.paymentProcessor.releaseEscrow(escrowId, 'consultation_completed');
      }

      if (patientRating) {
        await this.processDoctorReward({
          doctorAddress,
          consultationId,
          rating: patientRating,
          responseTime: responseTime || 0
        });
      }

      const nftMetadata = await this.generateDiagnosticNFTMetadata({
        consultationId,
        doctorAddress,
        confidence: diagnosisConfidence,
        completedAt: new Date().toISOString()
      });

      this.emit('consultation_completed', {
        consultationId,
        escrowReleased: !!escrowId,
        rewardProcessed: !!patientRating,
        nftMetadata
      });

      return {
        success: true,
        consultationId,
        escrowReleased: !!escrowId,
        nftMetadata
      };

    } catch (error) {
      logger.error('Error handling consultation completion:', error);
      throw error;
    }
  }

  async distributeDailyRewards(eligibleDoctors) {
    try {
      const dailyRewardPool = 0.001; // 0.001 BTC daily pool
      const rewardPerDoctor = dailyRewardPool / eligibleDoctors.length;

      const distributionPromises = eligibleDoctors.map(async (doctor) => {
        try {
          const adjustedReward = this.calculateDoctorReward(doctor, rewardPerDoctor);
          
          return await this.paymentProcessor.addToPaymentQueue({
            type: 'daily_reward',
            doctorAddress: doctor.address,
            amount: adjustedReward,
            reputationScore: doctor.reputationScore,
            consultationCount: doctor.consultationCount,
            priority: 'low'
          });

        } catch (error) {
          logger.error(`Failed to queue reward for ${doctor.address}:`, error);
          return null;
        }
      });

      const results = await Promise.allSettled(distributionPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

      logger.info('Daily rewards distributed:', {
        totalEligible: eligibleDoctors.length,
        successful,
        failed: eligibleDoctors.length - successful,
        totalAmount: `${dailyRewardPool} BTC`
      });

      return {
        success: true,
        distributed: successful,
        failed: eligibleDoctors.length - successful,
        totalAmount: dailyRewardPool
      };

    } catch (error) {
      logger.error('Error distributing daily rewards:', error);
      throw error;
    }
  }

  calculateDoctorReward(doctor, baseReward) {
    const reputationMultiplier = Math.min(2.0, doctor.reputationScore / 4000); // Max 2x for 5-star rating
    const volumeBonus = Math.min(0.5, doctor.consultationCount / 100 * 0.1); // Volume bonus
    
    return baseReward * (reputationMultiplier + volumeBonus);
  }

  async generateDiagnosticNFTMetadata(consultationData) {
    try {
      const { consultationId, doctorAddress, confidence, completedAt } = consultationData;
      
      const btcPrices = this.bitcoinOracle.getCurrentPrices();
      
      const metadata = {
        name: `DiagnoChain Diagnostic #${consultationId}`,
        description: 'Blockchain-verified medical diagnosis',
        image: await this.generateDiagnosticImage(consultationData),
        attributes: [
          {
            trait_type: 'Consultation ID',
            value: consultationId
          },
          {
            trait_type: 'Doctor',
            value: doctorAddress.substring(0, 10) + '...'
          },
          {
            trait_type: 'Confidence Level',
            value: confidence,
            max_value: 10
          },
          {
            trait_type: 'Completion Date',
            value: completedAt
          },
          {
            trait_type: 'BTC Price at Diagnosis',
            value: btcPrices?.btcPrice || 'Unknown',
            display_type: 'number'
          },
          {
            trait_type: 'Verification Method',
            value: 'Blockchain Smart Contract'
          }
        ],
        external_url: `https://diagnochain.com/nft/${consultationId}`,
        properties: {
          consultation_id: consultationId,
          doctor_address: doctorAddress,
          blockchain: 'Ethereum',
          standard: 'ERC-721'
        }
      };

      return metadata;

    } catch (error) {
      logger.error('Error generating NFT metadata:', error);
      throw error;
    }
  }

  async generateDiagnosticImage(consultationData) {
    const imageUrl = `data:image/svg+xml;base64,${Buffer.from(`
      <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#7C3AED;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="400" height="400" fill="url(#grad1)"/>
        <circle cx="200" cy="150" r="60" fill="white" opacity="0.9"/>
        <text x="200" y="160" text-anchor="middle" fill="#4F46E5" font-size="24" font-weight="bold">⚕️</text>
        <text x="200" y="250" text-anchor="middle" fill="white" font-size="18" font-weight="bold">DiagnoChain</text>
        <text x="200" y="280" text-anchor="middle" fill="white" font-size="14">Consultation #${consultationData.consultationId}</text>
        <text x="200" y="320" text-anchor="middle" fill="white" font-size="12">Verified Medical Diagnosis</text>
        <text x="200" y="350" text-anchor="middle" fill="white" font-size="10">${new Date().toLocaleDateString()}</text>
      </svg>
    `).toString('base64')}`;

    return imageUrl;
  }

  async performHealthChecks() {
    try {
      // Check Lightning Network
      try {
        if (this.lightningClient.isConnected) {
          const nodeInfo = await this.lightningClient.getNodeInfo();
          this.healthStatus.lightning = nodeInfo.synced;
        }
      } catch (error) {
        this.healthStatus.lightning = false;
      }

      // Check Oracle
      try {
        const prices = this.bitcoinOracle.getCurrentPrices();
        this.healthStatus.oracle = !!prices;
      } catch (error) {
        this.healthStatus.oracle = false;
      }

      // Check Payment Processor
      try {
        const processorStats = await this.paymentProcessor.getProcessorStats();
        this.healthStatus.payments = processorStats.lightningStatus.connected;
      } catch (error) {
        this.healthStatus.payments = false;
      }

      // Check Wallet Manager
      try {
        const walletStats = await this.walletManager.getWalletStats();
        this.healthStatus.wallets = walletStats.totalWallets >= 0;
      } catch (error) {
        this.healthStatus.wallets = false;
      }

      // Check Multisig Escrow
      try {
        const escrowStats = await this.multisigEscrow.getEscrowStats();
        this.healthStatus.multisig = escrowStats.arbitrators > 0;
      } catch (error) {
        this.healthStatus.multisig = false;
      }

      logger.info('Health checks completed:', this.healthStatus);

    } catch (error) {
      logger.error('Error performing health checks:', error);
    }
  }

  async testOracleConnection() {
    try {
      const prices = this.bitcoinOracle.getCurrentPrices();
      return !!prices && prices.btcPrice > 0;
    } catch (error) {
      return false;
    }
  }

  startMonitoring() {
    setInterval(async () => {
      try {
        await this.performHealthChecks();
        await this.updateStatistics('health_check');
      } catch (error) {
        logger.error('Monitoring error:', error);
      }
    }, 30000); // Every 30 seconds

    logger.info('Bitcoin API monitoring started');
  }

  async getComprehensiveStats() {
    try {
      const [
        walletStats,
        processorStats,
        escrowStats,
        oracleStatus,
        lightningStatus
      ] = await Promise.all([
        this.walletManager.getWalletStats(),
        this.paymentProcessor.getProcessorStats(),
        this.multisigEscrow.getEscrowStats(),
        this.bitcoinOracle.getOracleStatus(),
        this.lightningClient.getStatus()
      ]);

      return {
        overview: this.statistics,
        health: this.healthStatus,
        wallets: walletStats,
        payments: processorStats,
        escrows: escrowStats,
        oracle: oracleStatus,
        lightning: lightningStatus,
        network: process.env.BTC_NETWORK || 'testnet',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error compiling comprehensive stats:', error);
      return {
        error: 'Failed to compile statistics',
        health: this.healthStatus,
        timestamp: new Date().toISOString()
      };
    }
  }

  updateStatistics(eventType, data = {}) {
    this.statistics.lastActivity = new Date().toISOString();
    
    switch (eventType) {
      case 'payment_processed':
        this.statistics.totalTransactions++;
        this.statistics.totalVolume += data.amount || 0;
        break;
        
      case 'escrow_created':
        this.statistics.activeEscrows++;
        break;
        
      case 'escrow_released':
        this.statistics.activeEscrows = Math.max(0, this.statistics.activeEscrows - 1);
        break;
    }

    if (this.statistics.totalTransactions > 0) {
      // Calculate success rate based on completed vs failed transactions
      const successfulTransactions = this.statistics.totalTransactions; // Simplified
      this.statistics.successRate = (successfulTransactions / this.statistics.totalTransactions) * 100;
    }
  }

  async findEscrowByConsultation(consultationId) {
    for (const [escrowId, escrow] of this.paymentProcessor.escrowStorage) {
      if (escrow.consultationId === parseInt(consultationId)) {
        return escrowId;
      }
    }
    
    for (const [escrowId, escrow] of this.multisigEscrow.escrowStorage) {
      if (escrow.consultationId === parseInt(consultationId)) {
        return escrowId;
      }
    }
    
    return null;
  }

  async emergencyStop(reason = 'Emergency maintenance') {
    try {
      logger.warn('Emergency stop initiated:', { reason });

      // Stop accepting new payments
      this.healthStatus = {
        lightning: false,
        wallets: false,
        payments: false,
        oracle: false,
        multisig: false
      };

      // Disconnect services gracefully
      this.lightningClient.disconnect();
      this.paymentProcessor.cleanup();
      this.multisigEscrow.cleanup();

      this.emit('emergency_stop', {
        reason,
        timestamp: new Date().toISOString()
      });

      logger.info('Emergency stop completed');

    } catch (error) {
      logger.error('Error during emergency stop:', error);
    }
  }

  async restart() {
    try {
      logger.info('Restarting Bitcoin API services...');
      
      await this.init();
      
      this.emit('restarted', {
        timestamp: new Date().toISOString(),
        health: this.healthStatus
      });

      logger.info('Bitcoin API restart completed');

    } catch (error) {
      logger.error('Error during restart:', error);
      throw error;
    }
  }

  getRouter() {
    return this.router;
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      health: this.healthStatus,
      statistics: this.statistics,
      uptime: process.uptime(),
      lastActivity: this.statistics.lastActivity
    };
  }

  async cleanup() {
    try {
      this.lightningClient.disconnect();
      this.paymentProcessor.cleanup();
      this.multisigEscrow.cleanup();
      this.walletManager.cleanup();
      
      this.removeAllListeners();
      
      logger.info('Bitcoin API cleanup completed');

    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}

module.exports = new BitcoinAPI();