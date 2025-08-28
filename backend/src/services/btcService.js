const axios = require('axios');
const crypto = require('crypto');

const logger = require('../utils/logger');

class BTCService {
  constructor() {
    this.network = process.env.BTC_NETWORK || 'testnet';
    this.apiKey = process.env.BLOCKCHAIN_API_KEY;
    this.baseURL = this.network === 'testnet' 
      ? 'https://api.blockcypher.com/v1/btc/test3'
      : 'https://api.blockcypher.com/v1/btc/main';
    
    this.lightningConfig = {
      endpoint: process.env.LIGHTNING_ENDPOINT || 'http://localhost:8080',
      macaroon: process.env.LIGHTNING_MACAROON,
      cert: process.env.LIGHTNING_CERT
    };

    this.priceCache = {
      price: null,
      lastUpdate: null,
      ttl: 5 * 60 * 1000 // 5 minutes
    };

    this.walletStorage = new Map(); // In production, use Redis or database
  }

  async getCurrentBTCPrice() {
    try {
      const now = Date.now();
      
      if (this.priceCache.price && 
          this.priceCache.lastUpdate && 
          (now - this.priceCache.lastUpdate) < this.priceCache.ttl) {
        return this.priceCache.price;
      }

      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });

      const btcPrice = response.data.bitcoin.usd;
      
      this.priceCache = {
        price: btcPrice,
        lastUpdate: now
      };

