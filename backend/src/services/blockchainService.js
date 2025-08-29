const Web3 = require('web3');
const crypto = require('crypto');
const { ethers } = require('ethers');
const axios = require('axios');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

class BlockchainService {
  constructor() {
    this.web3 = null;
    this.provider = null;
    this.contracts = {};
    this.chainId = parseInt(process.env.CHAIN_ID || '1337');
    this.initialize();
  }

  async initialize() {
    try {
      const rpcUrl = process.env.WEB3_PROVIDER_URL || 'http://localhost:8545';
      this.web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      
      await this.loadContracts();
      
      logger.info('Blockchain service initialized', {
        chainId: this.chainId,
        rpcUrl: rpcUrl.replace(/\/\/.*@/, '//***@')
      });
      
    } catch (error) {
      logger.error('Failed to initialize blockchain service', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async loadContracts() {
    try {
      const contractConfigs = {
        PatientRegistry: {
          address: process.env.PATIENT_REGISTRY_ADDRESS,
          abiPath: '../contracts/abis/PatientRegistry.json'
        },
        MedicalRecords: {
          address: process.env.MEDICAL_RECORDS_ADDRESS,
          abiPath: '../contracts/abis/MedicalRecords.json'
        },
        AccessControl: {
          address: process.env.ACCESS_CONTROL_ADDRESS,
          abiPath: '../contracts/abis/AccessControl.json'
        },
        PaymentEscrow: {
          address: process.env.PAYMENT_ESCROW_ADDRESS,
          abiPath: '../contracts/abis/PaymentEscrow.json'
        },
        DiagnoToken: {
          address: process.env.DIAGNO_TOKEN_ADDRESS,
          abiPath: '../contracts/abis/DiagnoToken.json'
        }
      };

      for (const [name, config] of Object.entries(contractConfigs)) {
        if (config.address) {
          try {
            const abi = require(config.abiPath);
            this.contracts[name] = {
              web3: new this.web3.eth.Contract(abi, config.address),
              ethers: new ethers.Contract(config.address, abi, this.provider),
              address: config.address,
              abi: abi
            };
            
            logger.info(`Loaded contract: ${name}`, {
              address: config.address
            });
          } catch (contractError) {
            logger.warn(`Failed to load contract: ${name}`, {
              error: contractError.message,
              address: config.address
            });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load contracts', {
        error: error.message
      });
    }
  }

  async validateWalletAddress(address) {
    try {
      if (!this.web3.utils.isAddress(address)) {
        return { isValid: false, reason: 'Invalid address format' };
      }

      const checksumAddress = this.web3.utils.toChecksumAddress(address);
      const balance = await this.web3.eth.getBalance(checksumAddress);
      
      const cacheKey = `wallet_validation:${checksumAddress}`;
      await redisClient.setex(cacheKey, 300, JSON.stringify({
        isValid: true,
        balance: balance,
        timestamp: new Date().toISOString()
      }));

      return {
        isValid: true,
        address: checksumAddress,
        balance: this.web3.utils.fromWei(balance, 'ether')
      };
      
    } catch (error) {
      logger.error('Wallet validation failed', {
        address,
        error: error.message
      });
      return { isValid: false, reason: 'Network error during validation' };
    }
  }

  async verifySignature(walletAddress, message, signature) {
    try {
      const checksumAddress = this.web3.utils.toChecksumAddress(walletAddress);
      const recoveredAddress = this.web3.eth.accounts.recover(message, signature);
      
      const isValid = recoveredAddress.toLowerCase() === checksumAddress.toLowerCase();
      
      if (isValid) {
        const cacheKey = `signature_verification:${crypto.createHash('sha256').update(`${checksumAddress}:${message}:${signature}`).digest('hex')}`;
        await redisClient.setex(cacheKey, 300, 'verified');
      }

      logger.info('Signature verification', {
        address: checksumAddress,
        recoveredAddress,
        isValid,
        messageLength: message.length
      });

      return isValid;
      
    } catch (error) {
      logger.error('Signature verification failed', {
        walletAddress,
        error: error.message,
        signature: signature.substring(0, 10) + '...'
      });
      return false;
    }
  }

  async registerPatient(patientData, signer) {
    try {
      if (!this.contracts.PatientRegistry) {
        throw new Error('PatientRegistry contract not available');
      }

      const { walletAddress, dataHash, ipfsHash, encryptedData } = patientData;
      const contract = this.contracts.PatientRegistry.ethers.connect(signer);

      const gasEstimate = await contract.registerPatient.estimateGas(
        walletAddress,
        dataHash,
        ipfsHash,
        encryptedData
      );

      const tx = await contract.registerPatient(
        walletAddress,
        dataHash,
        ipfsHash,
        encryptedData,
        {
          gasLimit: Math.ceil(gasEstimate * 1.2),
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      logger.info('Patient registration transaction submitted', {
        txHash: tx.hash,
        patientAddress: walletAddress,
        gasLimit: gasEstimate.toString()
      });

      const receipt = await tx.wait();
      
      await this.cacheTransaction(receipt.hash, {
        type: 'patient_registration',
        patientAddress: walletAddress,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Patient registration failed', {
        error: error.message,
        patientAddress: patientData.walletAddress
      });
      throw error;
    }
  }

  async createMedicalRecord(recordData, signer) {
    try {
      if (!this.contracts.MedicalRecords) {
        throw new Error('MedicalRecords contract not available');
      }

      const { patientAddress, doctorAddress, recordHash, ipfsHash, recordType, metadata } = recordData;
      const contract = this.contracts.MedicalRecords.ethers.connect(signer);

      const hasPermission = await this.verifyDoctorPermission(
        patientAddress,
        doctorAddress,
        'write',
        recordType
      );

      if (!hasPermission) {
        throw new Error('Doctor does not have permission to create records for this patient');
      }

      const gasEstimate = await contract.createRecord.estimateGas(
        patientAddress,
        recordHash,
        ipfsHash,
        recordType,
        JSON.stringify(metadata)
      );

      const tx = await contract.createRecord(
        patientAddress,
        recordHash,
        ipfsHash,
        recordType,
        JSON.stringify(metadata),
        {
          gasLimit: Math.ceil(gasEstimate * 1.2),
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      const receipt = await tx.wait();
      
      const logs = receipt.logs.filter(log => 
        log.address.toLowerCase() === this.contracts.MedicalRecords.address.toLowerCase()
      );
      
      let recordId = null;
      if (logs.length > 0) {
        try {
          const decodedLog = this.contracts.MedicalRecords.web3.events.RecordCreated().decode(logs[0]);
          recordId = decodedLog.recordId;
        } catch (decodeError) {
          logger.warn('Failed to decode record creation event', {
            error: decodeError.message,
            txHash: receipt.hash
          });
        }
      }

      await this.cacheTransaction(receipt.hash, {
        type: 'medical_record_creation',
        patientAddress,
        doctorAddress,
        recordId,
        recordType,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        recordId,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Medical record creation failed', {
        error: error.message,
        patientAddress: recordData.patientAddress,
        doctorAddress: recordData.doctorAddress
      });
      throw error;
    }
  }

  async recordAccessGrant(grantData) {
    try {
      if (!this.contracts.AccessControl) {
        throw new Error('AccessControl contract not available');
      }

      const { patientWallet, doctorWallet, permissions, expirationDate, grantId } = grantData;
      
      const adminWallet = new ethers.Wallet(
        process.env.ADMIN_PRIVATE_KEY,
        this.provider
      );
      
      const contract = this.contracts.AccessControl.ethers.connect(adminWallet);

      const permissionBits = this.encodePermissions(permissions);
      const expirationTimestamp = expirationDate ? Math.floor(new Date(expirationDate).getTime() / 1000) : 0;

      const gasEstimate = await contract.grantAccess.estimateGas(
        patientWallet,
        doctorWallet,
        permissionBits,
        expirationTimestamp,
        grantId
      );

      const tx = await contract.grantAccess(
        patientWallet,
        doctorWallet,
        permissionBits,
        expirationTimestamp,
        grantId,
        {
          gasLimit: Math.ceil(gasEstimate * 1.2),
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      const receipt = await tx.wait();

      await this.cacheTransaction(receipt.hash, {
        type: 'access_grant',
        patientWallet,
        doctorWallet,
        permissions,
        grantId,
        expirationDate,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Access grant recording failed', {
        error: error.message,
        grantData
      });
      throw error;
    }
  }

  async revokeAccessGrant(revokeData) {
    try {
      if (!this.contracts.AccessControl) {
        throw new Error('AccessControl contract not available');
      }

      const { patientWallet, doctorWallet, grantId } = revokeData;
      
      const adminWallet = new ethers.Wallet(
        process.env.ADMIN_PRIVATE_KEY,
        this.provider
      );
      
      const contract = this.contracts.AccessControl.ethers.connect(adminWallet);

      const gasEstimate = await contract.revokeAccess.estimateGas(
        patientWallet,
        doctorWallet,
        grantId
      );

      const tx = await contract.revokeAccess(
        patientWallet,
        doctorWallet,
        grantId,
        {
          gasLimit: Math.ceil(gasEstimate * 1.2),
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      const receipt = await tx.wait();

      await this.cacheTransaction(receipt.hash, {
        type: 'access_revoke',
        patientWallet,
        doctorWallet,
        grantId,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Access revocation failed', {
        error: error.message,
        revokeData
      });
      throw error;
    }
  }

  async verifyDoctorPermission(patientAddress, doctorAddress, permission, resourceType = 'all') {
    try {
      if (!this.contracts.AccessControl) {
        logger.warn('AccessControl contract not available, allowing access');
        return true;
      }

      const cacheKey = `permission:${patientAddress}:${doctorAddress}:${permission}:${resourceType}`;
      const cachedResult = await redisClient.get(cacheKey);
      
      if (cachedResult) {
        return JSON.parse(cachedResult).hasPermission;
      }

      const contract = this.contracts.AccessControl.web3;
      const hasPermission = await contract.methods.hasPermission(
        patientAddress,
        doctorAddress,
        this.encodePermission(permission),
        resourceType
      ).call();

      await redisClient.setex(cacheKey, 60, JSON.stringify({
        hasPermission,
        timestamp: new Date().toISOString()
      }));

      return hasPermission;

    } catch (error) {
      logger.error('Permission verification failed', {
        error: error.message,
        patientAddress,
        doctorAddress,
        permission,
        resourceType
      });
      return false;
    }
  }

  async getPatientRecords(patientAddress, doctorAddress = null) {
    try {
      if (!this.contracts.MedicalRecords) {
        throw new Error('MedicalRecords contract not available');
      }

      const cacheKey = `patient_records:${patientAddress}:${doctorAddress || 'self'}`;
      const cachedRecords = await redisClient.get(cacheKey);
      
      if (cachedRecords) {
        return JSON.parse(cachedRecords);
      }

      const contract = this.contracts.MedicalRecords.web3;
      const recordCount = await contract.methods.getPatientRecordCount(patientAddress).call();
      
      const records = [];
      for (let i = 0; i < parseInt(recordCount); i++) {
        try {
          const record = await contract.methods.getPatientRecord(patientAddress, i).call();
          records.push({
            id: record.id,
            recordHash: record.recordHash,
            ipfsHash: record.ipfsHash,
            recordType: record.recordType,
            createdBy: record.createdBy,
            timestamp: new Date(parseInt(record.timestamp) * 1000),
            metadata: JSON.parse(record.metadata || '{}')
          });
        } catch (recordError) {
          logger.warn('Failed to fetch individual record', {
            error: recordError.message,
            patientAddress,
            recordIndex: i
          });
        }
      }

      await redisClient.setex(cacheKey, 300, JSON.stringify(records));

      return records;

    } catch (error) {
      logger.error('Failed to get patient records', {
        error: error.message,
        patientAddress,
        doctorAddress
      });
      throw error;
    }
  }

  async processPayment(paymentData) {
    try {
      if (!this.contracts.PaymentEscrow) {
        throw new Error('PaymentEscrow contract not available');
      }

      const { patientAddress, doctorAddress, amount, paymentType, metadata } = paymentData;
      
      const patientWallet = new ethers.Wallet(
        process.env.PATIENT_PRIVATE_KEY,
        this.provider
      );
      
      const contract = this.contracts.PaymentEscrow.ethers.connect(patientWallet);

      const amountWei = ethers.parseEther(amount.toString());
      
      const gasEstimate = await contract.createPayment.estimateGas(
        doctorAddress,
        paymentType,
        JSON.stringify(metadata),
        { value: amountWei }
      );

      const tx = await contract.createPayment(
        doctorAddress,
        paymentType,
        JSON.stringify(metadata),
        {
          value: amountWei,
          gasLimit: Math.ceil(gasEstimate * 1.2),
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      const receipt = await tx.wait();
      
      let paymentId = null;
      const logs = receipt.logs.filter(log => 
        log.address.toLowerCase() === this.contracts.PaymentEscrow.address.toLowerCase()
      );
      
      if (logs.length > 0) {
        try {
          const decodedLog = this.contracts.PaymentEscrow.web3.events.PaymentCreated().decode(logs[0]);
          paymentId = decodedLog.paymentId;
        } catch (decodeError) {
          logger.warn('Failed to decode payment creation event', {
            error: decodeError.message,
            txHash: receipt.hash
          });
        }
      }

      await this.cacheTransaction(receipt.hash, {
        type: 'payment',
        patientAddress,
        doctorAddress,
        amount: amount.toString(),
        paymentType,
        paymentId,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        paymentId,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      logger.error('Payment processing failed', {
        error: error.message,
        paymentData
      });
      throw error;
    }
  }

  async getTransactionHistory(address, limit = 50, offset = 0) {
    try {
      const cacheKey = `tx_history:${address}:${limit}:${offset}`;
      const cachedHistory = await redisClient.get(cacheKey);
      
      if (cachedHistory) {
        return JSON.parse(cachedHistory);
      }

      const currentBlock = await this.web3.eth.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10000);
      
      const allTransactions = [];

      for (const [contractName, contract] of Object.entries(this.contracts)) {
        try {
          const events = await contract.web3.getPastEvents('allEvents', {
            fromBlock: fromBlock,
            toBlock: 'latest',
            filter: {
              $or: [
                { patient: address },
                { doctor: address },
                { user: address },
                { from: address },
                { to: address }
              ]
            }
          });

          for (const event of events) {
            const block = await this.web3.eth.getBlock(event.blockNumber);
            allTransactions.push({
              contractName,
              eventName: event.event,
              transactionHash: event.transactionHash,
              blockNumber: event.blockNumber,
              blockHash: event.blockHash,
              timestamp: new Date(parseInt(block.timestamp) * 1000),
              gasUsed: event.gasUsed,
              returnValues: event.returnValues,
              address: event.address
            });
          }
        } catch (contractError) {
          logger.warn(`Failed to get events for contract ${contractName}`, {
            error: contractError.message
          });
        }
      }

      allTransactions.sort((a, b) => b.blockNumber - a.blockNumber);
      const paginatedTransactions = allTransactions.slice(offset, offset + limit);

      const result = {
        transactions: paginatedTransactions,
        total: allTransactions.length,
        limit,
        offset
      };

      await redisClient.setex(cacheKey, 60, JSON.stringify(result));

      return result;

    } catch (error) {
      logger.error('Failed to get transaction history', {
        error: error.message,
        address
      });
      throw error;
    }
  }

  async getNetworkStats() {
    try {
      const cacheKey = 'network_stats';
      const cachedStats = await redisClient.get(cacheKey);
      
      if (cachedStats) {
        return JSON.parse(cachedStats);
      }

      const [currentBlock, gasPrice, peerCount] = await Promise.all([
        this.web3.eth.getBlockNumber(),
        this.web3.eth.getGasPrice(),
        this.web3.eth.net.getPeerCount().catch(() => 0)
      ]);

      const latestBlock = await this.web3.eth.getBlock(currentBlock);
      
      const stats = {
        chainId: this.chainId,
        currentBlock: currentBlock,
        blockTimestamp: new Date(parseInt(latestBlock.timestamp) * 1000),
        gasPrice: this.web3.utils.fromWei(gasPrice, 'gwei'),
        peerCount: peerCount,
        networkId: await this.web3.eth.net.getId(),
        isListening: await this.web3.eth.net.isListening(),
        contracts: Object.keys(this.contracts).map(name => ({
          name,
          address: this.contracts[name].address,
          deployed: true
        }))
      };

      await redisClient.setex(cacheKey, 30, JSON.stringify(stats));

      return stats;

    } catch (error) {
      logger.error('Failed to get network stats', {
        error: error.message
      });
      throw error;
    }
  }

  async getOptimalGasPrice() {
    try {
      const cacheKey = 'optimal_gas_price';
      const cachedPrice = await redisClient.get(cacheKey);
      
      if (cachedPrice) {
        return cachedPrice;
      }

      let gasPrice;
      
      if (this.chainId === 1) {
        try {
          const response = await axios.get('https://api.etherscan.io/api?module=gastracker&action=gasoracle');
          if (response.data.status === '1') {
            gasPrice = this.web3.utils.toWei(response.data.result.SafeGasPrice, 'gwei');
          }
        } catch (apiError) {
          logger.warn('Failed to get gas price from API, falling back to network', {
            error: apiError.message
          });
        }
      }
      
      if (!gasPrice) {
        const networkGasPrice = await this.web3.eth.getGasPrice();
        gasPrice = Math.ceil(networkGasPrice * 1.1);
      }

      await redisClient.setex(cacheKey, 60, gasPrice.toString());

      return gasPrice.toString();

    } catch (error) {
      logger.error('Failed to get optimal gas price', {
        error: error.message
      });
      
      return this.web3.utils.toWei('20', 'gwei');
    }
  }

  async estimateTransactionCost(transactionData) {
    try {
      const { contractName, method, params } = transactionData;
      
      if (!this.contracts[contractName]) {
        throw new Error(`Contract ${contractName} not available`);
      }

      const contract = this.contracts[contractName].ethers;
      const gasEstimate = await contract[method].estimateGas(...params);
      const gasPrice = await this.getOptimalGasPrice();
      
      const totalCostWei = gasEstimate * BigInt(gasPrice);
      const totalCostEth = this.web3.utils.fromWei(totalCostWei.toString(), 'ether');
      
      return {
        gasEstimate: gasEstimate.toString(),
        gasPrice: this.web3.utils.fromWei(gasPrice, 'gwei'),
        totalCostWei: totalCostWei.toString(),
        totalCostEth: parseFloat(totalCostEth).toFixed(6)
      };

    } catch (error) {
      logger.error('Failed to estimate transaction cost', {
        error: error.message,
        transactionData
      });
      throw error;
    }
  }

  encodePermissions(permissions) {
    const permissionMap = {
      'read': 1,
      'write': 2,
      'delete': 4,
      'share': 8,
      'admin': 16
    };
    
    return permissions.reduce((bits, permission) => {
      return bits | (permissionMap[permission] || 0);
    }, 0);
  }

  encodePermission(permission) {
    const permissionMap = {
      'read': 1,
      'write': 2,
      'delete': 4,
      'share': 8,
      'admin': 16
    };
    
    return permissionMap[permission] || 0;
  }

  decodePermissions(permissionBits) {
    const permissions = [];
    const permissionMap = {
      1: 'read',
      2: 'write',
      4: 'delete',
      8: 'share',
      16: 'admin'
    };
    
    for (const [bit, permission] of Object.entries(permissionMap)) {
      if (permissionBits & parseInt(bit)) {
        permissions.push(permission);
      }
    }
    
    return permissions;
  }

  async cacheTransaction(txHash, data) {
    try {
      const cacheKey = `transaction:${txHash}`;
      const cacheData = {
        ...data,
        timestamp: new Date().toISOString(),
        cached: true
      };
      
      await redisClient.setex(cacheKey, 86400, JSON.stringify(cacheData));
      
      const typeKey = `transactions:${data.type}`;
      await redisClient.lpush(typeKey, txHash);
      await redisClient.expire(typeKey, 86400);
      
    } catch (error) {
      logger.warn('Failed to cache transaction', {
        error: error.message,
        txHash
      });
    }
  }

  async getTransactionFromCache(txHash) {
    try {
      const cacheKey = `transaction:${txHash}`;
      const cachedData = await redisClient.get(cacheKey);
      
      return cachedData ? JSON.parse(cachedData) : null;
      
    } catch (error) {
      logger.warn('Failed to get cached transaction', {
        error: error.message,
        txHash
      });
      return null;
    }
  }

  async monitorTransactionStatus(txHash) {
    try {
      let attempts = 0;
      const maxAttempts = 60;
      const interval = 5000;

      return new Promise((resolve, reject) => {
        const checkStatus = async () => {
          try {
            const receipt = await this.web3.eth.getTransactionReceipt(txHash);
            
            if (receipt) {
              const status = receipt.status ? 'success' : 'failed';
              
              logger.info('Transaction status confirmed', {
                txHash,
                status,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed
              });
              
              resolve({
                status,
                receipt,
                confirmed: true
              });
              return;
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
              reject(new Error('Transaction confirmation timeout'));
              return;
            }
            
            setTimeout(checkStatus, interval);
            
          } catch (error) {
            if (attempts >= maxAttempts) {
              reject(error);
            } else {
              attempts++;
              setTimeout(checkStatus, interval);
            }
          }
        };

        checkStatus();
      });

    } catch (error) {
      logger.error('Transaction monitoring failed', {
        error: error.message,
        txHash
      });
      throw error;
    }
  }

  async healthCheck() {
    try {
      const [currentBlock, chainId, isListening] = await Promise.all([
        this.web3.eth.getBlockNumber(),
        this.web3.eth.getChainId(),
        this.web3.eth.net.isListening()
      ]);

      const contractsStatus = {};
      for (const [name, contract] of Object.entries(this.contracts)) {
        try {
          await contract.web3.methods.owner ? contract.web3.methods.owner().call() : Promise.resolve();
          contractsStatus[name] = 'healthy';
        } catch (error) {
          contractsStatus[name] = 'unhealthy';
        }
      }

      return {
        status: 'healthy',
        currentBlock,
        chainId,
        isListening,
        contracts: contractsStatus,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Blockchain health check failed', {
        error: error.message
      });
      
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async cleanup() {
    try {
      if (this.web3 && this.web3.currentProvider) {
        if (typeof this.web3.currentProvider.disconnect === 'function') {
          await this.web3.currentProvider.disconnect();
        }
      }
      
      this.contracts = {};
      this.web3 = null;
      this.provider = null;
      
      logger.info('Blockchain service cleanup completed');
      
    } catch (error) {
      logger.error('Blockchain service cleanup failed', {
        error: error.message
      });
    }
  }
}

module.exports = new BlockchainService();