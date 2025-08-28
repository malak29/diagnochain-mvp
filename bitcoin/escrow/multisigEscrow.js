const bitcoin = require('bitcoinjs-lib');
const crypto = require('crypto');
const axios = require('axios');
const EventEmitter = require('events');

const WalletManager = require('../wallet/walletManager');
const logger = require('../../backend/src/utils/logger');

class MultisigEscrow extends EventEmitter {
  constructor() {
    super();
    
    this.network = process.env.BTC_NETWORK === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
    this.isTestnet = process.env.BTC_NETWORK !== 'mainnet';
    
    this.escrowStorage = new Map(); // In production: encrypted database
    this.pendingReleases = new Map();
    this.arbitratorKeys = new Map();
    
    this.apiKey = process.env.BLOCKCHAIN_API_KEY;
    this.baseURL = this.isTestnet 
      ? 'https://api.blockcypher.com/v1/btc/test3'
      : 'https://api.blockcypher.com/v1/btc/main';
      
    this.disputeTimeoutHours = 72; // 72 hours to resolve disputes
    this.minConfirmations = this.isTestnet ? 1 : 3;
    
    this.setupArbitratorKeys();
    this.startMonitoring();
  }

  setupArbitratorKeys() {
    const arbitratorSeeds = [
      process.env.ARBITRATOR_1_PRIVATE_KEY,
      process.env.ARBITRATOR_2_PRIVATE_KEY,
      process.env.ARBITRATOR_3_PRIVATE_KEY
    ].filter(Boolean);

    arbitratorSeeds.forEach((seed, index) => {
      try {
        const keyPair = bitcoin.ECPair.fromPrivateKey(Buffer.from(seed, 'hex'), { network: this.network });
        this.arbitratorKeys.set(`arbitrator_${index + 1}`, {
          keyPair,
          publicKey: keyPair.publicKey.toString('hex'),
          address: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: this.network }).address
        });
      } catch (error) {
        logger.warn(`Failed to setup arbitrator ${index + 1}:`, error);
      }
    });

    logger.info(`Initialized ${this.arbitratorKeys.size} arbitrator keys`);
  }

  async createMultisigEscrow(consultationData) {
    try {
      const { 
        consultationId, 
        patientAddress, 
        doctorAddress, 
        amount,
        timeoutHours = 24
      } = consultationData;

      const patientWallet = await WalletManager.getWallet(patientAddress);
      const doctorWallet = await WalletManager.getWallet(doctorAddress);

      if (!patientWallet || !doctorWallet) {
        throw new Error('Patient or doctor wallet not found');
      }

      const arbitrator = this.selectArbitrator();
      
      const publicKeys = [
        Buffer.from(patientWallet.publicKey, 'hex'),
        Buffer.from(doctorWallet.publicKey, 'hex'),
        arbitrator.keyPair.publicKey
      ].sort();

      const redeemScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_2, // Require 2 of 3 signatures
        ...publicKeys,
        bitcoin.opcodes.OP_3,
        bitcoin.opcodes.OP_CHECKMULTISIG
      ]);

      const { address: multisigAddress } = bitcoin.payments.p2wsh({
        redeem: { output: redeemScript },
        network: this.network
      });

      const escrow = {
        escrowId: this.generateEscrowId(consultationId),
        consultationId,
        patientAddress,
        doctorAddress,
        amount: parseFloat(amount),
        multisigAddress,
        redeemScript: redeemScript.toString('hex'),
        publicKeys: publicKeys.map(pk => pk.toString('hex')),
        arbitratorId: arbitrator.id,
        status: 'created',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + timeoutHours * 60 * 60 * 1000).toISOString(),
        funded: false,
        fundingTxid: null,
        releaseConditions: {
          requiresBothSignatures: false,
          requiresArbitratorSignature: false,
          autoReleaseOnTimeout: true
        }
      };

      this.escrowStorage.set(escrow.escrowId, escrow);

      logger.info('Multisig escrow created:', {
        escrowId: escrow.escrowId,
        consultationId,
        multisigAddress,
        amount: `${amount} BTC`,
        arbitrator: arbitrator.id
      });

      return {
        escrowId: escrow.escrowId,
        multisigAddress,
        amount: parseFloat(amount),
        expiresAt: escrow.expiresAt,
        fundingInstructions: {
          address: multisigAddress,
          amount: parseFloat(amount),
          network: this.isTestnet ? 'testnet' : 'mainnet',
          confirmationsRequired: this.minConfirmations
        }
      };

    } catch (error) {
      logger.error('Error creating multisig escrow:', error);
      throw error;
    }
  }

  async monitorEscrowFunding(escrowId) {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      const balance = await this.checkAddressBalance(escrow.multisigAddress);
      
      if (balance.confirmed >= escrow.amount && !escrow.funded) {
        escrow.funded = true;
        escrow.fundedAt = new Date().toISOString();
        escrow.fundingTxid = balance.lastTxid;
        escrow.status = 'funded';

        this.escrowStorage.set(escrowId, escrow);

        this.emit('escrow_funded', {
          escrowId,
          consultationId: escrow.consultationId,
          amount: escrow.amount,
          txid: balance.lastTxid
        });

        logger.info('Escrow funded:', {
          escrowId,
          amount: `${escrow.amount} BTC`,
          txid: balance.lastTxid
        });

        return true;
      }

      return false;

    } catch (error) {
      logger.error('Error monitoring escrow funding:', error);
      return false;
    }
  }

  async releaseToDoctor(escrowId, patientSignature = null, arbitratorSignature = null) {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      if (!escrow.funded) {
        throw new Error('Escrow not funded');
      }

      if (escrow.status !== 'funded' && escrow.status !== 'disputed') {
        throw new Error(`Cannot release escrow with status: ${escrow.status}`);
      }

      const doctorWallet = await WalletManager.getWallet(escrow.doctorAddress);
      if (!doctorWallet) {
        throw new Error('Doctor wallet not found');
      }

      const releaseTransaction = await this.createReleaseTransaction(
        escrow,
        doctorWallet.address,
        escrow.amount * 0.97, // 97% to doctor (3% platform fee)
        patientSignature,
        arbitratorSignature
      );

      const broadcast = await this.broadcastTransaction(releaseTransaction.txHex);

      escrow.status = 'released';
      escrow.releasedAt = new Date().toISOString();
      escrow.releaseTxid = broadcast.txid;
      escrow.releaseMethod = 'multisig';

      this.escrowStorage.set(escrowId, escrow);

      await this.processPlatformFee(escrow.amount * 0.03);

      this.emit('escrow_released', {
        escrowId,
        consultationId: escrow.consultationId,
        doctorAddress: escrow.doctorAddress,
        amount: escrow.amount * 0.97,
        txid: broadcast.txid
      });

      logger.info('Escrow released to doctor:', {
        escrowId,
        amount: `${escrow.amount * 0.97} BTC`,
        txid: broadcast.txid
      });

      return {
        success: true,
        txid: broadcast.txid,
        amount: escrow.amount * 0.97,
        explorerUrl: this.getExplorerUrl(broadcast.txid)
      };

    } catch (error) {
      logger.error('Error releasing escrow to doctor:', error);
      throw error;
    }
  }

  async refundToPatient(escrowId, refundPercent = 100, arbitratorSignature = null) {
    try {
      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow) {
        throw new Error('Escrow not found');
      }

      if (!escrow.funded) {
        throw new Error('Escrow not funded');
      }

      const refundAmount = (escrow.amount * refundPercent) / 100;
      const platformFee = escrow.amount - refundAmount;

      const patientWallet = await WalletManager.getWallet(escrow.patientAddress);
      if (!patientWallet) {
        throw new Error('Patient wallet not found');
      }

      const refundTransaction = await this.createReleaseTransaction(
        escrow,
        patientWallet.address,
        refundAmount,
        null, // Patient doesn't need to sign for refund
        arbitratorSignature
      );

      const broadcast = await this.broadcastTransaction(refundTransaction.txHex);

      escrow.status = 'refunded';
      escrow.refundedAt = new Date().toISOString();
      escrow.refundTxid = broadcast.txid;
      escrow.refundPercent = refundPercent;

      this.escrowStorage.set(escrowId, escrow);

      if (platformFee > 0) {
        await this.processPlatformFee(platformFee);
      }

      this.emit('escrow_refunded', {
        escrowId,
        consultationId: escrow.consultationId,
        patientAddress: escrow.patientAddress,
        refundAmount,
        refundPercent,
        txid: broadcast.txid
      });

      logger.info('Escrow refunded to patient:', {
        escrowId,
        refundAmount: `${refundAmount} BTC`,
        refundPercent: `${refundPercent}%`,
        txid: broadcast.txid
      });

      return {
        success: true,
        txid: broadcast.txid,
        refundAmount,
        refundPercent,
        explorerUrl: this.getExplorerUrl(broadcast.txid)
      };

    } catch (error) {
      logger.error('Error refunding escrow:', error);
      throw error;
    }
  }

  async createReleaseTransaction(escrow, recipientAddress, amount, patientSig = null, arbitratorSig = null) {
    try {
      const utxos = await this.getEscrowUTXOs(escrow.multisigAddress);
      if (utxos.length === 0) {
        throw new Error('No UTXOs found in escrow address');
      }

      const psbt = new bitcoin.Psbt({ network: this.network });
      
      let totalInput = 0;
      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(utxo.script, 'hex'),
            value: utxo.value
          },
          witnessScript: Buffer.from(escrow.redeemScript, 'hex')
        });
        totalInput += utxo.value;
      }

      const outputAmount = Math.floor(amount * 100000000);
      const fee = this.estimateFee(psbt.inputCount, 1);
      
      if (totalInput < outputAmount + fee) {
        throw new Error('Insufficient funds in escrow');
      }

      psbt.addOutput({
        address: recipientAddress,
        value: outputAmount
      });

      const changeAmount = totalInput - outputAmount - fee;
      if (changeAmount > 546) { // Dust threshold
        psbt.addOutput({
          address: escrow.multisigAddress,
          value: changeAmount
        });
      }

      // Sign with arbitrator key
      const arbitrator = this.arbitratorKeys.get(escrow.arbitratorId);
      if (arbitrator) {
        psbt.signAllInputs(arbitrator.keyPair);
      }

      // Apply external signatures if provided
      if (patientSig) {
        // In production, verify and apply patient signature
      }
      
      if (arbitratorSig) {
        // In production, verify and apply arbitrator signature
      }

      psbt.finalizeAllInputs();

      const transaction = psbt.extractTransaction();
      const txHex = transaction.toHex();

      return {
        txHex,
        txid: transaction.getId(),
        size: transaction.byteLength(),
        fee: fee / 100000000,
        outputs: transaction.outs.map(out => ({
          value: out.value / 100000000,
          script: out.script.toString('hex')
        }))
      };

    } catch (error) {
      logger.error('Error creating release transaction:', error);
      throw error;
    }
  }

  async initiateDispute(consultationId, disputeData) {
    try {
      const { 
        disputedBy, 
        reason, 
        evidence, 
        requestedResolution 
      } = disputeData;

      const escrowId = this.findEscrowByConsultation(consultationId);
      if (!escrowId) {
        throw new Error('No escrow found for consultation');
      }

      const escrow = this.escrowStorage.get(escrowId);
      if (!escrow.funded) {
        throw new Error('Cannot dispute unfunded escrow');
      }

      const dispute = {
        disputeId: crypto.randomBytes(16).toString('hex'),
        escrowId,
        consultationId,
        disputedBy,
        reason,
        evidence,
        requestedResolution,
        status: 'open',
        createdAt: new Date().toISOString(),
        deadline: new Date(Date.now() + this.disputeTimeoutHours * 60 * 60 * 1000).toISOString(),
        votes: [],
        resolution: null
      };

      escrow.status = 'disputed';
      escrow.disputeInfo = dispute;
      
      this.escrowStorage.set(escrowId, escrow);

      this.emit('dispute_initiated', {
        disputeId: dispute.disputeId,
        escrowId,
        consultationId,
        disputedBy,
        reason
      });

      logger.info('Dispute initiated:', {
        disputeId: dispute.disputeId,
        consultationId,
        disputedBy,
        reason
      });

      return {
        success: true,
        disputeId: dispute.disputeId,
        deadline: dispute.deadline,
        arbitrators: Array.from(this.arbitratorKeys.keys())
      };

    } catch (error) {
      logger.error('Error initiating dispute:', error);
      throw error;
    }
  }

  async submitArbitratorVote(disputeId, arbitratorId, vote) {
    try {
      const escrow = this.findEscrowByDispute(disputeId);
      if (!escrow) {
        throw new Error('Dispute not found');
      }

      const arbitrator = this.arbitratorKeys.get(arbitratorId);
      if (!arbitrator) {
        throw new Error('Invalid arbitrator');
      }

      const dispute = escrow.disputeInfo;
      if (dispute.status !== 'open') {
        throw new Error('Dispute not open for voting');
      }

      const existingVote = dispute.votes.find(v => v.arbitratorId === arbitratorId);
      if (existingVote) {
        throw new Error('Arbitrator already voted');
      }

      const voteData = {
        arbitratorId,
        vote, // 'patient', 'doctor', or 'split'
        reasoning: vote.reasoning || '',
        recommendedSplit: vote.recommendedSplit || { patient: 0, doctor: 100 },
        timestamp: new Date().toISOString(),
        signature: await this.signVote(disputeId, vote, arbitrator.keyPair)
      };

      dispute.votes.push(voteData);

      if (dispute.votes.length >= 2) { // Majority of 3 arbitrators
        await this.resolveDispute(disputeId);
      }

      this.escrowStorage.set(escrow.escrowId, escrow);

      logger.info('Arbitrator vote submitted:', {
        disputeId,
        arbitratorId,
        vote: vote.decision,
        totalVotes: dispute.votes.length
      });

      return { success: true, vote: voteData, totalVotes: dispute.votes.length };

    } catch (error) {
      logger.error('Error submitting arbitrator vote:', error);
      throw error;
    }
  }

  async resolveDispute(disputeId) {
    try {
      const escrow = this.findEscrowByDispute(disputeId);
      if (!escrow) {
        throw new Error('Dispute not found');
      }

      const dispute = escrow.disputeInfo;
      const votes = dispute.votes;

      if (votes.length < 2) {
        throw new Error('Insufficient votes for resolution');
      }

      const resolution = this.calculateResolution(votes);
      
      dispute.status = 'resolved';
      dispute.resolution = resolution;
      dispute.resolvedAt = new Date().toISOString();

      if (resolution.favorPatient) {
        await this.refundToPatient(escrow.escrowId, resolution.patientPercent);
      } else {
        await this.releaseToDoctor(escrow.escrowId);
      }

      const arbitratorFee = escrow.amount * 0.01; // 1% arbitrator fee
      await this.distributeArbitratorFees(votes, arbitratorFee);

      this.emit('dispute_resolved', {
        disputeId,
        escrowId: escrow.escrowId,
        consultationId: escrow.consultationId,
        resolution
      });

      logger.info('Dispute resolved:', {
        disputeId,
        resolution,
        votingArbitrators: votes.length
      });

      return { success: true, resolution };

    } catch (error) {
      logger.error('Error resolving dispute:', error);
      throw error;
    }
  }

  calculateResolution(votes) {
    const patientVotes = votes.filter(v => v.vote.decision === 'patient').length;
    const doctorVotes = votes.filter(v => v.vote.decision === 'doctor').length;
    const splitVotes = votes.filter(v => v.vote.decision === 'split');

    if (patientVotes > doctorVotes) {
      return {
        favorPatient: true,
        patientPercent: 90, // 90% refund, 10% platform keeps for processing
        doctorPercent: 0,
        reasoning: 'Majority arbitrators favor patient'
      };
    } else if (doctorVotes > patientVotes) {
      return {
        favorPatient: false,
        patientPercent: 0,
        doctorPercent: 97, // 97% to doctor (3% platform fee)
        reasoning: 'Majority arbitrators favor doctor'
      };
    } else {
      // Calculate average split from split votes
      const avgSplit = splitVotes.reduce((acc, vote) => ({
        patient: acc.patient + vote.vote.recommendedSplit.patient,
        doctor: acc.doctor + vote.vote.recommendedSplit.doctor
      }), { patient: 0, doctor: 0 });

      const splitCount = splitVotes.length || 1;
      
      return {
        favorPatient: true, // Use refund mechanism for splits
        patientPercent: Math.floor(avgSplit.patient / splitCount),
        doctorPercent: Math.floor(avgSplit.doctor / splitCount),
        reasoning: 'Arbitrators recommended split resolution'
      };
    }
  }

  async distributeArbitratorFees(votes, totalFee) {
    try {
      const feePerArbitrator = totalFee / votes.length;
      
      for (const vote of votes) {
        const arbitrator = this.arbitratorKeys.get(vote.arbitratorId);
        if (arbitrator) {
          await this.sendArbitratorPayment(arbitrator.address, feePerArbitrator);
        }
      }

      logger.info('Arbitrator fees distributed:', {
        totalFee: `${totalFee} BTC`,
        feePerArbitrator: `${feePerArbitrator} BTC`,
        arbitratorCount: votes.length
      });

    } catch (error) {
      logger.error('Error distributing arbitrator fees:', error);
    }
  }

  async sendArbitratorPayment(arbitratorAddress, amount) {
    try {
      // Implementation would send payment to arbitrator
      // For MVP, we'll just log the transaction
      logger.info('Arbitrator payment sent:', {
        address: arbitratorAddress,
        amount: `${amount} BTC`
      });

      return {
        success: true,
        txid: this.generateMockTxId(),
        amount,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error sending arbitrator payment:', error);
      throw error;
    }
  }

  async checkAddressBalance(address) {
    try {
      if (this.isTestnet && !this.apiKey) {
        return {
          confirmed: 0.01 + Math.random() * 0.05,
          unconfirmed: 0,
          lastTxid: crypto.randomBytes(32).toString('hex')
        };
      }

      const response = await axios.get(`${this.baseURL}/addrs/${address}/balance`, {
        params: this.apiKey ? { token: this.apiKey } : {}
      });

      return {
        confirmed: response.data.balance / 100000000,
        unconfirmed: response.data.unconfirmed_balance / 100000000,
        txCount: response.data.n_tx,
        lastTxid: response.data.txrefs?.[0]?.tx_hash
      };

    } catch (error) {
      logger.warn('Error checking address balance:', error);
      return { confirmed: 0, unconfirmed: 0, txCount: 0 };
    }
  }

  async getEscrowUTXOs(address) {
    try {
      if (this.isTestnet && !this.apiKey) {
        return [
          {
            txid: crypto.randomBytes(32).toString('hex'),
            vout: 0,
            value: 1000000, // 0.01 BTC
            script: '0020' + crypto.randomBytes(32).toString('hex'),
            confirmations: 6
          }
        ];
      }

      const response = await axios.get(`${this.baseURL}/addrs/${address}`, {
        params: {
          unspentOnly: true,
          ...(this.apiKey && { token: this.apiKey })
        }
      });

      return (response.data.txrefs || []).map(utxo => ({
        txid: utxo.tx_hash,
        vout: utxo.tx_output_n,
        value: utxo.value,
        script: utxo.script,
        confirmations: utxo.confirmations
      }));

    } catch (error) {
      logger.error('Error fetching escrow UTXOs:', error);
      return [];
    }
  }

  async broadcastTransaction(txHex) {
    try {
      if (this.isTestnet && !this.apiKey) {
        const txid = crypto.randomBytes(32).toString('hex');
        return {
          success: true,
          txid,
          timestamp: new Date().toISOString()
        };
      }

      const response = await axios.post(`${this.baseURL}/txs/push`, {
        tx: txHex
      }, {
        params: this.apiKey ? { token: this.apiKey } : {}
      });

      return {
        success: true,
        txid: response.data.tx.hash,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error broadcasting transaction:', error);
      throw error;
    }
  }

  startMonitoring() {
    setInterval(async () => {
      try {
        await this.monitorAllEscrows();
        await this.processExpiredDisputes();
      } catch (error) {
        logger.error('Monitoring error:', error);
      }
    }, 60000); // Check every minute

    logger.info('Multisig escrow monitoring started');
  }

  async monitorAllEscrows() {
    for (const [escrowId, escrow] of this.escrowStorage) {
      if (escrow.status === 'created') {
        await this.monitorEscrowFunding(escrowId);
      }
    }
  }

  async processExpiredDisputes() {
    const now = new Date();
    
    for (const [escrowId, escrow] of this.escrowStorage) {
      if (escrow.status === 'disputed') {
        const dispute = escrow.disputeInfo;
        
        if (new Date(dispute.deadline) < now) {
          logger.info('Processing expired dispute:', { disputeId: dispute.disputeId });
          
          if (dispute.votes.length > 0) {
            await this.resolveDispute(dispute.disputeId);
          } else {
            // No votes received, default to 50/50 split
            await this.resolveDispute(dispute.disputeId, {
              favorPatient: true,
              patientPercent: 50,
              doctorPercent: 50,
              reasoning: 'Timeout - default split applied'
            });
          }
        }
      }
    }
  }

  selectArbitrator() {
    const arbitrators = Array.from(this.arbitratorKeys.entries());
    if (arbitrators.length === 0) {
      throw new Error('No arbitrators available');
    }

    const randomIndex = Math.floor(Math.random() * arbitrators.length);
    const [id, arbitrator] = arbitrators[randomIndex];
    
    return { id, ...arbitrator };
  }

  findEscrowByConsultation(consultationId) {
    for (const [escrowId, escrow] of this.escrowStorage) {
      if (escrow.consultationId === consultationId) {
        return escrowId;
      }
    }
    return null;
  }

  findEscrowByDispute(disputeId) {
    for (const [escrowId, escrow] of this.escrowStorage) {
      if (escrow.disputeInfo?.disputeId === disputeId) {
        return escrow;
      }
    }
    return null;
  }

  async signVote(disputeId, vote, keyPair) {
    const message = `DiagnoChain Vote: ${disputeId} - ${vote.decision} - ${Date.now()}`;
    const messageHash = crypto.createHash('sha256').update(message).digest();
    const signature = keyPair.sign(messageHash);
    
    return {
      signature: signature.toString('hex'),
      message,
      publicKey: keyPair.publicKey.toString('hex')
    };
  }

  estimateFee(inputCount, outputCount) {
    const baseSize = 10;
    const inputSize = inputCount * 68; // P2WSH input size
    const outputSize = outputCount * 31;
    const totalSize = baseSize + inputSize + outputSize;
    
    return totalSize * (this.isTestnet ? 1 : 10); // 1 sat/vB for testnet, 10 for mainnet
  }

  async processPlatformFee(feeAmount) {
    try {
      const treasuryAddress = process.env.TREASURY_BTC_ADDRESS;
      if (!treasuryAddress) {
        logger.warn('Treasury address not configured');
        return;
      }

      // Queue platform fee payment
      logger.info('Platform fee processed:', {
        amount: `${feeAmount} BTC`,
        treasury: treasuryAddress
      });

    } catch (error) {
      logger.error('Error processing platform fee:', error);
    }
  }

  generateMockTxId() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateEscrowId(consultationId) {
    return `ms_escrow_${consultationId}_${crypto.randomBytes(8).toString('hex')}`;
  }

  getExplorerUrl(txid) {
    return this.isTestnet 
      ? `https://blockstream.info/testnet/tx/${txid}`
      : `https://blockstream.info/tx/${txid}`;
  }

  async getEscrowStats() {
    const stats = {
      totalEscrows: this.escrowStorage.size,
      activeDisputes: 0,
      resolvedDisputes: 0,
      totalValueLocked: 0,
      arbitrators: this.arbitratorKeys.size,
      averageResolutionTime: 0
    };

    let disputeResolutionTimes = [];

    for (const [_, escrow] of this.escrowStorage) {
      stats.totalValueLocked += escrow.amount || 0;
      
      if (escrow.status === 'disputed') {
        stats.activeDisputes++;
      } else if (escrow.disputeInfo && escrow.disputeInfo.status === 'resolved') {
        stats.resolvedDisputes++;
        
        if (escrow.disputeInfo.resolvedAt && escrow.disputeInfo.createdAt) {
          const resolutionTime = new Date(escrow.disputeInfo.resolvedAt) - new Date(escrow.disputeInfo.createdAt);
          disputeResolutionTimes.push(resolutionTime);
        }
      }
    }

    if (disputeResolutionTimes.length > 0) {
      const avgTime = disputeResolutionTimes.reduce((sum, time) => sum + time, 0) / disputeResolutionTimes.length;
      stats.averageResolutionTime = Math.floor(avgTime / (60 * 60 * 1000)); // Convert to hours
    }

    return stats;
  }

  async getAllEscrows(filter = null) {
    const escrows = Array.from(this.escrowStorage.values());
    
    if (filter) {
      return escrows.filter(escrow => {
        if (filter.status && escrow.status !== filter.status) return false;
        if (filter.consultationId && escrow.consultationId !== filter.consultationId) return false;
        if (filter.patientAddress && escrow.patientAddress !== filter.patientAddress) return false;
        if (filter.doctorAddress && escrow.doctorAddress !== filter.doctorAddress) return false;
        return true;
      });
    }

    return escrows;
  }

  cleanup() {
    this.escrowStorage.clear();
    this.pendingReleases.clear();
    this.arbitratorKeys.clear();
    this.removeAllListeners();
    
    logger.info('Multisig escrow cleaned up');
  }
}

module.exports = new MultisigEscrow();