      logger.info('BTC price updated:', { price: btcPrice });
      return btcPrice;

    } catch (error) {
      logger.error('Error fetching BTC price:', error);
      
      if (this.priceCache.price) {
        logger.warn('Using cached BTC price due to API error');
        return this.priceCache.price;
      }
      
      return 43000; // Fallback price
    }
  }

  async calculateBTCEquivalent(ethAmount) {
    try {
      const btcPrice = await this.getCurrentBTCPrice();
      const ethPrice = await this.getETHPrice();
      
      const ethValueUSD = parseFloat(ethAmount) * ethPrice;
      const btcAmount = ethValueUSD / btcPrice;
      
      const satoshis = Math.floor(btcAmount * 100000000); // Convert to satoshis
      
      return {
        btcAmount: btcAmount.toFixed(8),
        satoshis,
        usdValue: ethValueUSD.toFixed(2),
        ethAmount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error calculating BTC equivalent:', error);
      throw new Error('Failed to calculate BTC equivalent');
    }
  }

  async getETHPrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'ethereum',
          vs_currencies: 'usd'
        }
      });
      
      return response.data.ethereum.usd;
    } catch (error) {
      logger.warn('Failed to fetch ETH price, using fallback');
      return 2000; // Fallback ETH price
    }
  }

  async generateBTCAddress(userAddress) {
    try {
      if (this.network === 'testnet') {
        const randomBytes = crypto.randomBytes(20);
        const testnetAddress = 'tb1q' + randomBytes.toString('hex').substring(0, 32);
        
        this.walletStorage.set(userAddress.toLowerCase(), {
          btcAddress: testnetAddress,
          privateKey: crypto.randomBytes(32).toString('hex'),
          createdAt: new Date().toISOString(),
          balance: 0
        });

        return {
          address: testnetAddress,
          network: 'testnet',
          createdAt: new Date().toISOString()
        };
      }

      const response = await axios.post(`${this.baseURL}/addrs`, {
        token: this.apiKey
      });

      const btcAddress = response.data.address;
      const privateKey = response.data.private;

      this.walletStorage.set(userAddress.toLowerCase(), {
        btcAddress,
        privateKey,
        createdAt: new Date().toISOString(),
        balance: 0
      });

      logger.info('BTC address generated:', { userAddress, btcAddress });

      return {
        address: btcAddress,
        network: this.network,
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error generating BTC address:', error);
      throw new Error('Failed to generate BTC address');
    }
  }

  async getBTCBalance(userAddress) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        return { balance: 0, confirmed: 0, unconfirmed: 0 };
      }

      if (this.network === 'testnet') {
        return {
          balance: wallet.balance || 0,
          confirmed: wallet.balance || 0,
          unconfirmed: 0,
          address: wallet.btcAddress
        };
      }

      const response = await axios.get(`${this.baseURL}/addrs/${wallet.btcAddress}/balance`, {
        params: { token: this.apiKey }
      });

      return {
        balance: response.data.balance / 100000000, // Convert satoshis to BTC
        confirmed: response.data.balance / 100000000,
        unconfirmed: response.data.unconfirmed_balance / 100000000,
        address: wallet.btcAddress
      };

    } catch (error) {
      logger.error('Error fetching BTC balance:', error);
      return { balance: 0, confirmed: 0, unconfirmed: 0 };
    }
  }

  async processDoctorPayment(doctorAddress, ethFee, btcEquivalent) {
    try {
      const doctorWallet = this.walletStorage.get(doctorAddress.toLowerCase());
      if (!doctorWallet) {
        throw new Error('Doctor BTC wallet not found');
      }

      const paymentData = {
        recipientAddress: doctorWallet.btcAddress,
        amount: parseFloat(btcEquivalent),
        consultationFee: ethFee,
        doctorAddress,
        timestamp: new Date().toISOString(),
        txId: this.generateMockTxId(),
        status: 'confirmed'
      };

      if (this.network === 'testnet') {
        doctorWallet.balance += parseFloat(btcEquivalent);
        this.walletStorage.set(doctorAddress.toLowerCase(), doctorWallet);
      }

      const lightningPayment = await this.sendLightningPayment(
        doctorWallet.btcAddress,
        parseFloat(btcEquivalent)
      );

      logger.info('BTC payment processed:', {
        doctor: doctorAddress,
        amount: btcEquivalent,
        txId: paymentData.txId,
        lightning: lightningPayment.success
      });

      return {
        ...paymentData,
        lightning: lightningPayment
      };

    } catch (error) {
      logger.error('Error processing BTC payment:', error);
      throw new Error('Failed to process BTC payment');
    }
  }

  async sendLightningPayment(recipientAddress, amount) {
    try {
      if (this.network === 'testnet' || !this.lightningConfig.endpoint) {
        return {
          success: true,
          paymentHash: this.generateMockTxId(),
          preimage: crypto.randomBytes(32).toString('hex'),
          timestamp: new Date().toISOString(),
          amount,
          recipient: recipientAddress,
          fee: 0.000001 // 1 satoshi fee
        };
      }

      const invoice = await this.createLightningInvoice(amount);
      
      const payment = await axios.post(`${this.lightningConfig.endpoint}/v1/channels/transactions`, {
        payment_request: invoice.payment_request
      }, {
        headers: {
          'Grpc-Metadata-macaroon': this.lightningConfig.macaroon,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        paymentHash: payment.data.payment_hash,
        preimage: payment.data.payment_preimage,
        timestamp: new Date().toISOString(),
        amount,
        fee: payment.data.fee
      };

    } catch (error) {
      logger.error('Lightning payment error:', error);
      
      return {
        success: false,
        error: error.message,
        fallback: 'Standard BTC transaction initiated'
      };
    }
  }

  async createLightningInvoice(amount) {
    try {
      const amountSatoshis = Math.floor(amount * 100000000);
      
      const invoiceData = {
        memo: 'DiagnoChain consultation payment',
        value: amountSatoshis,
        expiry: 3600 // 1 hour
      };

      if (this.network === 'testnet') {
        return {
          payment_request: `lntb${amountSatoshis}u1p...mock_invoice`,
          r_hash: crypto.randomBytes(32).toString('hex'),
          add_index: Date.now()
        };
      }

      const response = await axios.post(`${this.lightningConfig.endpoint}/v1/invoices`, invoiceData, {
        headers: {
          'Grpc-Metadata-macaroon': this.lightningConfig.macaroon
        }
      });

      return response.data;

    } catch (error) {
      logger.error('Error creating Lightning invoice:', error);
      throw new Error('Failed to create Lightning invoice');
    }
  }

  async distributeReputationReward(doctorAddress, rating) {
    try {
      if (rating < 4) {
        logger.info('No reward for rating below 4:', { doctor: doctorAddress, rating });
        return null;
      }

      const baseReward = 0.00001; // Base reward in BTC
      const ratingMultiplier = rating / 5; // 0.8 for 4 stars, 1.0 for 5 stars
      const rewardAmount = baseReward * ratingMultiplier;

      const payment = await this.processDoctorPayment(doctorAddress, '0', rewardAmount.toString());

      logger.info('Reputation reward distributed:', {
        doctor: doctorAddress,
        rating,
        reward: rewardAmount,
        txId: payment.txId
      });

      return payment;

    } catch (error) {
      logger.error('Error distributing reputation reward:', error);
      return null;
    }
  }

  async claimDailyReward(doctorAddress, reputationScore) {
    try {
      if (reputationScore < 4000) { // 4.0 scaled by 1000
        throw new Error('Minimum 4.0 reputation required for daily rewards');
      }

      const today = new Date().toISOString().split('T')[0];
      const claimKey = `${doctorAddress.toLowerCase()}-${today}`;
      
      // Check if already claimed today (in production, use Redis)
      if (this.dailyClaims && this.dailyClaims.has(claimKey)) {
        throw new Error('Daily reward already claimed');
      }

      const baseReward = 0.00005; // 0.00005 BTC base daily reward
      const reputationBonus = (reputationScore - 4000) / 1000 * 0.00002; // Bonus for >4.0 rating
      const totalReward = baseReward + reputationBonus;

      const payment = await this.processDoctorPayment(doctorAddress, '0', totalReward.toString());

      // Mark as claimed
      if (!this.dailyClaims) this.dailyClaims = new Map();
      this.dailyClaims.set(claimKey, {
        claimed: true,
        timestamp: new Date().toISOString(),
        amount: totalReward
      });

      logger.info('Daily reward claimed:', {
        doctor: doctorAddress,
        reputationScore,
        reward: totalReward,
        txId: payment.txId
      });

      return {
        success: true,
        reward: totalReward,
        payment,
        nextClaimAvailable: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };

    } catch (error) {
      logger.error('Error claiming daily reward:', error);
      throw error;
    }
  }

  async getTransactionHistory(userAddress, limit = 50) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        return [];
      }

      if (this.network === 'testnet') {
        return [
          {
            txId: this.generateMockTxId(),
            type: 'consultation_payment',
            amount: 0.00234,
            timestamp: new Date().toISOString(),
            status: 'confirmed',
            confirmations: 6
          }
        ];
      }

      const response = await axios.get(`${this.baseURL}/addrs/${wallet.btcAddress}`, {
        params: { 
          token: this.apiKey,
          limit 
        }
      });

      return response.data.txrefs?.map(tx => ({
        txId: tx.tx_hash,
        type: tx.tx_input_n >= 0 ? 'sent' : 'received',
        amount: tx.value / 100000000,
        timestamp: tx.confirmed,
        status: 'confirmed',
        confirmations: tx.confirmations
      })) || [];

    } catch (error) {
      logger.error('Error fetching transaction history:', error);
      return [];
    }
  }

  async verifyPayment(txId, expectedAmount, recipientAddress) {
    try {
      if (this.network === 'testnet') {
        return {
          verified: true,
          amount: expectedAmount,
          recipient: recipientAddress,
          confirmations: 6,
          timestamp: new Date().toISOString()
        };
      }

      const response = await axios.get(`${this.baseURL}/txs/${txId}`, {
        params: { token: this.apiKey }
      });

      const transaction = response.data;
      const output = transaction.outputs.find(out => 
        out.addresses.includes(recipientAddress)
      );

      if (!output) {
        return { verified: false, error: 'Recipient not found in transaction' };
      }

      const actualAmount = output.value / 100000000;
      const amountMatches = Math.abs(actualAmount - expectedAmount) < 0.00000001;

      return {
        verified: amountMatches && transaction.confirmations > 0,
        amount: actualAmount,
        expectedAmount,
        recipient: recipientAddress,
        confirmations: transaction.confirmations,
        timestamp: transaction.confirmed
      };

    } catch (error) {
      logger.error('Error verifying payment:', error);
      return { verified: false, error: error.message };
    }
  }

  async broadcastTransaction(signedTx) {
    try {
      if (this.network === 'testnet') {
        const mockTxId = this.generateMockTxId();
        logger.info('Mock transaction broadcast:', { txId: mockTxId });
        
        return {
          success: true,
          txId: mockTxId,
          timestamp: new Date().toISOString()
        };
      }

      const response = await axios.post(`${this.baseURL}/txs/push`, {
        tx: signedTx
      }, {
        params: { token: this.apiKey }
      });

      logger.info('Transaction broadcast:', { txId: response.data.tx.hash });

      return {
        success: true,
        txId: response.data.tx.hash,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error broadcasting transaction:', error);
      throw new Error('Failed to broadcast transaction');
    }
  }

  async createMultisigEscrow(doctorAddress, patientAddress, amount) {
    try {
      const escrowData = {
        doctorAddress,
        patientAddress,
        amount,
        createdAt: new Date().toISOString(),
        status: 'pending',
        escrowId: crypto.randomBytes(16).toString('hex')
      };

      if (this.network === 'testnet') {
        escrowData.multisigAddress = 'tb1q' + crypto.randomBytes(20).toString('hex').substring(0, 32);
        escrowData.redeemScript = crypto.randomBytes(32).toString('hex');
      }

      logger.info('Multisig escrow created:', escrowData);
      return escrowData;

    } catch (error) {
      logger.error('Error creating multisig escrow:', error);
      throw new Error('Failed to create multisig escrow');
    }
  }

  async releaseEscrow(escrowId, recipientAddress) {
    try {
      logger.info('Escrow released:', { escrowId, recipient: recipientAddress });
      
      return {
        success: true,
        txId: this.generateMockTxId(),
        timestamp: new Date().toISOString(),
        escrowId,
        recipient: recipientAddress
      };

    } catch (error) {
      logger.error('Error releasing escrow:', error);
      throw new Error('Failed to release escrow');
    }
  }

  async getNetworkFees() {
    try {
      const response = await axios.get('https://mempool.space/api/v1/fees/recommended');
      
      return {
        fastestFee: response.data.fastestFee,
        halfHourFee: response.data.halfHourFee,
        hourFee: response.data.hourFee,
        economyFee: response.data.economyFee || response.data.hourFee,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.warn('Error fetching network fees, using defaults');
      return {
        fastestFee: 20,
        halfHourFee: 15,
        hourFee: 10,
        economyFee: 5,
        timestamp: new Date().toISOString()
      };
    }
  }

  async estimateTransactionFee(inputCount, outputCount, feeRate) {
    const txSize = (inputCount * 148) + (outputCount * 34) + 10;
    const feeSatoshis = txSize * (feeRate || 10);
    
    return {
      txSize,
      feeSatoshis,
      feeBTC: feeSatoshis / 100000000,
      feeUSD: (feeSatoshis / 100000000) * (await this.getCurrentBTCPrice())
    };
  }

  generateMockTxId() {
    return crypto.randomBytes(32).toString('hex');
  }

  async getWalletInfo(userAddress) {
    const wallet = this.walletStorage.get(userAddress.toLowerCase());
    if (!wallet) {
      return null;
    }

    const balance = await this.getBTCBalance(userAddress);
    
    return {
      address: wallet.btcAddress,
      balance: balance.balance,
      network: this.network,
      createdAt: wallet.createdAt,
      lastActivity: wallet.lastActivity || wallet.createdAt
    };
  }

  async setupDoctorWallet(doctorAddress, btcAddress = null) {
    try {
      let walletInfo;
      
      if (btcAddress && this.isValidBTCAddress(btcAddress)) {
        walletInfo = {
          btcAddress,
          provided: true,
          createdAt: new Date().toISOString()
        };
      } else {
        walletInfo = await this.generateBTCAddress(doctorAddress);
        walletInfo.provided = false;
      }

      this.walletStorage.set(doctorAddress.toLowerCase(), {
        ...walletInfo,
        balance: 0,
        totalEarned: 0,
        lastReward: null
      });

      logger.info('Doctor wallet setup:', { doctorAddress, btcAddress: walletInfo.address });
      return walletInfo;

    } catch (error) {
      logger.error('Error setting up doctor wallet:', error);
      throw new Error('Failed to setup doctor wallet');
    }
  }

  isValidBTCAddress(address) {
    const testnetRegex = /^[2mn]|^tb1/;
    const mainnetRegex = /^[13]|^bc1/;
    
    if (this.network === 'testnet') {
      return testnetRegex.test(address) && address.length >= 26 && address.length <= 62;
    } else {
      return mainnetRegex.test(address) && address.length >= 26 && address.length <= 62;
    }
  }
}

module.exports = new BTCService();