const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const User = require('../models/User');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const blockchainService = require('./blockchainService');

class AuthService {
  generateTokens(user, sessionId = null) {
    try {
      const currentSessionId = sessionId || crypto.randomUUID();
      
      const payload = {
        userId: user._id.toString(),
        email: user.email,
        userType: user.userType,
        walletAddress: user.walletAddress,
        sessionId: currentSessionId,
        iat: Math.floor(Date.now() / 1000)
      };

      const accessToken = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { 
          expiresIn: '15m',
          issuer: 'diagnochain',
          audience: 'diagnochain-users'
        }
      );

      const refreshToken = jwt.sign(
        { 
          userId: user._id.toString(),
          sessionId: currentSessionId,
          type: 'refresh'
        },
        process.env.JWT_REFRESH_SECRET,
        { 
          expiresIn: '30d',
          issuer: 'diagnochain',
          audience: 'diagnochain-users'
        }
      );

      return { accessToken, refreshToken, sessionId: currentSessionId };
      
    } catch (error) {
      logger.error('Token generation failed', {
        error: error.message,
        userId: user._id
      });
      throw new Error('Failed to generate authentication tokens');
    }
  }

  async verifyToken(token, secret = process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, secret, {
        issuer: 'diagnochain',
        audience: 'diagnochain-users'
      });
      
      const sessionExists = await redisClient.exists(`session:${decoded.sessionId}`);
      
      if (!sessionExists) {
        throw new Error('Session expired or invalid');
      }
      
      return decoded;
      
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  async revokeToken(userId, sessionId) {
    try {
      await redisClient.del(`session:${sessionId}`);
      await redisClient.del(`refresh:${userId}:${sessionId}`);
      
      logger.info('Token revoked successfully', {
        userId,
        sessionId
      });
      
      return true;
      
    } catch (error) {
      logger.error('Token revocation failed', {
        error: error.message,
        userId,
        sessionId
      });
      return false;
    }
  }

  async revokeAllTokens(userId) {
    try {
      const sessionPattern = `session:*`;
      const refreshPattern = `refresh:${userId}:*`;
      
      const sessionKeys = await redisClient.keys(sessionPattern);
      const refreshKeys = await redisClient.keys(refreshPattern);
      
      const userSessions = [];
      for (const key of sessionKeys) {
        const sessionData = await redisClient.get(key);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.userId === userId) {
            userSessions.push(key);
          }
        }
      }
      
      const allKeys = [...userSessions, ...refreshKeys];
      if (allKeys.length > 0) {
        await redisClient.del(...allKeys);
      }
      
      logger.info('All tokens revoked for user', {
        userId,
        revokedSessions: userSessions.length
      });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to revoke all tokens', {
        error: error.message,
        userId
      });
      return false;
    }
  }

  async generatePasswordResetToken(email) {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      
      if (!user) {
        logger.warn('Password reset attempted for non-existent email', { email });
        return { success: true };
      }
      
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpiry = new Date(Date.now() + 30 * 60 * 1000);
      
      user.passwordReset = {
        token: resetToken,
        expiresAt: resetExpiry,
        isUsed: false,
        requestedAt: new Date(),
        requestedFrom: null
      };
      
      await user.save();
      
      await emailService.sendPasswordResetEmail(email, resetToken);
      
      logger.info('Password reset token generated', {
        userId: user._id,
        email: user.email
      });
      
      return { success: true };
      
    } catch (error) {
      logger.error('Password reset token generation failed', {
        error: error.message,
        email
      });
      throw error;
    }
  }

  async hashPassword(password) {
    try {
      const saltRounds = 12;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      logger.error('Password hashing failed', { error: error.message });
      throw new Error('Failed to hash password');
    }
  }

  async comparePassword(password, hashedPassword) {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      logger.error('Password comparison failed', { error: error.message });
      throw new Error('Failed to compare password');
    }
  }

  async setupTwoFactor(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (user.security.twoFactorEnabled) {
        throw new Error('Two-factor authentication already enabled');
      }
      
      const secret = speakeasy.generateSecret({
        name: `DiagnoChain (${user.email})`,
        issuer: 'DiagnoChain',
        length: 32
      });
      
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      
      user.security.twoFactorSecret = secret.base32;
      user.security.twoFactorBackupCodes = this.generateBackupCodes();
      await user.save();
      
      return {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        backupCodes: user.security.twoFactorBackupCodes
      };
      
    } catch (error) {
      logger.error('Two-factor setup failed', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  async verifyTwoFactor(userId, token) {
    try {
      const user = await User.findById(userId);
      
      if (!user || !user.security.twoFactorEnabled) {
        throw new Error('Two-factor authentication not enabled');
      }
      
      const isValid = speakeasy.totp.verify({
        secret: user.security.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 1
      });
      
      if (!isValid) {
        const isBackupCode = user.security.twoFactorBackupCodes.includes(token);
        
        if (isBackupCode) {
          user.security.twoFactorBackupCodes = user.security.twoFactorBackupCodes.filter(
            code => code !== token
          );
          await user.save();
          
          logger.info('Two-factor verified with backup code', {
            userId,
            backupCodesRemaining: user.security.twoFactorBackupCodes.length
          });
          
          return true;
        }
        
        return false;
      }
      
      return true;
      
    } catch (error) {
      logger.error('Two-factor verification failed', {
        error: error.message,
        userId
      });
      return false;
    }
  }

  generateBackupCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
      codes.push(formattedCode);
    }
    return codes;
  }

  async createApiKey(userId, name, permissions = []) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      const keyId = crypto.randomUUID();
      const keySecret = crypto.randomBytes(32).toString('hex');
      const keyPrefix = 'dk_';
      const apiKey = `${keyPrefix}${keySecret}`;
      
      const hashedKey = await bcrypt.hash(apiKey, 10);
      
      const keyData = {
        id: keyId,
        name: name.trim(),
        hashedKey,
        permissions,
        createdAt: new Date(),
        lastUsed: null,
        isActive: true,
        usageCount: 0
      };
      
      user.apiKeys = user.apiKeys || [];
      user.apiKeys.push(keyData);
      await user.save();
      
      logger.info('API key created', {
        userId,
        keyId,
        keyName: name,
        permissions
      });
      
      return {
        keyId,
        apiKey,
        name,
        permissions,
        createdAt: keyData.createdAt
      };
      
    } catch (error) {
      logger.error('API key creation failed', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  async validateApiKey(apiKey) {
    try {
      if (!apiKey || !apiKey.startsWith('dk_')) {
        return null;
      }
      
      const users = await User.find({ 'apiKeys.isActive': true });
      
      for (const user of users) {
        for (const key of user.apiKeys) {
          if (key.isActive && await bcrypt.compare(apiKey, key.hashedKey)) {
            key.lastUsed = new Date();
            key.usageCount += 1;
            await user.save();
            
            return {
              userId: user._id,
              keyId: key.id,
              permissions: key.permissions,
              userType: user.userType
            };
          }
        }
      }
      
      return null;
      
    } catch (error) {
      logger.error('API key validation failed', {
        error: error.message
      });
      return null;
    }
  }

  async createAccessGrant(patientId, doctorWalletAddress, permissions, expirationDate = null) {
    try {
      const patient = await User.findById(patientId);
      const doctor = await User.findOne({ 
        walletAddress: doctorWalletAddress.toLowerCase(),
        userType: 'doctor'
      });
      
      if (!patient || !doctor) {
        throw new Error('Patient or doctor not found');
      }
      
      const grantId = crypto.randomUUID();
      const signatureMessage = `Grant access to ${doctorWalletAddress} for patient ${patientId} with permissions ${permissions.join(',')} until ${expirationDate || 'indefinite'}`;
      
      const grantData = {
        id: grantId,
        patientId: patient._id,
        doctorId: doctor._id,
        doctorWalletAddress: doctor.walletAddress,
        permissions,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        createdAt: new Date(),
        isActive: true,
        signatureMessage,
        revokedAt: null,
        accessCount: 0
      };
      
      patient.accessGrants = patient.accessGrants || [];
      patient.accessGrants.push(grantData);
      await patient.save();
      
      const blockchainResult = await blockchainService.recordAccessGrant({
        patientWallet: patient.walletAddress,
        doctorWallet: doctor.walletAddress,
        permissions,
        expirationDate,
        grantId
      });
      
      logger.info('Access grant created', {
        grantId,
        patientId: patient._id,
        doctorId: doctor._id,
        permissions,
        blockchainTx: blockchainResult.transactionHash
      });
      
      return {
        grantId,
        permissions,
        expirationDate,
        createdAt: grantData.createdAt,
        blockchainTx: blockchainResult.transactionHash
      };
      
    } catch (error) {
      logger.error('Access grant creation failed', {
        error: error.message,
        patientId,
        doctorWalletAddress
      });
      throw error;
    }
  }

  async validateAccess(patientId, doctorId, requiredPermission) {
    try {
      const patient = await User.findById(patientId);
      
      if (!patient) {
        return { hasAccess: false, reason: 'Patient not found' };
      }
      
      if (patient._id.toString() === doctorId) {
        return { hasAccess: true, reason: 'Self-access' };
      }
      
      const activeGrants = patient.accessGrants?.filter(grant => 
        grant.isActive && 
        grant.doctorId.toString() === doctorId &&
        (!grant.expirationDate || grant.expirationDate > new Date()) &&
        grant.permissions.includes(requiredPermission)
      ) || [];
      
      if (activeGrants.length === 0) {
        return { hasAccess: false, reason: 'No valid access grant' };
      }
      
      const grant = activeGrants[0];
      grant.accessCount += 1;
      grant.lastAccessed = new Date();
      await patient.save();
      
      await this.logAccess({
        patientId,
        doctorId,
        permission: requiredPermission,
        grantId: grant.id,
        success: true
      });
      
      return { 
        hasAccess: true, 
        grantId: grant.id,
        permissions: grant.permissions
      };
      
    } catch (error) {
      logger.error('Access validation failed', {
        error: error.message,
        patientId,
        doctorId,
        requiredPermission
      });
      
      await this.logAccess({
        patientId,
        doctorId,
        permission: requiredPermission,
        success: false,
        error: error.message
      });
      
      return { hasAccess: false, reason: 'Validation error' };
    }
  }

  async revokeAccess(patientId, doctorWalletAddress, revokedBy) {
    try {
      const patient = await User.findById(patientId);
      const doctor = await User.findOne({ 
        walletAddress: doctorWalletAddress.toLowerCase() 
      });
      
      if (!patient || !doctor) {
        throw new Error('Patient or doctor not found');
      }
      
      const grant = patient.accessGrants?.find(grant => 
        grant.isActive && 
        grant.doctorWalletAddress === doctor.walletAddress
      );
      
      if (!grant) {
        throw new Error('No active access grant found');
      }
      
      grant.isActive = false;
      grant.revokedAt = new Date();
      grant.revokedBy = revokedBy;
      
      await patient.save();
      
      const blockchainResult = await blockchainService.revokeAccessGrant({
        patientWallet: patient.walletAddress,
        doctorWallet: doctor.walletAddress,
        grantId: grant.id
      });
      
      await this.logAccess({
        patientId,
        doctorId: doctor._id,
        action: 'revoke',
        grantId: grant.id,
        success: true,
        revokedBy
      });
      
      logger.info('Access grant revoked', {
        grantId: grant.id,
        patientId,
        doctorId: doctor._id,
        revokedBy,
        blockchainTx: blockchainResult.transactionHash
      });
      
      return {
        grantId: grant.id,
        revokedAt: grant.revokedAt,
        blockchainTx: blockchainResult.transactionHash
      };
      
    } catch (error) {
      logger.error('Access revocation failed', {
        error: error.message,
        patientId,
        doctorWalletAddress,
        revokedBy
      });
      throw error;
    }
  }

  async logAccess({ patientId, doctorId, action = 'access', permission, grantId, success, error, revokedBy }) {
    try {
      const logEntry = {
        patientId,
        doctorId,
        action,
        permission,
        grantId,
        success,
        error: error || null,
        revokedBy: revokedBy || null,
        timestamp: new Date(),
        id: crypto.randomUUID()
      };
      
      const logKey = `access_log:${patientId}:${Date.now()}`;
      await redisClient.setex(logKey, 90 * 24 * 60 * 60, JSON.stringify(logEntry));
      
      return logEntry;
      
    } catch (logError) {
      logger.error('Access logging failed', {
        error: logError.message,
        originalError: error
      });
    }
  }

  async getAccessLogs(patientId, options = {}) {
    try {
      const { startDate, endDate, action, limit = 50 } = options;
      
      const pattern = `access_log:${patientId}:*`;
      const keys = await redisClient.keys(pattern);
      
      const logs = [];
      for (const key of keys) {
        const logData = await redisClient.get(key);
        if (logData) {
          const log = JSON.parse(logData);
          
          if (startDate && new Date(log.timestamp) < new Date(startDate)) continue;
          if (endDate && new Date(log.timestamp) > new Date(endDate)) continue;
          if (action && log.action !== action) continue;
          
          logs.push(log);
        }
      }
      
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return logs.slice(0, limit);
      
    } catch (error) {
      logger.error('Failed to retrieve access logs', {
        error: error.message,
        patientId
      });
      throw error;
    }
  }

  async verifyWalletSignature(walletAddress, message, signature) {
    try {
      return await blockchainService.verifySignature(walletAddress, message, signature);
    } catch (error) {
      logger.error('Wallet signature verification failed', {
        error: error.message,
        walletAddress
      });
      return false;
    }
  }

  async createSigningMessage(walletAddress) {
    try {
      const timestamp = Date.now();
      const nonce = crypto.randomBytes(16).toString('hex');
      
      const message = `DiagnoChain Login\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}\n\nBy signing this message, you confirm your identity and agree to our Terms of Service.`;
      
      const messageKey = `signin_message:${walletAddress}`;
      await redisClient.setex(messageKey, 5 * 60, JSON.stringify({
        message,
        timestamp,
        nonce
      }));
      
      return { message, timestamp, nonce };
      
    } catch (error) {
      logger.error('Signing message creation failed', {
        error: error.message,
        walletAddress
      });
      throw error;
    }
  }

  async validateSigningMessage(walletAddress, message) {
    try {
      const messageKey = `signin_message:${walletAddress}`;
      const storedData = await redisClient.get(messageKey);
      
      if (!storedData) {
        return false;
      }
      
      const { message: storedMessage, timestamp } = JSON.parse(storedData);
      
      const isMessageValid = message === storedMessage;
      const isTimestampValid = (Date.now() - timestamp) < 5 * 60 * 1000;
      
      if (isMessageValid && isTimestampValid) {
        await redisClient.del(messageKey);
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error('Signing message validation failed', {
        error: error.message,
        walletAddress
      });
      return false;
    }
  }

  async cleanupExpiredSessions() {
    try {
      const sessionPattern = `session:*`;
      const keys = await redisClient.keys(sessionPattern);
      
      let cleanedCount = 0;
      
      for (const key of keys) {
        const sessionData = await redisClient.get(key);
        
        if (!sessionData) {
          await redisClient.del(key);
          cleanedCount++;
          continue;
        }
        
        try {
          const session = JSON.parse(sessionData);
          const sessionAge = Date.now() - new Date(session.createdAt).getTime();
          
          if (sessionAge > 7 * 24 * 60 * 60 * 1000) {
            await redisClient.del(key);
            cleanedCount++;
          }
        } catch (parseError) {
          await redisClient.del(key);
          cleanedCount++;
        }
      }
      
      logger.info('Session cleanup completed', {
        cleanedSessions: cleanedCount,
        totalChecked: keys.length
      });
      
      return cleanedCount;
      
    } catch (error) {
      logger.error('Session cleanup failed', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new AuthService();