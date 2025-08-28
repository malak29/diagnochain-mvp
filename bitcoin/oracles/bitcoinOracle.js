const EventEmitter = require('events');
const axios = require('axios');
const Web3 = require('web3');
const cron = require('node-cron');

const logger = require('../../backend/src/utils/logger');

class BitcoinOracle extends EventEmitter {
  constructor() {
    super();
    
    this.web3 = new Web3(process.env.WEB3_PROVIDER_URL || 'http://localhost:8545');
    this.account = this.web3.eth.accounts.privateKeyToAccount(
      process.env.ORACLE_PRIVATE_KEY || '0x' + '0'.repeat(64)
    );
    this.web3.eth.accounts.wallet.add(this.account);
    
    this.oracleContractAddress = process.env.ORACLE_CONTRACT_ADDRESS;
    this.oracleContractABI = require('../contracts/BTCOracle.json').abi;
    
    if (this.oracleContractAddress) {
      this.contract = new this.web3.eth.Contract(this.oracleContractABI, this.oracleContractAddress);
    }
    
    this.priceFeeds = [
      {
        name: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
        parser: (data) => ({
          btc: data.bitcoin.usd,
          eth: data.ethereum.usd
        }),
        weight: 0.4
      },
      {
        name: 'CoinMarketCap',
        url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,ETH&convert=USD',
        headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY },
        parser: (data) => ({
          btc: data.data.BTC.quote.USD.price,
          eth: data.data.ETH.quote.USD.price
        }),
        weight: 0.3
      },
      {
        name: 'Binance',
        url: 'https://api.binance.com/api/v3/ticker/price',
        parser: (data) => {
          const btcTicker = data.find(t => t.symbol === 'BTCUSDT');
          const ethTicker = data.find(t => t.symbol === 'ETHUSDT');
          return {
            btc: parseFloat(btcTicker?.price || 0),
            eth: parseFloat(ethTicker?.price || 0)
          };
        },
        weight: 0.3
      }
    ];

    this.priceHistory = [];
    this.maxHistoryLength = 1000;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.deviationThreshold = 0.05; // 5% price deviation threshold
    
    this.lastPriceUpdate = null;
    this.isUpdating = false;
    
