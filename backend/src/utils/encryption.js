const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createCipheriv, createDecipheriv, randomBytes, scrypt } = require('crypto');
const logger = require('./logger');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const HASH_ALGORITHM = 'sha256';
const KEY_DERIVATION_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

class EncryptionService {
  constructor() {
    this.masterKey = this.initializeMasterKey();
    this.keyCache = new Map();
    this.keyRotationInterval = 24 * 60 * 60 * 1000;
  }

  initializeMasterKey() {
    const masterKey = process.env.ENCRYPTION_MASTER_KEY;
    
    if (!masterKey) {
      logger.warn('No master encryption key found in environment variables');
      return this.generateSecureKey(256);
    }

    if (masterKey.length < 64) {
      logger.error('Master encryption key is too short, must be at least 64 characters');
      throw new Error('Invalid master encryption key length');
    }

    return Buffer.from(masterKey, 'hex');
  }

  generateSecureKey(bitLength = 256) {
    const byteLength = bitLength / 8;
    return randomBytes(byteLength);
  }

  generateKeyPair() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      return { publicKey, privateKey };
    } catch (error) {
      logger.error('Failed to generate key pair', { error: error.message });
      throw new Error('Key pair generation failed');
    }
  }

  deriveKey(password, salt, keyLength = 32) {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, keyLength, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) {
          logger.error('Key derivation failed', { error: err.message });
          reject(new Error('Key derivation failed'));
        } else {
          resolve(derivedKey);
        }
      });
    });
  }

  async encryptData(plaintext, password = null) {
    try {
      if (typeof plaintext !== 'string' && !Buffer.isBuffer(plaintext)) {
        plaintext = JSON.stringify(plaintext);
      }

      const salt = randomBytes(SALT_LENGTH);
      const iv = randomBytes(IV_LENGTH);
      
      let encryptionKey;
      if (password) {
        encryptionKey = await this.deriveKey(password, salt);
      } else {
        encryptionKey = this.masterKey.slice(0, 32);
      }

      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();

      const result = {
        encrypted,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        algorithm: ENCRYPTION_ALGORITHM,
        timestamp: new Date().toISOString()
      };

      logger.debug('Data encrypted successfully', {
        dataLength: plaintext.length,
        algorithm: ENCRYPTION_ALGORITHM
      });

      return result;
    } catch (error) {
      logger.error('Encryption failed', {
        error: error.message,
        stack: error.stack
      });
      throw new Error('Data encryption failed');
    }
  }

  async decryptData(encryptedData, password = null) {
    try {
      const { encrypted, salt, iv, tag, algorithm } = encryptedData;
      
      if (algorithm !== ENCRYPTION_ALGORITHM) {
        throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
      }

      const saltBuffer = Buffer.from(salt, 'hex');
      const ivBuffer = Buffer.from(iv, 'hex');
      const tagBuffer = Buffer.from(tag, 'hex');
      
      let decryptionKey;
      if (password) {
        decryptionKey = await this.deriveKey(password, saltBuffer);
      } else {
        decryptionKey = this.masterKey.slice(0, 32);
      }

      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, decryptionKey, ivBuffer);
      decipher.setAuthTag(tagBuffer);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      logger.debug('Data decrypted successfully', {
        dataLength: decrypted.length
      });

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', {
        error: error.message,
        algorithm: encryptedData?.algorithm
      });
      throw new Error('Data decryption failed');
    }
  }

  encryptWithPublicKey(data, publicKey) {
    try {
      const buffer = Buffer.from(JSON.stringify(data), 'utf8');
      const encrypted = crypto.publicEncrypt({
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      }, buffer);

      return {
        encrypted: encrypted.toString('base64'),
        algorithm: 'RSA-OAEP',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Public key encryption failed', {
        error: error.message
      });
      throw new Error('Public key encryption failed');
    }
  }

  decryptWithPrivateKey(encryptedData, privateKey) {
    try {
      const { encrypted } = encryptedData;
      const buffer = Buffer.from(encrypted, 'base64');
      
      const decrypted = crypto.privateDecrypt({
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      }, buffer);

      const result = JSON.parse(decrypted.toString('utf8'));
      
      logger.debug('Private key decryption successful');
      
      return result;
    } catch (error) {
      logger.error('Private key decryption failed', {
        error: error.message
      });
      throw new Error('Private key decryption failed');
    }
  }

  createHash(data, algorithm = HASH_ALGORITHM) {
    try {
      if (typeof data !== 'string') {
        data = JSON.stringify(data);
      }

      const hash = crypto.createHash(algorithm);
      hash.update(data);
      
      const result = hash.digest('hex');
      
      logger.debug('Hash created successfully', {
        algorithm,
        inputLength: data.length,
        outputLength: result.length
      });

      return result;
    } catch (error) {
      logger.error('Hash creation failed', {
        error: error.message,
        algorithm
      });
      throw new Error('Hash creation failed');
    }
  }

  createHMAC(data, secret, algorithm = HASH_ALGORITHM) {
    try {
      if (typeof data !== 'string') {
        data = JSON.stringify(data);
      }

      const hmac = crypto.createHmac(algorithm, secret);
      hmac.update(data);
      
      const result = hmac.digest('hex');
      
      logger.debug('HMAC created successfully', {
        algorithm,
        inputLength: data.length
      });

      return result;
    } catch (error) {
      logger.error('HMAC creation failed', {
        error: error.message,
        algorithm
      });
      throw new Error('HMAC creation failed');
    }
  }

  verifyHMAC(data, signature, secret, algorithm = HASH_ALGORITHM) {
    try {
      const expectedSignature = this.createHMAC(data, secret, algorithm);
      
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );

      logger.debug('HMAC verification completed', {
        isValid,
        algorithm
      });

      return isValid;
    } catch (error) {
      logger.error('HMAC verification failed', {
        error: error.message,
        algorithm
      });
      return false;
    }
  }

  async hashPassword(password, saltRounds = 12) {
    try {
      if (!password || typeof password !== 'string') {
        throw new Error('Password must be a non-empty string');
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      const hashedPassword = await bcrypt.hash(password, saltRounds);
      
      logger.debug('Password hashed successfully', {
        saltRounds,
        passwordLength: password.length
      });

      return hashedPassword;
    } catch (error) {
      logger.error('Password hashing failed', {
        error: error.message,
        passwordLength: password?.length
      });
      throw new Error('Password hashing failed');
    }
  }

  async verifyPassword(password, hashedPassword) {
    try {
      if (!password || !hashedPassword) {
        return false;
      }

      const isValid = await bcrypt.compare(password, hashedPassword);
      
      logger.debug('Password verification completed', {
        isValid
      });

      return isValid;
    } catch (error) {
      logger.error('Password verification failed', {
        error: error.message
      });
      return false;
    }
  }

  generateSecureToken(length = 32) {
    try {
      const token = randomBytes(length).toString('hex');
      
      logger.debug('Secure token generated', {
        length: token.length
      });

      return token;
    } catch (error) {
      logger.error('Secure token generation failed', {
        error: error.message,
        requestedLength: length
      });
      throw new Error('Secure token generation failed');
    }
  }

  generateNonce(length = 16) {
    try {
      const nonce = randomBytes(length).toString('base64');
      
      return nonce;
    } catch (error) {
      logger.error('Nonce generation failed', {
        error: error.message,
        requestedLength: length
      });
      throw new Error('Nonce generation failed');
    }
  }

  createDigitalSignature(data, privateKey) {
    try {
      if (typeof data !== 'string') {
        data = JSON.stringify(data);
      }

      const signature = crypto.sign('sha256', Buffer.from(data), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
      });

      const result = {
        signature: signature.toString('base64'),
        algorithm: 'SHA256withRSA-PSS',
        timestamp: new Date().toISOString()
      };

      logger.debug('Digital signature created', {
        dataLength: data.length
      });

      return result;
    } catch (error) {
      logger.error('Digital signature creation failed', {
        error: error.message
      });
      throw new Error('Digital signature creation failed');
    }
  }

  verifyDigitalSignature(data, signature, publicKey) {
    try {
      if (typeof data !== 'string') {
        data = JSON.stringify(data);
      }

      const signatureBuffer = Buffer.from(signature.signature, 'base64');
      
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(data),
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
        },
        signatureBuffer
      );

      logger.debug('Digital signature verification completed', {
        isValid,
        algorithm: signature.algorithm
      });

      return isValid;
    } catch (error) {
      logger.error('Digital signature verification failed', {
        error: error.message
      });
      return false;
    }
  }

  encryptMedicalRecord(recordData, patientPublicKey) {
    try {
      const recordJson = JSON.stringify(recordData);
      const symmetricKey = this.generateSecureKey(256);
      
      const encryptedRecord = this.encryptWithSymmetricKey(recordJson, symmetricKey);
      const encryptedKey = this.encryptWithPublicKey(symmetricKey.toString('hex'), patientPublicKey);

      return {
        encryptedRecord,
        encryptedKey,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Medical record encryption failed', {
        error: error.message
      });
      throw new Error('Medical record encryption failed');
    }
  }

  decryptMedicalRecord(encryptedData, patientPrivateKey) {
    try {
      const symmetricKey = Buffer.from(
        this.decryptWithPrivateKey(encryptedData.encryptedKey, patientPrivateKey),
        'hex'
      );
      
      const decryptedRecord = this.decryptWithSymmetricKey(
        encryptedData.encryptedRecord,
        symmetricKey
      );

      return JSON.parse(decryptedRecord);
    } catch (error) {
      logger.error('Medical record decryption failed', {
        error: error.message
      });
      throw new Error('Medical record decryption failed');
    }
  }

  encryptWithSymmetricKey(data, key) {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();

      return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        algorithm: ENCRYPTION_ALGORITHM
      };
    } catch (error) {
      logger.error('Symmetric encryption failed', {
        error: error.message
      });
      throw new Error('Symmetric encryption failed');
    }
  }

  decryptWithSymmetricKey(encryptedData, key) {
    try {
      const { encrypted, iv, tag, algorithm } = encryptedData;
      
      const ivBuffer = Buffer.from(iv, 'hex');
      const tagBuffer = Buffer.from(tag, 'hex');
      
      const decipher = createDecipheriv(algorithm, key, ivBuffer);
      decipher.setAuthTag(tagBuffer);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Symmetric decryption failed', {
        error: error.message
      });
      throw new Error('Symmetric decryption failed');
    }
  }

  generateDataIntegrityHash(data) {
    try {
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      const timestamp = new Date().toISOString();
      const nonce = this.generateNonce();
      
      const combined = `${content}|${timestamp}|${nonce}`;
      const hash = this.createHash(combined, 'sha256');
      
      return {
        hash,
        timestamp,
        nonce,
        algorithm: 'sha256'
      };
    } catch (error) {
      logger.error('Data integrity hash generation failed', {
        error: error.message
      });
      throw new Error('Data integrity hash generation failed');
    }
  }

  verifyDataIntegrity(data, integrityData) {
    try {
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      const { timestamp, nonce, algorithm, hash: expectedHash } = integrityData;
      
      const combined = `${content}|${timestamp}|${nonce}`;
      const calculatedHash = this.createHash(combined, algorithm);
      
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedHash, 'hex'),
        Buffer.from(calculatedHash, 'hex')
      );

      logger.debug('Data integrity verification completed', {
        isValid,
        algorithm
      });

      return isValid;
    } catch (error) {
      logger.error('Data integrity verification failed', {
        error: error.message
      });
      return false;
    }
  }

  encryptForBlockchain(data) {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const compressed = this.compressData(dataString);
      const encrypted = this.encryptData(compressed);
      
      return {
        encrypted,
        compressed: true,
        originalSize: dataString.length,
        compressedSize: compressed.length
      };
    } catch (error) {
      logger.error('Blockchain encryption failed', {
        error: error.message
      });
      throw new Error('Blockchain encryption failed');
    }
  }

  decryptFromBlockchain(encryptedData) {
    try {
      const decrypted = this.decryptData(encryptedData.encrypted);
      
      if (encryptedData.compressed) {
        return this.decompressData(decrypted);
      }
      
      return decrypted;
    } catch (error) {
      logger.error('Blockchain decryption failed', {
        error: error.message
      });
      throw new Error('Blockchain decryption failed');
    }
  }

  compressData(data) {
    try {
      const zlib = require('zlib');
      const compressed = zlib.gzipSync(Buffer.from(data, 'utf8'));
      return compressed.toString('base64');
    } catch (error) {
      logger.error('Data compression failed', {
        error: error.message
      });
      throw new Error('Data compression failed');
    }
  }

  decompressData(compressedData) {
    try {
      const zlib = require('zlib');
      const buffer = Buffer.from(compressedData, 'base64');
      const decompressed = zlib.gunzipSync(buffer);
      return decompressed.toString('utf8');
    } catch (error) {
      logger.error('Data decompression failed', {
        error: error.message
      });
      throw new Error('Data decompression failed');
    }
  }

  createSecureSession(userId, metadata = {}) {
    try {
      const sessionData = {
        userId,
        createdAt: new Date().toISOString(),
        nonce: this.generateNonce(),
        metadata
      };

      const encrypted = this.encryptData(sessionData);
      const sessionId = this.generateSecureToken();

      return {
        sessionId,
        encryptedSession: encrypted,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };
    } catch (error) {
      logger.error('Secure session creation failed', {
        error: error.message,
        userId
      });
      throw new Error('Secure session creation failed');
    }
  }

  validateSecureSession(sessionId, encryptedSession) {
    try {
      const decryptedData = this.decryptData(encryptedSession);
      const sessionData = JSON.parse(decryptedData);

      if (!sessionData.userId || !sessionData.createdAt || !sessionData.nonce) {
        throw new Error('Invalid session data structure');
      }

      const createdAt = new Date(sessionData.createdAt);
      const expirationTime = 24 * 60 * 60 * 1000;
      
      if (Date.now() - createdAt.getTime() > expirationTime) {
        throw new Error('Session expired');
      }

      return sessionData;
    } catch (error) {
      logger.error('Session validation failed', {
        error: error.message,
        sessionId
      });
      return null;
    }
  }

  rotateKeys() {
    try {
      this.keyCache.clear();
      
      const newKeyPair = this.generateKeyPair();
      
      logger.info('Key rotation completed', {
        timestamp: new Date().toISOString()
      });

      return newKeyPair;
    } catch (error) {
      logger.error('Key rotation failed', {
        error: error.message
      });
      throw new Error('Key rotation failed');
    }
  }

  secureDelete(data) {
    try {
      if (Buffer.isBuffer(data)) {
        crypto.randomFillSync(data);
        return true;
      }
      
      if (typeof data === 'string') {
        const buffer = Buffer.from(data, 'utf8');
        crypto.randomFillSync(buffer);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Secure deletion failed', {
        error: error.message
      });
      return false;
    }
  }

  validateEncryptionStrength(algorithm, keyLength) {
    const minimumStrengths = {
      'aes-256-gcm': 256,
      'aes-192-gcm': 192,
      'aes-128-gcm': 128,
      'rsa': 2048
    };

    const requiredLength = minimumStrengths[algorithm.toLowerCase()];
    
    if (!requiredLength) {
      logger.warn('Unknown encryption algorithm', { algorithm });
      return false;
    }

    const isStrong = keyLength >= requiredLength;
    
    logger.debug('Encryption strength validation', {
      algorithm,
      keyLength,
      requiredLength,
      isStrong
    });

    return isStrong;
  }
}

module.exports = new EncryptionService();