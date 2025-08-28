const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const EventEmitter = require('events');

const logger = require('../../backend/src/utils/logger');

class LightningClient extends EventEmitter {
  constructor() {
    super();
    this.endpoint = process.env.LIGHTNING_ENDPOINT || 'http://localhost:8080';
    this.macaroon = process.env.LIGHTNING_MACAROON;
    this.cert = process.env.LIGHTNING_CERT;
    this.network = process.env.BTC_NETWORK || 'testnet';
    
    this.isConnected = false;
    this.nodeInfo = null;
    this.channels = [];
    this.pendingPayments = new Map();
    this.invoiceCache = new Map();
    
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    
    this.ws = null;
    
    this.init();
  }

  async init() {
    try {
      await this.connect();
      await this.getNodeInfo();
      this.setupWebSocket();
      
      logger.info('Lightning client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Lightning client:', error);
      this.scheduleReconnect();
    }
  }

  async connect() {
    try {
      const headers = {};
      
      if (this.macaroon) {
        headers['Grpc-Metadata-macaroon'] = this.macaroon;
      }
      
      if (this.cert) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await axios.get(`${this.endpoint}/v1/getinfo`, {
        headers,
        timeout: 10000,
        httpsAgent: this.cert ? new (require('https')).Agent({
          cert: this.cert,
          rejectUnauthorized: false
        }) : undefined
      });

      this.isConnected = true;
      this.nodeInfo = response.data;
      this.reconnectAttempts = 0;
      
      this.emit('connected', this.nodeInfo);
      
      logger.info('Connected to Lightning node:', {
        alias: this.nodeInfo.alias,
        pubkey: this.nodeInfo.identity_pubkey?.substring(0, 12) + '...',
        network: this.network
      });

    } catch (error) {
      this.isConnected = false;
      logger.error('Lightning connection failed:', error.message);
      throw error;
    }
  }

  async getNodeInfo() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const response = await this.makeRequest('GET', '/v1/getinfo');
      this.nodeInfo = response.data;
      
