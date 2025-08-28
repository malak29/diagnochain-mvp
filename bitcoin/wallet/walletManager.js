const bitcoin = require('bitcoinjs-lib');
const crypto = require('crypto');
const axios = require('axios');
const bip39 = require('bip39');
const bip32 = require('bip32');

const logger = require('../../backend/src/utils/logger');

class WalletManager {
  constructor() {
    this.network = process.env.BTC_NETWORK === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
    this.isTestnet = process.env.BTC_NETWORK !== 'mainnet';
    
    this.walletStorage = new Map(); // In production, use encrypted database
    this.addressCache = new Map();
    this.transactionCache = new Map();
    
    this.apiKey = process.env.BLOCKCHAIN_API_KEY;
    this.baseURL = this.isTestnet 
      ? 'https://api.blockcypher.com/v1/btc/test3'
      : 'https://api.blockcypher.com/v1/btc/main';
      
    this.derivationPath = "m/84'/1'/0'/0"; // BIP84 - Native SegWit for testnet
    if (!this.isTestnet) {
      this.derivationPath = "m/84'/0'/0'/0"; // Mainnet path
    }
  }

  async createWallet(userAddress, customMnemonic = null) {
    try {
      const mnemonic = customMnemonic || bip39.generateMnemonic(256);
      
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
      }

      const seed = await bip39.mnemonicToSeed(mnemonic);
      const root = bip32.fromSeed(seed, this.network);
      const account = root.derivePath(this.derivationPath);
      
      const { address } = bitcoin.payments.p2wpkh({
        pubkey: account.publicKey,
        network: this.network
      });

      const wallet = {
        userAddress: userAddress.toLowerCase(),
        btcAddress: address,
        publicKey: account.publicKey.toString('hex'),
        privateKeyWIF: account.toWIF(),
        mnemonic: this.encryptMnemonic(mnemonic, userAddress),
        derivationPath: this.derivationPath,
        addressIndex: 0,
        balance: 0,
        unconfirmedBalance: 0,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        transactionCount: 0
      };

      this.walletStorage.set(userAddress.toLowerCase(), wallet);
      this.addressCache.set(address, userAddress.toLowerCase());

      await this.syncWalletBalance(address);

      logger.info('Bitcoin wallet created:', {
        userAddress,
        btcAddress: address,
        network: this.network === bitcoin.networks.testnet ? 'testnet' : 'mainnet',
        addressType: 'P2WPKH'
      });

      return {
        address,
        publicKey: wallet.publicKey,
        network: this.isTestnet ? 'testnet' : 'mainnet',
        balance: wallet.balance,
        createdAt: wallet.createdAt
      };

    } catch (error) {
      logger.error('Error creating wallet:', error);
      throw new Error('Failed to create Bitcoin wallet');
    }
  }

  async importWallet(userAddress, btcAddress, privateKeyWIF = null) {
    try {
      if (!this.isValidBTCAddress(btcAddress)) {
        throw new Error('Invalid Bitcoin address format');
      }

      let publicKey = null;
      let privateKey = null;

      if (privateKeyWIF) {
        try {
          const keyPair = bitcoin.ECPair.fromWIF(privateKeyWIF, this.network);
          const { address: derivedAddress } = bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: this.network
          });

          if (derivedAddress !== btcAddress) {
            throw new Error('Private key does not match provided address');
          }

          publicKey = keyPair.publicKey.toString('hex');
          privateKey = privateKeyWIF;
        } catch (error) {
          throw new Error('Invalid private key or key mismatch');
        }
      }

      const balance = await this.syncWalletBalance(btcAddress);

      const wallet = {
        userAddress: userAddress.toLowerCase(),
        btcAddress,
        publicKey,
        privateKeyWIF: privateKey,
        imported: true,
        balance: balance.confirmed,
        unconfirmedBalance: balance.unconfirmed,
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        transactionCount: balance.txCount || 0
      };

      this.walletStorage.set(userAddress.toLowerCase(), wallet);
      this.addressCache.set(btcAddress, userAddress.toLowerCase());

      logger.info('Bitcoin wallet imported:', {
        userAddress,
        btcAddress,
        hasPrivateKey: !!privateKey,
        balance: balance.confirmed
      });

      return {
        address: btcAddress,
        balance: balance.confirmed,
        imported: true,
        canSpend: !!privateKey
      };

    } catch (error) {
      logger.error('Error importing wallet:', error);
      throw error;
    }
  }

  async getWallet(userAddress) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      
      if (!wallet) {
        return null;
      }

      await this.syncWalletBalance(wallet.btcAddress);
      
      const updatedWallet = this.walletStorage.get(userAddress.toLowerCase());

      return {
        address: updatedWallet.btcAddress,
        balance: updatedWallet.balance,
        unconfirmedBalance: updatedWallet.unconfirmedBalance,
        publicKey: updatedWallet.publicKey,
        canSpend: !!updatedWallet.privateKeyWIF,
        network: this.isTestnet ? 'testnet' : 'mainnet',
        createdAt: updatedWallet.createdAt,
        lastSyncAt: updatedWallet.lastSyncAt,
        transactionCount: updatedWallet.transactionCount
      };

    } catch (error) {
      logger.error('Error getting wallet:', error);
      throw error;
    }
  }

  async syncWalletBalance(btcAddress) {
    try {
      if (this.isTestnet && !this.apiKey) {
        const mockBalance = {
          confirmed: 0.01 + Math.random() * 0.05, // Random testnet balance
          unconfirmed: 0,
          txCount: Math.floor(Math.random() * 10)
        };
        
        const userAddress = this.addressCache.get(btcAddress);
        if (userAddress) {
          const wallet = this.walletStorage.get(userAddress);
          if (wallet) {
            wallet.balance = mockBalance.confirmed;
            wallet.unconfirmedBalance = mockBalance.unconfirmed;
            wallet.transactionCount = mockBalance.txCount;
            wallet.lastSyncAt = new Date().toISOString();
            this.walletStorage.set(userAddress, wallet);
          }
        }
        
        return mockBalance;
      }

      const response = await axios.get(`${this.baseURL}/addrs/${btcAddress}/balance`, {
        params: this.apiKey ? { token: this.apiKey } : {}
      });

      const balance = {
        confirmed: response.data.balance / 100000000,
        unconfirmed: response.data.unconfirmed_balance / 100000000,
        txCount: response.data.n_tx
      };

      const userAddress = this.addressCache.get(btcAddress);
      if (userAddress) {
        const wallet = this.walletStorage.get(userAddress);
        if (wallet) {
          wallet.balance = balance.confirmed;
          wallet.unconfirmedBalance = balance.unconfirmed;
          wallet.transactionCount = balance.txCount;
          wallet.lastSyncAt = new Date().toISOString();
          this.walletStorage.set(userAddress, wallet);
        }
      }

      return balance;

    } catch (error) {
      logger.warn('Error syncing wallet balance:', error);
      return { confirmed: 0, unconfirmed: 0, txCount: 0 };
    }
  }

  async getTransactionHistory(userAddress, limit = 25) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (this.isTestnet && !this.apiKey) {
        return this.generateMockTransactions(wallet.btcAddress, limit);
      }

      const response = await axios.get(`${this.baseURL}/addrs/${wallet.btcAddress}`, {
        params: {
          limit,
          ...(this.apiKey && { token: this.apiKey })
        }
      });

      const transactions = (response.data.txrefs || []).map(tx => ({
        txid: tx.tx_hash,
        type: tx.tx_input_n >= 0 ? 'sent' : 'received',
        amount: tx.value / 100000000,
        confirmations: tx.confirmations,
        timestamp: tx.confirmed,
        blockHeight: tx.block_height,
        fee: tx.fees ? tx.fees / 100000000 : null
      }));

      return transactions;

    } catch (error) {
      logger.error('Error getting transaction history:', error);
      return [];
    }
  }

  async createTransaction(userAddress, recipients, feeRate = 10) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet || !wallet.privateKeyWIF) {
        throw new Error('Wallet not found or cannot spend');
      }

      const utxos = await this.getUTXOs(wallet.btcAddress);
      const keyPair = bitcoin.ECPair.fromWIF(wallet.privateKeyWIF, this.network);

      const psbt = new bitcoin.Psbt({ network: this.network });

      let totalInputAmount = 0;
      let totalOutputAmount = 0;

      recipients.forEach(recipient => {
        totalOutputAmount += Math.floor(recipient.amount * 100000000);
        psbt.addOutput({
          address: recipient.address,
          value: Math.floor(recipient.amount * 100000000)
        });
      });

      for (const utxo of utxos) {
        if (totalInputAmount >= totalOutputAmount + 50000) break; // Reserve for fees
        
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: Buffer.from(utxo.script, 'hex'),
            value: utxo.value
          }
        });
        
        totalInputAmount += utxo.value;
      }

      const estimatedSize = psbt.inputCount * 68 + psbt.txOutputs.length * 31 + 10;
      const fee = estimatedSize * feeRate;

      if (totalInputAmount < totalOutputAmount + fee) {
        throw new Error('Insufficient funds');
      }

      const changeAmount = totalInputAmount - totalOutputAmount - fee;
      if (changeAmount > 546) { // Dust threshold
        const changeAddress = await this.generateChangeAddress(userAddress);
        psbt.addOutput({
          address: changeAddress,
          value: changeAmount
        });
      }

      psbt.signAllInputs(keyPair);
      psbt.finalizeAllInputs();

      const transaction = psbt.extractTransaction();
      const txHex = transaction.toHex();

      logger.info('Transaction created:', {
        txid: transaction.getId(),
        size: estimatedSize,
        fee: fee / 100000000,
        inputCount: psbt.inputCount,
        outputCount: psbt.txOutputs.length
      });

      return {
        txHex,
        txid: transaction.getId(),
        size: estimatedSize,
        fee: fee / 100000000,
        totalInput: totalInputAmount / 100000000,
        totalOutput: totalOutputAmount / 100000000,
        changeAmount: changeAmount / 100000000
      };

    } catch (error) {
      logger.error('Error creating transaction:', error);
      throw error;
    }
  }

  async broadcastTransaction(txHex) {
    try {
      if (this.isTestnet && !this.apiKey) {
        const mockTxid = crypto.randomBytes(32).toString('hex');
        logger.info('Mock transaction broadcast:', { txid: mockTxid });
        
        return {
          success: true,
          txid: mockTxid,
          timestamp: new Date().toISOString()
        };
      }

      const response = await axios.post(`${this.baseURL}/txs/push`, {
        tx: txHex
      }, {
        params: this.apiKey ? { token: this.apiKey } : {}
      });

      const txid = response.data.tx.hash;

      logger.info('Transaction broadcast successfully:', { txid });

      return {
        success: true,
        txid,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error broadcasting transaction:', error);
      throw new Error('Failed to broadcast transaction');
    }
  }

  async getUTXOs(btcAddress) {
    try {
      if (this.isTestnet && !this.apiKey) {
        return [
          {
            txid: crypto.randomBytes(32).toString('hex'),
            vout: 0,
            value: 1000000, // 0.01 BTC in satoshis
            script: '0014' + crypto.randomBytes(20).toString('hex'),
            confirmations: 6
          }
        ];
      }

      const response = await axios.get(`${this.baseURL}/addrs/${btcAddress}`, {
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
      logger.error('Error fetching UTXOs:', error);
      return [];
    }
  }

  async generateChangeAddress(userAddress) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      if (wallet.imported) {
        return wallet.btcAddress;
      }

      const mnemonic = this.decryptMnemonic(wallet.mnemonic, userAddress);
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const root = bip32.fromSeed(seed, this.network);
      
      wallet.addressIndex += 1;
      const changePath = `${this.derivationPath.replace('/0', '/1')}/${wallet.addressIndex}`;
      const changeAccount = root.derivePath(changePath);
      
      const { address } = bitcoin.payments.p2wpkh({
        pubkey: changeAccount.publicKey,
        network: this.network
      });

      this.walletStorage.set(userAddress.toLowerCase(), wallet);

      return address;

    } catch (error) {
      logger.error('Error generating change address:', error);
      throw error;
    }
  }

  async estimateTransactionFee(userAddress, recipients, feeRate = null) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const utxos = await this.getUTXOs(wallet.btcAddress);
      
      let totalAmount = 0;
      recipients.forEach(r => totalAmount += parseFloat(r.amount));

      let inputCount = 0;
      let inputValue = 0;

      for (const utxo of utxos) {
        inputCount++;
        inputValue += utxo.value;
        
        if (inputValue >= totalAmount * 100000000 + 50000) break; // Reserve for fees
      }

      const outputCount = recipients.length + 1; // +1 for potential change

      if (!feeRate) {
        feeRate = await this.getRecommendedFeeRate();
      }

      const estimatedSize = this.estimateTransactionSize(inputCount, outputCount);
      const estimatedFee = estimatedSize * feeRate;

      return {
        estimatedSize,
        estimatedFee: estimatedFee / 100000000, // Convert to BTC
        feeRate,
        inputCount,
        outputCount,
        totalInput: inputValue / 100000000,
        totalOutput: totalAmount,
        change: Math.max(0, (inputValue - totalAmount * 100000000 - estimatedFee) / 100000000)
      };

    } catch (error) {
      logger.error('Error estimating transaction fee:', error);
      throw error;
    }
  }

  estimateTransactionSize(inputCount, outputCount) {
    const baseSize = 10; // Transaction overhead
    const inputSize = inputCount * 68; // P2WPKH input size
    const outputSize = outputCount * 31; // P2WPKH output size
    
    return baseSize + inputSize + outputSize;
  }

  async getRecommendedFeeRate() {
    try {
      if (this.isTestnet) {
        return 1; // 1 sat/vbyte for testnet
      }

      const response = await axios.get('https://mempool.space/api/v1/fees/recommended');
      return response.data.halfHourFee || 10;

    } catch (error) {
      logger.warn('Error getting fee rate, using default:', error);
      return this.isTestnet ? 1 : 10;
    }
  }

  async sendBitcoin(userAddress, recipients, feeRate = null, memo = '') {
    try {
      const transaction = await this.createTransaction(userAddress, recipients, feeRate);
      const broadcast = await this.broadcastTransaction(transaction.txHex);

      const paymentRecord = {
        userAddress,
        txid: transaction.txid,
        recipients,
        fee: transaction.fee,
        memo,
        status: 'pending',
        createdAt: new Date().toISOString(),
        broadcast: broadcast.success
      };

      this.transactionCache.set(transaction.txid, paymentRecord);

      logger.info('Bitcoin payment sent:', {
        from: userAddress,
        txid: transaction.txid,
        recipientCount: recipients.length,
        totalAmount: recipients.reduce((sum, r) => sum + parseFloat(r.amount), 0),
        fee: transaction.fee
      });

      return {
        success: true,
        txid: transaction.txid,
        fee: transaction.fee,
        estimatedConfirmationTime: this.isTestnet ? '10 minutes' : '30 minutes',
        explorerUrl: this.getExplorerUrl(transaction.txid)
      };

    } catch (error) {
      logger.error('Error sending Bitcoin:', error);
      throw error;
    }
  }

  async generateMultipleAddresses(userAddress, count = 10, addressType = 'receiving') {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet || wallet.imported) {
        throw new Error('Cannot generate addresses for imported wallet');
      }

      const mnemonic = this.decryptMnemonic(wallet.mnemonic, userAddress);
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const root = bip32.fromSeed(seed, this.network);

      const addresses = [];
      const basePath = addressType === 'receiving' 
        ? this.derivationPath.replace('/0', '/0')
        : this.derivationPath.replace('/0', '/1');

      for (let i = 0; i < count; i++) {
        const account = root.derivePath(`${basePath}/${wallet.addressIndex + i}`);
        const { address } = bitcoin.payments.p2wpkh({
          pubkey: account.publicKey,
          network: this.network
        });

        addresses.push({
          address,
          index: wallet.addressIndex + i,
          type: addressType,
          publicKey: account.publicKey.toString('hex')
        });
      }

      wallet.addressIndex += count;
      this.walletStorage.set(userAddress.toLowerCase(), wallet);

      logger.info('Generated multiple addresses:', {
        userAddress,
        count,
        type: addressType,
        newIndex: wallet.addressIndex
      });

      return addresses;

    } catch (error) {
      logger.error('Error generating addresses:', error);
      throw error;
    }
  }

  async backupWallet(userAddress) {
    try {
      const wallet = this.walletStorage.get(userAddress.toLowerCase());
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const backup = {
        btcAddress: wallet.btcAddress,
        publicKey: wallet.publicKey,
        network: this.isTestnet ? 'testnet' : 'mainnet',
        derivationPath: wallet.derivationPath,
        addressIndex: wallet.addressIndex,
        createdAt: wallet.createdAt,
        lastSyncAt: wallet.lastSyncAt
      };

      if (!wallet.imported && wallet.mnemonic) {
        const mnemonic = this.decryptMnemonic(wallet.mnemonic, userAddress);
        backup.mnemonic = mnemonic;
        backup.hasPrivateKey = true;
      } else {
        backup.hasPrivateKey = !!wallet.privateKeyWIF;
      }

      logger.info('Wallet backup created:', { userAddress, hasPrivateKey: backup.hasPrivateKey });

      return backup;

    } catch (error) {
      logger.error('Error creating wallet backup:', error);
      throw error;
    }
  }

  async restoreWallet(userAddress, backupData) {
    try {
      if (backupData.mnemonic) {
        return await this.createWallet(userAddress, backupData.mnemonic);
      } else if (backupData.btcAddress && backupData.privateKey) {
        return await this.importWallet(userAddress, backupData.btcAddress, backupData.privateKey);
      } else {
        throw new Error('Invalid backup data');
      }

    } catch (error) {
      logger.error('Error restoring wallet:', error);
      throw error;
    }
  }

  encryptMnemonic(mnemonic, userAddress) {
    const key = crypto.scryptSync(userAddress.toLowerCase(), 'diagnochain-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', key);
    
    let encrypted = cipher.update(mnemonic, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex')
    };
  }

  decryptMnemonic(encryptedData, userAddress) {
    const key = crypto.scryptSync(userAddress.toLowerCase(), 'diagnochain-salt', 32);
    const decipher = crypto.createDecipher('aes-256-gcm', key);
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  generateMockTransactions(address, count) {
    return Array.from({ length: count }, (_, i) => ({
      txid: crypto.randomBytes(32).toString('hex'),
      type: Math.random() > 0.5 ? 'received' : 'sent',
      amount: 0.001 + Math.random() * 0.01,
      confirmations: 6 + Math.floor(Math.random() * 100),
      timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      blockHeight: 700000 + i,
      fee: 0.00001
    }));
  }

  isValidBTCAddress(address) {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (error) {
      return false;
    }
  }

  getExplorerUrl(txid) {
    return this.isTestnet 
      ? `https://blockstream.info/testnet/tx/${txid}`
      : `https://blockstream.info/tx/${txid}`;
  }

  async getWalletStats() {
    const stats = {
      totalWallets: this.walletStorage.size,
      totalAddresses: this.addressCache.size,
      network: this.isTestnet ? 'testnet' : 'mainnet',
      cachedTransactions: this.transactionCache.size,
      lastActivity: new Date().toISOString()
    };

    let totalBalance = 0;
    for (const [userAddress, wallet] of this.walletStorage) {
      totalBalance += wallet.balance || 0;
    }
    
    stats.totalBalance = totalBalance;
    return stats;
  }

  cleanup() {
    this.walletStorage.clear();
    this.addressCache.clear();
    this.transactionCache.clear();
    logger.info('Wallet manager cleaned up');
  }
}

module.exports = new WalletManager();