    this.statistics = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      lastError: null,
      averageUpdateTime: 0,
      priceDeviations: 0
    };

    this.init();
  }

  async init() {
    try {
      await this.updatePrices();
      this.startAutomaticUpdates();
      this.startCleanupSchedule();
      
      logger.info('Bitcoin Oracle initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Bitcoin Oracle:', error);
    }
  }

  async updatePrices() {
    if (this.isUpdating) {
      logger.warn('Price update already in progress, skipping');
      return;
    }

    this.isUpdating = true;
    const startTime = Date.now();

    try {
      const pricePromises = this.priceFeeds.map(async (feed) => {
        try {
          const response = await axios.get(feed.url, {
            headers: feed.headers || {},
            timeout: 10000
          });
          
          const prices = feed.parser(response.data);
          
          return {
            source: feed.name,
            btcPrice: prices.btc,
            ethPrice: prices.eth,
            weight: feed.weight,
            timestamp: new Date().toISOString(),
            success: true
          };
        } catch (error) {
          logger.warn(`Price feed ${feed.name} failed:`, error.message);
          return {
            source: feed.name,
            success: false,
            error: error.message
          };
        }
      });

      const results = await Promise.allSettled(pricePromises);
      const successfulFeeds = results
        .filter(result => result.status === 'fulfilled' && result.value.success)
        .map(result => result.value);

      if (successfulFeeds.length === 0) {
        throw new Error('All price feeds failed');
      }

      const weightedPrices = this.calculateWeightedAverage(successfulFeeds);
      
      const priceUpdate = {
        btcPrice: weightedPrices.btc,
        ethPrice: weightedPrices.eth,
        timestamp: new Date().toISOString(),
        sources: successfulFeeds.map(f => f.source),
        confidence: this.calculateConfidence(successfulFeeds),
        deviation: this.calculateDeviation(successfulFeeds)
      };

      if (this.shouldUpdateContract(priceUpdate)) {
        await this.updateSmartContract(priceUpdate);
      }

      this.addToHistory(priceUpdate);
      this.lastPriceUpdate = priceUpdate;

      const updateTime = Date.now() - startTime;
      this.updateStatistics(true, updateTime);

      this.emit('price_updated', priceUpdate);

      logger.info('Prices updated successfully:', {
        btc: `$${priceUpdate.btcPrice.toFixed(2)}`,
        eth: `$${priceUpdate.ethPrice.toFixed(2)}`,
        sources: priceUpdate.sources.length,
        confidence: `${(priceUpdate.confidence * 100).toFixed(1)}%`,
        updateTime: `${updateTime}ms`
      });

      return priceUpdate;

    } catch (error) {
      this.updateStatistics(false);
      logger.error('Error updating prices:', error);
      throw error;
    } finally {
      this.isUpdating = false;
    }
  }

  calculateWeightedAverage(feeds) {
    let totalBtcWeight = 0;
    let totalEthWeight = 0;
    let weightedBtcSum = 0;
    let weightedEthSum = 0;

    feeds.forEach(feed => {
      if (feed.btcPrice && feed.ethPrice) {
        weightedBtcSum += feed.btcPrice * feed.weight;
        weightedEthSum += feed.ethPrice * feed.weight;
        totalBtcWeight += feed.weight;
        totalEthWeight += feed.weight;
      }
    });

    return {
      btc: weightedBtcSum / totalBtcWeight,
      eth: weightedEthSum / totalEthWeight
    };
  }

  calculateConfidence(feeds) {
    if (feeds.length < 2) return 0.5;

    const btcPrices = feeds.map(f => f.btcPrice).filter(p => p > 0);
    const avgPrice = btcPrices.reduce((sum, price) => sum + price, 0) / btcPrices.length;
    
    const variance = btcPrices.reduce((sum, price) => {
      return sum + Math.pow(price - avgPrice, 2);
    }, 0) / btcPrices.length;
    
    const standardDeviation = Math.sqrt(variance);
    const coefficientOfVariation = standardDeviation / avgPrice;
    
    return Math.max(0.1, Math.min(1.0, 1 - coefficientOfVariation));
  }

  calculateDeviation(feeds) {
    const btcPrices = feeds.map(f => f.btcPrice).filter(p => p > 0);
    if (btcPrices.length < 2) return 0;

    const max = Math.max(...btcPrices);
    const min = Math.min(...btcPrices);
    
    return (max - min) / min;
  }

  shouldUpdateContract(priceUpdate) {
    if (!this.contract || !this.lastPriceUpdate) {
      return true;
    }

    const timeSinceLastUpdate = new Date() - new Date(this.lastPriceUpdate.timestamp);
    const timeThreshold = 15 * 60 * 1000; // 15 minutes

    if (timeSinceLastUpdate > timeThreshold) {
      return true;
    }

    const priceChange = Math.abs(
      (priceUpdate.btcPrice - this.lastPriceUpdate.btcPrice) / this.lastPriceUpdate.btcPrice
    );

    return priceChange > this.deviationThreshold;
  }

  async updateSmartContract(priceUpdate) {
    try {
      if (!this.contract) {
        logger.warn('Oracle contract not configured, skipping on-chain update');
        return;
      }

      const btcPriceScaled = Math.floor(priceUpdate.btcPrice * 100000000); // Scale by 10^8
      const ethPriceScaled = Math.floor(priceUpdate.ethPrice * 100000000);

      const gasEstimate = await this.contract.methods
        .updateBTCPrice(btcPriceScaled.toString())
        .estimateGas({ from: this.account.address });

      const gasPrice = await this.web3.eth.getGasPrice();

      const tx = await this.contract.methods
        .updateBTCPrice(btcPriceScaled.toString())
        .send({
          from: this.account.address,
          gas: Math.floor(gasEstimate * 1.2),
          gasPrice: gasPrice
        });

      logger.info('Smart contract price updated:', {
        txHash: tx.transactionHash,
        btcPrice: priceUpdate.btcPrice,
        ethPrice: priceUpdate.ethPrice,
        gasUsed: tx.gasUsed
      });

      return {
        success: true,
        txHash: tx.transactionHash,
        gasUsed: tx.gasUsed,
        blockNumber: tx.blockNumber
      };

    } catch (error) {
      logger.error('Error updating smart contract:', error);
      throw error;
    }
  }

  async getBTCToETHRate() {
    try {
      if (!this.lastPriceUpdate) {
        await this.updatePrices();
      }

      const rate = this.lastPriceUpdate.btcPrice / this.lastPriceUpdate.ethPrice;
      
      return {
        rate,
        btcPrice: this.lastPriceUpdate.btcPrice,
        ethPrice: this.lastPriceUpdate.ethPrice,
        timestamp: this.lastPriceUpdate.timestamp,
        confidence: this.lastPriceUpdate.confidence
      };

    } catch (error) {
      logger.error('Error calculating BTC/ETH rate:', error);
      throw error;
    }
  }

  async convertETHToBTC(ethAmount) {
    try {
      const rates = await this.getBTCToETHRate();
      const btcAmount = parseFloat(ethAmount) / rates.rate;
      
      return {
        ethAmount: parseFloat(ethAmount),
        btcAmount,
        rate: rates.rate,
        timestamp: new Date().toISOString(),
        confidence: rates.confidence
      };

    } catch (error) {
      logger.error('Error converting ETH to BTC:', error);
      throw error;
    }
  }

  async convertBTCToETH(btcAmount) {
    try {
      const rates = await this.getBTCToETHRate();
      const ethAmount = parseFloat(btcAmount) * rates.rate;
      
      return {
        btcAmount: parseFloat(btcAmount),
        ethAmount,
        rate: rates.rate,
        timestamp: new Date().toISOString(),
        confidence: rates.confidence
      };

    } catch (error) {
      logger.error('Error converting BTC to ETH:', error);
      throw error;
    }
  }

  getPriceHistory(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.priceHistory.filter(entry => new Date(entry.timestamp) > cutoff);
  }

  addToHistory(priceUpdate) {
    this.priceHistory.push(priceUpdate);
    
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory = this.priceHistory.slice(-this.maxHistoryLength);
    }
  }

  updateStatistics(success, updateTime = 0) {
    this.statistics.totalUpdates++;
    
    if (success) {
      this.statistics.successfulUpdates++;
      
      if (updateTime > 0) {
        const currentAvg = this.statistics.averageUpdateTime;
        const count = this.statistics.successfulUpdates;
        this.statistics.averageUpdateTime = ((currentAvg * (count - 1)) + updateTime) / count;
      }
    } else {
      this.statistics.failedUpdates++;
    }

    this.statistics.successRate = this.statistics.totalUpdates > 0 
      ? (this.statistics.successfulUpdates / this.statistics.totalUpdates) * 100
      : 0;
  }

  startAutomaticUpdates() {
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.updatePrices();
      } catch (error) {
        logger.error('Scheduled price update failed:', error);
      }
    });

    logger.info('Automatic price updates started (every 5 minutes)');
  }

  startCleanupSchedule() {
    cron.schedule('0 0 * * *', () => {
      this.cleanupOldData();
    });

    logger.info('Daily cleanup scheduled');
  }

  cleanupOldData() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const originalLength = this.priceHistory.length;
    
    this.priceHistory = this.priceHistory.filter(entry => 
      new Date(entry.timestamp) > cutoff
    );

    const removed = originalLength - this.priceHistory.length;
    if (removed > 0) {
      logger.info(`Cleaned up ${removed} old price records`);
    }
  }

  async validatePriceData(priceData) {
    const validations = [
      {
        check: priceData.btcPrice > 1000,
        message: 'BTC price seems too low'
      },
      {
        check: priceData.btcPrice < 500000,
        message: 'BTC price seems too high'
      },
      {
        check: priceData.ethPrice > 100,
        message: 'ETH price seems too low'
      },
      {
        check: priceData.ethPrice < 50000,
        message: 'ETH price seems too high'
      },
      {
        check: priceData.confidence > 0.3,
        message: 'Price confidence too low'
      }
    ];

    const failures = validations.filter(v => !v.check);
    
    if (failures.length > 0) {
      logger.warn('Price validation warnings:', failures.map(f => f.message));
      
      if (failures.length > 2) {
        throw new Error('Price data failed validation checks');
      }
    }

    return true;
  }

  async createPriceAlert(thresholds) {
    try {
      const alertId = crypto.randomBytes(16).toString('hex');
      
      const alert = {
        id: alertId,
        btcUpperThreshold: thresholds.btcUpper,
        btcLowerThreshold: thresholds.btcLower,
        ethUpperThreshold: thresholds.ethUpper,
        ethLowerThreshold: thresholds.ethLower,
        webhook: thresholds.webhook,
        email: thresholds.email,
        active: true,
        createdAt: new Date().toISOString(),
        triggeredCount: 0
      };

      // In production, store in database
      this.priceAlerts = this.priceAlerts || new Map();
      this.priceAlerts.set(alertId, alert);

      logger.info('Price alert created:', { alertId, thresholds });
      return { success: true, alertId, alert };

    } catch (error) {
      logger.error('Error creating price alert:', error);
      throw error;
    }
  }

  async checkPriceAlerts(priceUpdate) {
    if (!this.priceAlerts || this.priceAlerts.size === 0) {
      return;
    }

    for (const [alertId, alert] of this.priceAlerts) {
      if (!alert.active) continue;

      let triggered = false;
      let triggerReason = '';

      if (alert.btcUpperThreshold && priceUpdate.btcPrice >= alert.btcUpperThreshold) {
        triggered = true;
        triggerReason = `BTC price reached upper threshold: $${alert.btcUpperThreshold}`;
      } else if (alert.btcLowerThreshold && priceUpdate.btcPrice <= alert.btcLowerThreshold) {
        triggered = true;
        triggerReason = `BTC price reached lower threshold: $${alert.btcLowerThreshold}`;
      } else if (alert.ethUpperThreshold && priceUpdate.ethPrice >= alert.ethUpperThreshold) {
        triggered = true;
        triggerReason = `ETH price reached upper threshold: $${alert.ethUpperThreshold}`;
      } else if (alert.ethLowerThreshold && priceUpdate.ethPrice <= alert.ethLowerThreshold) {
        triggered = true;
        triggerReason = `ETH price reached lower threshold: $${alert.ethLowerThreshold}`;
      }

      if (triggered) {
        await this.triggerAlert(alert, priceUpdate, triggerReason);
      }
    }
  }

  async triggerAlert(alert, priceUpdate, reason) {
    try {
      alert.triggeredCount++;
      alert.lastTriggered = new Date().toISOString();

      if (alert.webhook) {
        try {
          await axios.post(alert.webhook, {
            alertId: alert.id,
            reason,
            prices: {
              btc: priceUpdate.btcPrice,
              eth: priceUpdate.ethPrice
            },
            timestamp: priceUpdate.timestamp
          });
        } catch (error) {
          logger.warn('Webhook alert failed:', error);
        }
      }

      this.emit('price_alert', {
        alertId: alert.id,
        reason,
        prices: priceUpdate,
        alert
      });

      logger.info('Price alert triggered:', { alertId: alert.id, reason });

    } catch (error) {
      logger.error('Error triggering alert:', error);
    }
  }

  async getHistoricalData(hours = 24, interval = 'hourly') {
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      let data = this.priceHistory.filter(entry => new Date(entry.timestamp) > cutoff);

      if (interval === 'hourly' && data.length > hours) {
        const hourlyData = [];
        const msPerHour = 60 * 60 * 1000;
        
        for (let i = 0; i < hours; i++) {
          const hourStart = Date.now() - (i + 1) * msPerHour;
          const hourEnd = Date.now() - i * msPerHour;
          
          const hourData = data.filter(entry => {
            const entryTime = new Date(entry.timestamp).getTime();
            return entryTime >= hourStart && entryTime < hourEnd;
          });

          if (hourData.length > 0) {
            const avgBtc = hourData.reduce((sum, entry) => sum + entry.btcPrice, 0) / hourData.length;
            const avgEth = hourData.reduce((sum, entry) => sum + entry.ethPrice, 0) / hourData.length;
            
            hourlyData.push({
              timestamp: new Date(hourEnd).toISOString(),
              btcPrice: avgBtc,
              ethPrice: avgEth,
              dataPoints: hourData.length
            });
          }
        }
        
        data = hourlyData.reverse();
      }

      return {
        data,
        period: `${hours}h`,
        interval,
        totalPoints: data.length
      };

    } catch (error) {
      logger.error('Error getting historical data:', error);
      return { data: [], period: `${hours}h`, interval, totalPoints: 0 };
    }
  }

  async emergencyPriceUpdate(btcPrice, ethPrice, reason) {
    try {
      const emergencyUpdate = {
        btcPrice: parseFloat(btcPrice),
        ethPrice: parseFloat(ethPrice),
        timestamp: new Date().toISOString(),
        sources: ['manual_override'],
        confidence: 1.0,
        deviation: 0,
        emergency: true,
        reason
      };

      await this.validatePriceData(emergencyUpdate);

      if (this.contract) {
        await this.updateSmartContract(emergencyUpdate);
      }

      this.addToHistory(emergencyUpdate);
      this.lastPriceUpdate = emergencyUpdate;

      this.emit('emergency_update', emergencyUpdate);

      logger.warn('Emergency price update executed:', {
        btc: `$${btcPrice}`,
        eth: `$${ethPrice}`,
        reason
      });

      return { success: true, update: emergencyUpdate };

    } catch (error) {
      logger.error('Emergency price update failed:', error);
      throw error;
    }
  }

  async getOracleStatus() {
    const status = {
      isRunning: !this.isUpdating,
      lastUpdate: this.lastPriceUpdate?.timestamp,
      contractAddress: this.oracleContractAddress,
      network: process.env.BTC_NETWORK || 'testnet',
      statistics: this.statistics,
      priceFeeds: this.priceFeeds.map(feed => ({
        name: feed.name,
        weight: feed.weight
      })),
      historyLength: this.priceHistory.length,
      alerts: this.priceAlerts ? this.priceAlerts.size : 0
    };

    if (this.lastPriceUpdate) {
      status.currentPrices = {
        btc: this.lastPriceUpdate.btcPrice,
        eth: this.lastPriceUpdate.ethPrice,
        confidence: this.lastPriceUpdate.confidence
      };
    }

    return status;
  }

  getCurrentPrices() {
    if (!this.lastPriceUpdate) {
      return null;
    }

    return {
      btcPrice: this.lastPriceUpdate.btcPrice,
      ethPrice: this.lastPriceUpdate.ethPrice,
      btcToEthRate: this.lastPriceUpdate.btcPrice / this.lastPriceUpdate.ethPrice,
      timestamp: this.lastPriceUpdate.timestamp,
      confidence: this.lastPriceUpdate.confidence,
      sources: this.lastPriceUpdate.sources
    };
  }

  stop() {
    // In production, this would stop all cron jobs
    this.removeAllListeners();
    logger.info('Bitcoin Oracle stopped');
  }
}

module.exports = new BitcoinOracle();