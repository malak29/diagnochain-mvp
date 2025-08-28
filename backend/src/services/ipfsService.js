const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const logger = require('../utils/logger');

class IPFSService {
  constructor() {
    this.pinataApiKey = process.env.PINATA_API_KEY;
    this.pinataSecretKey = process.env.PINATA_SECRET_KEY;
    this.infuraProjectId = process.env.INFURA_PROJECT_ID;
    this.infuraSecret = process.env.INFURA_SECRET;
    
    this.pinataBaseUrl = 'https://api.pinata.cloud';
    this.infuraBaseUrl = 'https://ipfs.infura.io:5001/api/v0';
    this.publicGateway = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
    
    this.useLocalIPFS = process.env.USE_LOCAL_IPFS === 'true';
    this.localIPFSUrl = process.env.LOCAL_IPFS_URL || 'http://localhost:5001';
    
    this.encryptionAlgorithm = 'aes-256-gcm';
    this.keyDerivationIterations = 100000;
    
    this.mockStorage = new Map(); // For development without actual IPFS
  }

  async uploadEncryptedData(data, recipientPublicKey = null) {
    try {
      const jsonData = JSON.stringify(data, null, 0);
      const encryptedData = await this.encryptData(jsonData, recipientPublicKey);
      
      const metadata = {
        name: `DiagnoChain-${data.type || 'medical-data'}-${Date.now()}`,
        description: 'Encrypted medical data for DiagnoChain platform',
        attributes: {
          encrypted: true,
          dataType: data.type || 'medical',
          timestamp: new Date().toISOString(),
          version: '1.0'
        }
      };

      const uploadData = {
        encryptedContent: encryptedData,
        metadata
      };

      let ipfsHash;
      
      if (this.useLocalIPFS) {
        ipfsHash = await this.uploadToLocalIPFS(uploadData);
      } else if (this.pinataApiKey) {
        ipfsHash = await this.uploadToPinata(uploadData);
      } else if (this.infuraProjectId) {
        ipfsHash = await this.uploadToInfura(uploadData);
      } else {
        ipfsHash = await this.uploadToMockStorage(uploadData);
      }

      logger.info('Data uploaded to IPFS:', {
        hash: ipfsHash,
        dataType: data.type,
        encrypted: true,
        size: jsonData.length
      });

      return {
        hash: ipfsHash,
        encrypted: true,
        metadata,
        uploadedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error uploading encrypted data:', error);
      throw new Error('Failed to upload data to IPFS');
    }
  }

  async downloadAndDecryptData(ipfsHash, privateKey = null) {
    try {
      let encryptedData;
      
      if (this.useLocalIPFS) {
        encryptedData = await this.downloadFromLocalIPFS(ipfsHash);
      } else if (this.mockStorage.has(ipfsHash)) {
        encryptedData = this.mockStorage.get(ipfsHash);
      } else {
        encryptedData = await this.downloadFromGateway(ipfsHash);
      }

      if (!encryptedData || !encryptedData.encryptedContent) {
        throw new Error('No encrypted content found');
      }

      const decryptedJson = await this.decryptData(encryptedData.encryptedContent, privateKey);
      const originalData = JSON.parse(decryptedJson);

      logger.info('Data downloaded and decrypted from IPFS:', {
        hash: ipfsHash,
        dataType: originalData.type || 'unknown'
      });

      return {
        data: originalData,
        metadata: encryptedData.metadata,
        downloadedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error downloading/decrypting data:', error);
      throw new Error('Failed to retrieve data from IPFS');
    }
  }

  async uploadToPinata(data) {
    try {
      const formData = new FormData();
      const jsonBuffer = Buffer.from(JSON.stringify(data));
      
      formData.append('file', jsonBuffer, {
        filename: 'medical-data.json',
        contentType: 'application/json'
      });

      const pinataMetadata = JSON.stringify({
        name: data.metadata.name,
        keyvalues: data.metadata.attributes
      });
      formData.append('pinataMetadata', pinataMetadata);

      const response = await axios.post(`${this.pinataBaseUrl}/pinning/pinFileToIPFS`, formData, {
        headers: {
          ...formData.getHeaders(),
          'pinata_api_key': this.pinataApiKey,
          'pinata_secret_api_key': this.pinataSecretKey
        },
        timeout: 30000
      });

      return response.data.IpfsHash;

    } catch (error) {
      logger.error('Pinata upload error:', error);
      throw new Error('Failed to upload to Pinata');
    }
  }

  async uploadToInfura(data) {
    try {
      const auth = Buffer.from(`${this.infuraProjectId}:${this.infuraSecret}`).toString('base64');
      
      const formData = new FormData();
      formData.append('file', JSON.stringify(data));

      const response = await axios.post(`${this.infuraBaseUrl}/add`, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Basic ${auth}`
        }
      });

      return response.data.Hash;

    } catch (error) {
      logger.error('Infura upload error:', error);
      throw new Error('Failed to upload to Infura IPFS');
    }
  }

  async uploadToLocalIPFS(data) {
    try {
      const formData = new FormData();
      formData.append('file', JSON.stringify(data));

      const response = await axios.post(`${this.localIPFSUrl}/api/v0/add`, formData, {
        headers: formData.getHeaders()
      });

      return response.data.Hash;

    } catch (error) {
      logger.error('Local IPFS upload error:', error);
      throw new Error('Failed to upload to local IPFS');
    }
  }

  async uploadToMockStorage(data) {
    const hash = 'Qm' + crypto.randomBytes(22).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 44);
    this.mockStorage.set(hash, data);
    
    logger.info('Data stored in mock IPFS:', { hash });
    return hash;
  }

  async downloadFromGateway(ipfsHash) {
    const gateways = [
      `${this.publicGateway}/${ipfsHash}`,
      `https://ipfs.io/ipfs/${ipfsHash}`,
      `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
      `https://gateway.ipfs.io/ipfs/${ipfsHash}`
    ];

    for (const gateway of gateways) {
      try {
        const response = await axios.get(gateway, {
          timeout: 15000,
          headers: { 'Accept': 'application/json' }
        });
        
        return response.data;
      } catch (error) {
        logger.warn(`Gateway ${gateway} failed:`, error.message);
        continue;
      }
    }

    throw new Error('Failed to download from all IPFS gateways');
  }

  async downloadFromLocalIPFS(ipfsHash) {
    try {
      const response = await axios.post(`${this.localIPFSUrl}/api/v0/cat?arg=${ipfsHash}`);
      return response.data;
    } catch (error) {
      logger.error('Local IPFS download error:', error);
      throw new Error('Failed to download from local IPFS');
    }
  }

  async encryptData(data, publicKey = null) {
    try {
      const key = publicKey ? 
        crypto.pbkdf2Sync(publicKey, 'diagnochain-salt', this.keyDerivationIterations, 32, 'sha256') :
        crypto.randomBytes(32);
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.encryptionAlgorithm, key);
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag ? cipher.getAuthTag().toString('hex') : '';

      return {
        encryptedData: encrypted,
        iv: iv.toString('hex'),
        authTag,
        algorithm: this.encryptionAlgorithm,
        keyDerivation: publicKey ? 'pbkdf2' : 'random'
      };

    } catch (error) {
      logger.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  async decryptData(encryptedObj, privateKey = null) {
    try {
      const key = privateKey ? 
        crypto.pbkdf2Sync(privateKey, 'diagnochain-salt', this.keyDerivationIterations, 32, 'sha256') :
        Buffer.from(encryptedObj.key || '', 'hex');

      const decipher = crypto.createDecipher(encryptedObj.algorithm || this.encryptionAlgorithm, key);
      
      if (encryptedObj.authTag && decipher.setAuthTag) {
        decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));
      }

      let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;

    } catch (error) {
      logger.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  async pinContent(ipfsHash) {
    try {
      if (!this.pinataApiKey) {
        logger.warn('Pinata credentials not configured, skipping pin');
        return { success: false, message: 'Pinning service not available' };
      }

      const response = await axios.post(`${this.pinataBaseUrl}/pinning/pinByHash`, {
        hashToPin: ipfsHash
      }, {
        headers: {
          'pinata_api_key': this.pinataApiKey,
          'pinata_secret_api_key': this.pinataSecretKey
        }
      });

      logger.info('Content pinned:', { hash: ipfsHash });
      return { success: true, pinned: true };

    } catch (error) {
      logger.error('Pinning error:', error);
      return { success: false, error: error.message };
    }
  }

  async unpinContent(ipfsHash) {
    try {
      if (!this.pinataApiKey) {
        return { success: false, message: 'Pinning service not available' };
      }

      await axios.delete(`${this.pinataBaseUrl}/pinning/unpin/${ipfsHash}`, {
        headers: {
          'pinata_api_key': this.pinataApiKey,
          'pinata_secret_api_key': this.pinataSecretKey
        }
      });

      logger.info('Content unpinned:', { hash: ipfsHash });
      return { success: true };

    } catch (error) {
      logger.error('Unpinning error:', error);
      return { success: false, error: error.message };
    }
  }

  async getStorageStats() {
    try {
      const stats = {
        provider: this.useLocalIPFS ? 'local' : this.pinataApiKey ? 'pinata' : 'infura',
        network: process.env.IPFS_NETWORK || 'mainnet',
        mockEntries: this.mockStorage.size,
        lastActivity: new Date().toISOString()
      };

      if (this.pinataApiKey) {
        try {
          const response = await axios.get(`${this.pinataBaseUrl}/data/userPinnedDataTotal`, {
            headers: {
              'pinata_api_key': this.pinataApiKey,
              'pinata_secret_api_key': this.pinataSecretKey
            }
          });
          
          stats.pinata = {
            pinCount: response.data.pin_count,
            totalSize: response.data.pin_size_total
          };
        } catch (error) {
          logger.warn('Failed to fetch Pinata stats:', error);
        }
      }

      return stats;

    } catch (error) {
      logger.error('Error fetching storage stats:', error);
      return {
        provider: 'unknown',
        error: error.message
      };
    }
  }

  generateIPFSUrl(hash) {
    return `${this.publicGateway}/${hash}`;
  }

  async validateHash(hash) {
    const ipfsHashRegex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
    return ipfsHashRegex.test(hash);
  }
}

module.exports = new IPFSService();