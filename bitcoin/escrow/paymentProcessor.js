const EventEmitter = require('events');
const crypto = require('crypto');

const LightningClient = require('../lightning/lightningClient');
const WalletManager = require('../wallet/walletManager');
const logger = require('../../backend/src/utils/logger');

class PaymentProcessor extends EventEmitter {
  constructor() {
    super();
    this.lightningClient = new LightningClient();
    this.walletManager = WalletManager;
    
    this.paymentQueue = [];
    this.processingQueue = false;
    this.escrowStorage = new Map(); // In production: Redis/Database
    this.paymentHistory = new Map();
    
    this.platformFeePercent = 300; // 3% in basis points
    this.minimumPayment = 0.00001; // 0.00001 BTC minimum
    this.maxRetryAttempts = 3;
    
    this.setupEventListeners();
    this.startQueueProcessor();
  }

  setupEventListeners() {
    this.lightningClient.on('invoice_settled', (invoice) => {
      this.handleInvoiceSettlement(invoice);
    });

    this.lightningClient.on('payment_succeeded', (payment) => {
      this.handlePaymentSuccess(payment);
    });

    this.lightningClient.on('payment_failed', (payment) => {
      this.handlePaymentFailure(payment);
    });
  }

  async processConsultationPayment(consultationData) {
    try {
      const { 
        consultationId, 
        patientAddress, 
        doctorAddress, 
        ethAmount, 
        btcAmount, 
        isUrgent 
      } = consultationData;

      const escrowId = this.generateEscrowId(consultationId);
      
      const escrow = {
        escrowId,
        consultationId,
        patientAddress,
        doctorAddress,
        ethAmount: parseFloat(ethAmount),
        btcAmount: parseFloat(btcAmount),
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (isUrgent ? 2 : 24) * 60 * 60 * 1000).toISOString(),
        paymentMethod: 'lightning_preferred',
        retryCount: 0
      };

      this.escrowStorage.set(escrowId, escrow);

      const payment = await this.executePayment(escrow);

      logger.info('Consultation payment processed:', {
        consultationId,
        escrowId,
        amount: `${btcAmount} BTC`,
        method: payment.method
      });

      return {
        success: true,
        escrowId,
        payment,
        expiresAt: escrow.expiresAt
      };

    } catch (error) {
      logger.error('Error processing consultation payment:', error);
      throw error;
    }
  }

  async executePayment(escrow) {
    try {
      if (escrow.btcAmount < this.minimumPayment) {
        throw new Error(`Payment amount below minimum: ${this.minimumPayment} BTC`);
      }

      const platformFee = escrow.btcAmount * (this.platformFeePercent / 10000);
      const doctorAmount = escrow.btcAmount - platformFee;

      try {
        const lightningPayment = await this.tryLightningPayment(escrow.doctorAddress, doctorAmount);
        
        if (lightningPayment.success) {
          escrow.status = 'completed';
          escrow.completedAt = new Date().toISOString();
          escrow.paymentMethod = 'lightning';
          escrow.paymentHash = lightningPayment.paymentHash;
          escrow.fee = lightningPayment.fee;

          await this.processPlatformFee(platformFee);

          this.escrowStorage.set(escrow.escrowId, escrow);

          return {
            method: 'lightning',
            success: true,
            paymentHash: lightningPayment.paymentHash,
            amount: doctorAmount,
            fee: lightningPayment.fee,
            completedAt: escrow.completedAt
          };
        }
      } catch (lightningError) {
        logger.warn('Lightning payment failed, falling back to on-chain:', lightningError);
      }

      const onChainPayment = await this.tryOnChainPayment(escrow.doctorAddress, doctorAmount);
      
      if (onChainPayment.success) {
        escrow.status = 'completed';
        escrow.completedAt = new Date().toISOString();
        escrow.paymentMethod = 'onchain';
        escrow.txid = onChainPayment.txid;
        escrow.fee = onChainPayment.fee;

        await this.processPlatformFee(platformFee);

        this.escrowStorage.set(escrow.escrowId, escrow);

        return {
          method: 'onchain',
          success: true,
          txid: onChainPayment.txid,
          amount: doctorAmount,
          fee: onChainPayment.fee,
          completedAt: escrow.completedAt
        };
      }

      throw new Error('All payment methods failed');

    } catch (error) {
      escrow.status = 'failed';
      escrow.failedAt = new Date().toISOString();
      escrow.error = error.message;
      this.escrowStorage.set(escrow.escrowId, escrow);
      
      throw error;
    }
  }

  async tryLightningPayment(recipientAddress, amount) {
    try {
      if (!this.lightningClient.isConnected) {
        throw new Error('Lightning node not connected');
      }

      const channelBalance = await this.lightningClient.getChannelBalance();
      const availableBalance = parseInt(channelBalance.balance) / 100000000;

      if (availableBalance < amount) {
        throw new Error('Insufficient Lightning channel balance');
      }

      const invoice = await this.createRecipientInvoice(recipientAddress, amount);
      const payment = await this.lightningClient.payInvoice(invoice.payment_request, 30);

      return {
        success: true,
        paymentHash: payment.payment_hash,
        preimage: payment.payment_preimage,
        fee: payment.payment_route?.total_fees ? 
             parseInt(payment.payment_route.total_fees) / 100000000 : 0.000001,
        route: payment.payment_route
      };

    } catch (error) {
      logger.warn('Lightning payment attempt failed:', error);
      return { success: false, error: error.message };
    }
  }

  async tryOnChainPayment(recipientAddress, amount) {
    try {
      const platformWallet = await this.walletManager.getWallet(process.env.PLATFORM_WALLET_ADDRESS);
      if (!platformWallet || !platformWallet.canSpend) {
        throw new Error('Platform wallet not available for on-chain payments');
      }

      const recipients = [{ address: recipientAddress, amount }];
      const result = await this.walletManager.sendBitcoin(
        process.env.PLATFORM_WALLET_ADDRESS,
        recipients,
        null,
        'DiagnoChain consultation payment'
      );

      return {
        success: result.success,
        txid: result.txid,
        fee: result.fee,
        explorerUrl: result.explorerUrl
      };

    } catch (error) {
      logger.warn('On-chain payment attempt failed:', error);
      return { success: false, error: error.message };
    }
  }

  async createRecipientInvoice(recipientAddress, amount) {
    if (process.env.BTC_NETWORK === 'testnet') {
      return {
        payment_request: `lntb${Math.floor(amount * 100000000)}u1p${crypto.randomBytes(20).toString('hex')}`,
        r_hash: crypto.randomBytes(32).toString('hex')
      };
    }

    return await this.lightningClient.createInvoice(amount, `DiagnoChain payment to ${recipientAddress}`);
  }

  async processPlatformFee(feeAmount) {
    try {
      if (feeAmount <= 0) return;

      const treasuryAddress = process.env.TREASURY_BTC_ADDRESS;
      if (!treasuryAddress) {
        logger.warn('Treasury address not configured, fee not collected');
        return;
      }

      await this.addToPaymentQueue({
        type: 'platform_fee',
        recipient: treasuryAddress,
        amount: feeAmount,
        priority: 'low',
        retryCount: 0
      });

      logger.info('Platform fee queued:', { amount: feeAmount, recipient: treasuryAddress });

    } catch (error) {
      logger.error('Error processing platform fee:', error);
    }
  }

  async addToPaymentQueue(paymentData) {
    const queueItem = {
      id: crypto.randomBytes(16).toString('hex'),
      ...paymentData,
      addedAt: new Date().toISOString(),
      status: 'queued'
    };

    this.paymentQueue.push(queueItem);
    
    if (!this.processingQueue) {
      this.processPaymentQueue();
    }

    return queueItem.id;
  }

  async processPaymentQueue() {
    if (this.processingQueue || this.paymentQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    try {
      while (this.paymentQueue.length > 0) {
        const payment = this.paymentQueue.shift();
        
        try {
          payment.status = 'processing';
          payment.processedAt = new Date().toISOString();

          if (payment.type === 'consultation_payment') {
            await this.executeConsultationPayment(payment);
          } else if (payment.type === 'platform_fee') {
            await this.executePlatformFeePayment(payment);
          } else if (payment.type === 'daily_reward') {
            await this.executeDailyReward(payment);
          }

          payment.status = 'completed';
          payment.completedAt = new Date().toISOString();

          this.paymentHistory.set(payment.id, payment);

        } catch (error) {
          logger.error('Payment processing failed:', { paymentId: payment.id, error: error.message });
          
          payment.retryCount = (payment.retryCount || 0) + 1;
          
          if (payment.retryCount < this.maxRetryAttempts) {
            payment.status = 'retrying';
            payment.nextRetryAt = new Date(Date.now() + payment.retryCount * 60000).toISOString();
            
            setTimeout(() => {
              this.paymentQueue.unshift(payment);
            }, payment.retryCount * 60000);
          } else {
            payment.status = 'failed';
            payment.failedAt = new Date().toISOString();
            payment.error = error.message;
            
            this.paymentHistory.set(payment.id, payment);
            this.emit('payment_failed', payment);
          }
        }

        await this.delay(1000); // Brief delay between payments
      }
    } finally {
      this.processingQueue = false;
    }
  }

  async executeConsultationPayment(payment) {
    const recipients = [{ address: payment.recipient, amount: payment.amount }];
    return await this.walletManager.sendBitcoin(
      process.env.PLATFORM_WALLET_ADDRESS,
      recipients,
      null,
      `Consultation payment: ${payment.consultationId}`
    );
  }

  async executePlatformFeePayment(payment) {
    const recipients = [{ address: payment.recipient, amount: payment.amount }];
    return await this.walletManager.sendBitcoin(
      process.env.PLATFORM_WALLET_ADDRESS,
      recipients,
      null,
      'Platform fee collection'
    );
  }

  async executeDailyReward(payment) {
    try {
      const lightningPayment = await this.tryLightningPayment(payment.recipient, payment.amount);
      
      if (!lightningPayment.success) {
        const onChainPayment = await this.tryOnChainPayment(payment.recipient, payment.amount);
        if (!onChainPayment.success) {
          throw new Error('All payment methods failed for daily reward');
        }
      }

    } catch (error) {
      throw new Error(`Daily reward payment failed: ${error.message}`);
    }
  }

  async distributeRewards(doctorRewards) {
    try {
      const batchId = crypto.randomBytes(16).toString('hex');
      
      for (const reward of doctorRewards) {
        await this.addToPaymentQueue({
          type: 'daily_reward',
          recipient: reward.btcAddress,
          amount: reward.amount,
          doctorAddress: reward.doctorAddress,
          reputationScore: reward.reputationScore,
          batchId,
          priority: 'medium',
          retryCount: 0
        });
      }

      logger.info('Reward distribution batch queued:', {
        batchId,
        rewardCount: doctorRewards.length,
        totalAmount: doctorRewards.reduce((sum, r) => sum + r.amount, 0)
      });

      return { success: true, batchId, queuedRewards: doctorRewards.length };

    } catch (error) {
      logger.error('Error distributing rewards:', error);
      throw error;
    }
  }

  async releaseEscrow(escrowId, releaseReason = 'consultation_completed') {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      if (escrow.status !== 'pending') {
        throw new Error(`Escrow already ${escrow.status}`);
      }

      escrow.status = 'releasing';
      escrow.releaseReason = releaseReason;
      escrow.releaseStartedAt = new Date().toISOString();

      const payment = await this.executePayment(escrow);
      
      escrow.status = 'released';
      escrow.releasedAt = new Date().toISOString();
      escrow.paymentDetails = payment;

      this.escrowStorage.set(escrowId, escrow);

      this.emit('escrow_released', {
        escrowId,
        consultationId: escrow.consultationId,
        doctorAddress: escrow.doctorAddress,
        amount: escrow.btcAmount,
        payment
      });

      logger.info('Escrow released:', {
        escrowId,
        consultationId: escrow.consultationId,
        amount: `${escrow.btcAmount} BTC`,
        method: payment.method
      });

      return { success: true, escrow, payment };

    } catch (error) {
      logger.error('Error releasing escrow:', error);
      
      const escrow = this.escrowStorage.get(escrowId);
      if (escrow) {
        escrow.status = 'release_failed';
        escrow.releaseError = error.message;
        escrow.failedAt = new Date().toISOString();
        this.escrowStorage.set(escrowId, escrow);
      }

      throw error;
    }
  }

  async refundEscrow(escrowId, refundReason = 'consultation_cancelled', refundPercent = 100) {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      if (!['pending', 'disputed'].includes(escrow.status)) {
        throw new Error(`Cannot refund escrow with status: ${escrow.status}`);
      }

      const refundAmount = (escrow.btcAmount * refundPercent) / 100;
      const platformFee = escrow.btcAmount - refundAmount;

      escrow.status = 'refunding';
      escrow.refundReason = refundReason;
      escrow.refundPercent = refundPercent;
      escrow.refundStartedAt = new Date().toISOString();

      const refundPayment = await this.executeRefund(escrow.patientAddress, refundAmount);

      if (platformFee > 0) {
        await this.processPlatformFee(platformFee);
      }

      escrow.status = 'refunded';
      escrow.refundedAt = new Date().toISOString();
      escrow.refundDetails = refundPayment;

      this.escrowStorage.set(escrowId, escrow);

      this.emit('escrow_refunded', {
        escrowId,
        consultationId: escrow.consultationId,
        patientAddress: escrow.patientAddress,
        refundAmount,
        refundPercent
      });

      logger.info('Escrow refunded:', {
        escrowId,
        consultationId: escrow.consultationId,
        refundAmount: `${refundAmount} BTC`,
        refundPercent: `${refundPercent}%`
      });

      return { success: true, escrow, refundPayment };

    } catch (error) {
      logger.error('Error refunding escrow:', error);
      throw error;
    }
  }

  async executeRefund(patientAddress, amount) {
    try {
      const patientWallet = await this.walletManager.getWallet(patientAddress);
      if (!patientWallet) {
        throw new Error('Patient wallet not found for refund');
      }

      const recipients = [{ address: patientWallet.address, amount }];
      
      return await this.walletManager.sendBitcoin(
        process.env.PLATFORM_WALLET_ADDRESS,
        recipients,
        null,
        'DiagnoChain consultation refund'
      );

    } catch (error) {
      logger.error('Error executing refund:', error);
      throw error;
    }
  }

  async handleDisputeResolution(escrowId, resolution) {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      if (escrow.status !== 'disputed') {
        throw new Error('Escrow not in disputed status');
      }

      const { 
        favorPatient, 
        refundPercent = 0, 
        doctorPercent = 0, 
        arbitratorDecision 
      } = resolution;

      escrow.status = 'resolving';
      escrow.disputeResolution = {
        favorPatient,
        refundPercent,
        doctorPercent,
        arbitratorDecision,
        resolvedAt: new Date().toISOString()
      };

      const promises = [];

      if (refundPercent > 0) {
        const refundAmount = (escrow.btcAmount * refundPercent) / 100;
        promises.push(this.executeRefund(escrow.patientAddress, refundAmount));
      }

      if (doctorPercent > 0) {
        const doctorAmount = (escrow.btcAmount * doctorPercent) / 100;
        promises.push(this.executePayment({
          ...escrow,
          btcAmount: doctorAmount,
          doctorAddress: escrow.doctorAddress
        }));
      }

      await Promise.all(promises);

      escrow.status = 'resolved';
      escrow.resolvedAt = new Date().toISOString();
      
      this.escrowStorage.set(escrowId, escrow);

      this.emit('dispute_resolved', {
        escrowId,
        consultationId: escrow.consultationId,
        resolution: escrow.disputeResolution
      });

      logger.info('Dispute resolved:', {
        escrowId,
        favorPatient,
        refundPercent,
        doctorPercent
      });

      return { success: true, escrow };

    } catch (error) {
      logger.error('Error resolving dispute:', error);
      throw error;
    }
  }

  startQueueProcessor() {
    setInterval(() => {
      if (!this.processingQueue && this.paymentQueue.length > 0) {
        this.processPaymentQueue();
      }
    }, 5000); // Check every 5 seconds
  }

  async getEscrowStatus(escrowId) {
    const escrow = this.escrowStorage.get(escrowId);
    if (!escrow) {
      return null;
    }

    if (escrow.status === 'pending' && new Date() > new Date(escrow.expiresAt)) {
      escrow.status = 'expired';
      escrow.expiredAt = new Date().toISOString();
      this.escrowStorage.set(escrowId, escrow);
    }

    return escrow;
  }

  async getPaymentStatus(paymentId) {
    return this.paymentHistory.get(paymentId) || { status: 'not_found' };
  }

  async handleInvoiceSettlement(invoice) {
    const escrowEntries = Array.from(this.escrowStorage.entries());
    const relevantEscrow = escrowEntries.find(([_, escrow]) => 
      escrow.paymentHash === invoice.payment_hash
    );

    if (relevantEscrow) {
      const [escrowId, escrow] = relevantEscrow;
      this.emit('consultation_payment_confirmed', {
        escrowId,
        consultationId: escrow.consultationId,
        settledAt: new Date().toISOString()
      });
    }
  }

  async handlePaymentSuccess(payment) {
    logger.info('Payment succeeded:', {
      hash: payment.payment_hash?.substring(0, 16) + '...',
      amount: payment.payment_route?.total_amt
    });
  }

  async handlePaymentFailure(payment) {
    logger.warn('Payment failed:', {
      hash: payment.payment_hash?.substring(0, 16) + '...',
      error: payment.payment_error
    });
  }

  generateEscrowId(consultationId) {
    return `escrow_${consultationId}_${crypto.randomBytes(8).toString('hex')}`;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getProcessorStats() {
    const stats = {
      escrowCount: this.escrowStorage.size,
      queueLength: this.paymentQueue.length,
      processingQueue: this.processingQueue,
      paymentHistory: this.paymentHistory.size,
      lightningStatus: this.lightningClient.getStatus(),
      lastActivity: new Date().toISOString()
    };

    let totalEscrowed = 0;
    let completedPayments = 0;

    for (const [_, escrow] of this.escrowStorage) {
      totalEscrowed += escrow.btcAmount || 0;
      if (escrow.status === 'completed') {
        completedPayments++;
      }
    }

    stats.totalEscrowed = totalEscrowed;
    stats.completedPayments = completedPayments;
    stats.successRate = this.escrowStorage.size > 0 ? (completedPayments / this.escrowStorage.size) * 100 : 0;

    return stats;
  }

  cleanup() {
    this.lightningClient.disconnect();
    this.paymentQueue.length = 0;
    this.escrowStorage.clear();
    this.paymentHistory.clear();
    logger.info('Payment processor cleaned up');
  }
}

module.exports = new PaymentProcessor();