      return {
        alias: this.nodeInfo.alias,
        pubkey: this.nodeInfo.identity_pubkey,
        version: this.nodeInfo.version,
        blockHeight: this.nodeInfo.block_height,
        synced: this.nodeInfo.synced_to_graph,
        numChannels: this.nodeInfo.num_active_channels,
        numPeers: this.nodeInfo.num_peers
      };

    } catch (error) {
      logger.error('Error getting node info:', error);
      throw error;
    }
  }

  async createInvoice(amount, memo = 'DiagnoChain Payment', expiry = 3600) {
    try {
      const amountSatoshis = Math.floor(parseFloat(amount) * 100000000);
      
      const invoiceRequest = {
        memo,
        value: amountSatoshis.toString(),
        expiry: expiry.toString(),
        is_amp: false
      };

      if (this.network === 'testnet' && !this.isConnected) {
        const mockInvoice = {
          payment_request: `lntb${amountSatoshis}u1p${crypto.randomBytes(20).toString('hex')}`,
          r_hash: crypto.randomBytes(32).toString('hex'),
          add_index: Date.now(),
          payment_addr: crypto.randomBytes(32).toString('hex')
        };
        
        this.invoiceCache.set(mockInvoice.r_hash, {
          ...mockInvoice,
          amount: amountSatoshis,
          memo,
          createdAt: new Date().toISOString(),
          paid: false
        });

        return mockInvoice;
      }

      const response = await this.makeRequest('POST', '/v1/invoices', invoiceRequest);
      const invoice = response.data;

      this.invoiceCache.set(invoice.r_hash, {
        ...invoice,
        amount: amountSatoshis,
        memo,
        createdAt: new Date().toISOString(),
        paid: false
      });

      logger.info('Lightning invoice created:', {
        amount: `${amountSatoshis} sats`,
        memo,
        expiry: `${expiry}s`,
        hash: invoice.r_hash.substring(0, 16) + '...'
      });

      return invoice;

    } catch (error) {
      logger.error('Error creating Lightning invoice:', error);
      throw new Error('Failed to create Lightning invoice');
    }
  }

  async payInvoice(paymentRequest, timeoutSeconds = 60) {
    try {
      const paymentData = {
        payment_request: paymentRequest,
        timeout_seconds: timeoutSeconds,
        fee_limit_sat: '100' // Max 100 sats fee
      };

      if (this.network === 'testnet' && !this.isConnected) {
        const mockPayment = {
          payment_hash: crypto.randomBytes(32).toString('hex'),
          payment_preimage: crypto.randomBytes(32).toString('hex'),
          payment_route: {
            total_amt: '1000',
            total_fees: '1',
            total_time_lock: 144
          },
          payment_error: '',
          status: 'SUCCEEDED'
        };

        setTimeout(() => {
          this.emit('payment_succeeded', mockPayment);
        }, 2000);

        return mockPayment;
      }

      const response = await this.makeRequest('POST', '/v2/router/send', paymentData);
      const payment = response.data;

      if (payment.status === 'SUCCEEDED') {
        this.emit('payment_succeeded', payment);
        
        logger.info('Lightning payment sent:', {
          hash: payment.payment_hash.substring(0, 16) + '...',
          amount: payment.payment_route?.total_amt,
          fees: payment.payment_route?.total_fees
        });
      } else {
        this.emit('payment_failed', payment);
        throw new Error(`Payment failed: ${payment.payment_error}`);
      }

      return payment;

    } catch (error) {
      logger.error('Error sending Lightning payment:', error);
      throw new Error('Failed to send Lightning payment');
    }
  }

  async checkInvoiceStatus(paymentHash) {
    try {
      const cachedInvoice = this.invoiceCache.get(paymentHash);
      
      if (this.network === 'testnet' && cachedInvoice) {
        const shouldBePaid = Math.random() > 0.7; // 30% chance of payment in testnet
        
        if (shouldBePaid && !cachedInvoice.paid) {
          cachedInvoice.paid = true;
          cachedInvoice.settleDate = new Date().toISOString();
          this.invoiceCache.set(paymentHash, cachedInvoice);
          
          this.emit('invoice_settled', {
            payment_hash: paymentHash,
            settled: true,
            value: cachedInvoice.amount,
            settle_date: cachedInvoice.settleDate
          });
        }
        
        return {
          settled: cachedInvoice.paid,
          value: cachedInvoice.amount,
          memo: cachedInvoice.memo,
          creation_date: cachedInvoice.createdAt,
          settle_date: cachedInvoice.settleDate || null
        };
      }

      const response = await this.makeRequest('GET', `/v1/invoice/${paymentHash}`);
      const invoice = response.data;

      if (invoice.settled && cachedInvoice && !cachedInvoice.paid) {
        cachedInvoice.paid = true;
        cachedInvoice.settleDate = new Date(parseInt(invoice.settle_date) * 1000).toISOString();
        this.invoiceCache.set(paymentHash, cachedInvoice);
        
        this.emit('invoice_settled', invoice);
      }

      return invoice;

    } catch (error) {
      logger.error('Error checking invoice status:', error);
      throw error;
    }
  }

  async getChannelBalance() {
    try {
      if (this.network === 'testnet' && !this.isConnected) {
        return {
          balance: '500000', // 500k sats
          pending_open_balance: '0',
          local_balance: {
            sat: '500000',
            msat: '500000000'
          },
          remote_balance: {
            sat: '200000',
            msat: '200000000'
          }
        };
      }

      const response = await this.makeRequest('GET', '/v1/balance/channels');
      return response.data;

    } catch (error) {
      logger.warn('Error getting channel balance:', error);
      return { balance: '0', pending_open_balance: '0' };
    }
  }

  async getWalletBalance() {
    try {
      if (this.network === 'testnet' && !this.isConnected) {
        return {
          total_balance: '1000000', // 1M sats
          confirmed_balance: '1000000',
          unconfirmed_balance: '0'
        };
      }

      const response = await this.makeRequest('GET', '/v1/balance/blockchain');
      return response.data;

    } catch (error) {
      logger.warn('Error getting wallet balance:', error);
      return { total_balance: '0', confirmed_balance: '0', unconfirmed_balance: '0' };
    }
  }

  async listChannels() {
    try {
      if (this.network === 'testnet' && !this.isConnected) {
        return {
          channels: [
            {
              channel_point: 'mock_channel_point',
              capacity: '1000000',
              local_balance: '500000',
              remote_balance: '500000',
              active: true
            }
          ]
        };
      }

      const response = await this.makeRequest('GET', '/v1/channels');
      this.channels = response.data.channels || [];
      
      return response.data;

    } catch (error) {
      logger.error('Error listing channels:', error);
      return { channels: [] };
    }
  }

  async estimateRoutingFee(destination, amount) {
    try {
      const amountSatoshis = Math.floor(parseFloat(amount) * 100000000);
      
      if (this.network === 'testnet') {
        const baseFee = Math.max(1, Math.floor(amountSatoshis * 0.0001)); // 0.01% base fee
        return {
          fee_sat: baseFee.toString(),
          time_lock_delay: 144,
          success_prob: 0.95
        };
      }

      const queryData = {
        dest: destination,
        amt_sat: amountSatoshis.toString()
      };

      const response = await this.makeRequest('GET', '/v1/graph/routes', queryData);
      
      if (response.data.routes && response.data.routes.length > 0) {
        const bestRoute = response.data.routes[0];
        return {
          fee_sat: bestRoute.total_fees,
          time_lock_delay: bestRoute.total_time_lock,
          success_prob: bestRoute.success_prob || 0.8
        };
      }

      return { fee_sat: '1', time_lock_delay: 144, success_prob: 0.5 };

    } catch (error) {
      logger.warn('Error estimating routing fee:', error);
      return { fee_sat: '1', time_lock_delay: 144, success_prob: 0.5 };
    }
  }

  setupWebSocket() {
    try {
      if (this.network === 'testnet' && !this.endpoint.includes('localhost')) {
        logger.info('WebSocket disabled for testnet without local node');
        return;
      }

      const wsUrl = this.endpoint.replace('http', 'ws') + '/v1/invoices/subscribe';
      this.ws = new WebSocket(wsUrl, {
        headers: this.macaroon ? { 'Grpc-Metadata-macaroon': this.macaroon } : {}
      });

      this.ws.on('open', () => {
        logger.info('Lightning WebSocket connected');
        this.emit('websocket_connected');
      });

      this.ws.on('message', (data) => {
        try {
          const invoice = JSON.parse(data);
          if (invoice.settled) {
            this.emit('invoice_settled', invoice);
            logger.info('Invoice settled via WebSocket:', {
              hash: invoice.payment_hash?.substring(0, 16) + '...',
              value: invoice.value
            });
          }
        } catch (error) {
          logger.warn('Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('close', () => {
        logger.warn('Lightning WebSocket disconnected');
        this.emit('websocket_disconnected');
        setTimeout(() => this.setupWebSocket(), 10000);
      });

      this.ws.on('error', (error) => {
        logger.error('Lightning WebSocket error:', error);
      });

    } catch (error) {
      logger.warn('WebSocket setup failed:', error);
    }
  }

  async makeRequest(method, endpoint, data = null) {
    try {
      const config = {
        method,
        url: `${this.endpoint}${endpoint}`,
        timeout: 30000,
        headers: {}
      };

      if (this.macaroon) {
        config.headers['Grpc-Metadata-macaroon'] = this.macaroon;
      }

      if (data) {
        config.headers['Content-Type'] = 'application/json';
        if (method === 'GET') {
          config.params = data;
        } else {
          config.data = data;
        }
      }

      return await axios(config);

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        this.isConnected = false;
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('connection_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Scheduling Lightning reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed:', error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  async processConsultationPayment(consultationId, doctorBtcAddress, amount) {
    try {
      const amountBTC = parseFloat(amount);
      
      const invoice = await this.createInvoice(
        amountBTC, 
        `DiagnoChain consultation #${consultationId}`,
        3600
      );

      const paymentRecord = {
        consultationId,
        doctorAddress: doctorBtcAddress,
        amount: amountBTC,
        invoice: invoice.payment_request,
        paymentHash: invoice.r_hash,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      };

      this.pendingPayments.set(invoice.r_hash, paymentRecord);

      this.once(`invoice_settled_${invoice.r_hash}`, async (settledInvoice) => {
        await this.handleInvoiceSettlement(invoice.r_hash, settledInvoice);
      });

      logger.info('Consultation payment created:', {
        consultationId,
        amount: `${amountBTC} BTC`,
        invoice: invoice.payment_request.substring(0, 50) + '...'
      });

      return {
        success: true,
        invoice: invoice.payment_request,
        paymentHash: invoice.r_hash,
        amount: amountBTC,
        expiresAt: paymentRecord.expiresAt
      };

    } catch (error) {
      logger.error('Error processing consultation payment:', error);
      throw error;
    }
  }

  async handleInvoiceSettlement(paymentHash, invoice) {
    try {
      const paymentRecord = this.pendingPayments.get(paymentHash);
      if (!paymentRecord) {
        logger.warn('No payment record found for settled invoice:', paymentHash);
        return;
      }

      paymentRecord.status = 'settled';
      paymentRecord.settledAt = new Date().toISOString();
      paymentRecord.settledAmount = parseInt(invoice.value);

      this.emit('consultation_payment_settled', {
        consultationId: paymentRecord.consultationId,
        doctorAddress: paymentRecord.doctorAddress,
        amount: paymentRecord.amount,
        settledAt: paymentRecord.settledAt
      });

      logger.info('Consultation payment settled:', {
        consultationId: paymentRecord.consultationId,
        amount: `${paymentRecord.amount} BTC`
      });

    } catch (error) {
      logger.error('Error handling invoice settlement:', error);
    }
  }

  async sendMicropayment(recipient, amount, memo = 'DiagnoChain micropayment') {
    try {
      const amountSatoshis = Math.floor(parseFloat(amount) * 100000000);
      
      if (amountSatoshis < 1) {
        throw new Error('Amount too small for Lightning payment');
      }

      const invoice = await this.createInvoiceForRecipient(recipient, amountSatoshis, memo);
      const payment = await this.payInvoice(invoice.payment_request, 30);

      logger.info('Micropayment sent:', {
        recipient,
        amount: `${amountSatoshis} sats`,
        hash: payment.payment_hash?.substring(0, 16) + '...'
      });

      return {
        success: true,
        paymentHash: payment.payment_hash,
        preimage: payment.payment_preimage,
        amount: amountSatoshis,
        fee: payment.payment_route?.total_fees || '1'
      };

    } catch (error) {
      logger.error('Error sending micropayment:', error);
      throw error;
    }
  }

  async createInvoiceForRecipient(recipientPubkey, amountSats, memo) {
    if (this.network === 'testnet') {
      return {
        payment_request: `lntb${amountSats}u1p${crypto.randomBytes(20).toString('hex')}`,
        r_hash: crypto.randomBytes(32).toString('hex')
      };
    }

    // In production, this would create an invoice on the recipient's node
    // For now, we'll create a local invoice as a placeholder
    return await this.createInvoice(amountSats / 100000000, memo, 3600);
  }

  async getPaymentHistory(limit = 50) {
    try {
      if (this.network === 'testnet' && !this.isConnected) {
        return Array.from(this.pendingPayments.values()).slice(0, limit);
      }

      const response = await this.makeRequest('GET', '/v1/payments', {
        max_payments: limit.toString()
      });

      return response.data.payments || [];

    } catch (error) {
      logger.error('Error getting payment history:', error);
      return [];
    }
  }

  async closeChannel(channelPoint, force = false) {
    try {
      const closeData = {
        channel_point: {
          funding_txid_str: channelPoint.split(':')[0],
          output_index: parseInt(channelPoint.split(':')[1])
        },
        force
      };

      const response = await this.makeRequest('DELETE', '/v1/channels', closeData);
      
      logger.info('Channel close initiated:', {
        channelPoint,
        force,
        txId: response.data.closing_txid
      });

      return response.data;

    } catch (error) {
      logger.error('Error closing channel:', error);
      throw error;
    }
  }

  async generatePaymentRequest(amount, description, consultationId) {
    try {
      const invoice = await this.createInvoice(amount, description);
      
      return {
        consultationId,
        paymentRequest: invoice.payment_request,
        paymentHash: invoice.r_hash,
        amount,
        description,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        qrCode: await this.generateQRCode(invoice.payment_request)
      };

    } catch (error) {
      logger.error('Error generating payment request:', error);
      throw error;
    }
  }

  async generateQRCode(paymentRequest) {
    // In production, integrate with QR code generation library
    return `data:image/svg+xml;base64,${Buffer.from(`
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="white"/>
        <text x="100" y="100" text-anchor="middle" font-size="12">QR Code: ${paymentRequest.substring(0, 20)}...</text>
      </svg>
    `).toString('base64')}`;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    
    this.isConnected = false;
    this.emit('disconnected');
    logger.info('Lightning client disconnected');
  }

  getStatus() {
    return {
      connected: this.isConnected,
      nodeInfo: this.nodeInfo,
      channelCount: this.channels.length,
      pendingPayments: this.pendingPayments.size,
      network: this.network,
      endpoint: this.endpoint
    };
  }
}

module.exports = LightningClient;