const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const authService = require('../services/authService');
const emailService = require('../services/emailService');
const blockchainService = require('../services/blockchainService');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

class AuthController {
  async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { walletAddress, email, password, userType, firstName, lastName, phone } = req.body;

      const existingUser = await User.findOne({
        $or: [{ email }, { walletAddress }]
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'User with this email or wallet address already exists'
        });
      }

      const isValidWallet = await blockchainService.validateWalletAddress(walletAddress);
      if (!isValidWallet) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive wallet address'
        });
      }

      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const userData = {
        walletAddress: walletAddress.toLowerCase(),
        email: email.toLowerCase(),
        password: hashedPassword,
        userType,
        personalInfo: {
          firstName,
          lastName,
          phone: phone || null,
          profileImage: null
        },
        emailVerification: {
          token: verificationToken,
          isVerified: false,
          expiresAt: verificationExpiry
        },
        security: {
          twoFactorEnabled: false,
          lastPasswordChange: new Date(),
          failedLoginAttempts: 0,
          accountLockedUntil: null
        },
        metadata: {
          lastActive: new Date(),
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      };

      const user = new User(userData);
      await user.save();

      await emailService.sendVerificationEmail(email, verificationToken);

      logger.info('User registered successfully', {
        userId: user._id,
        email: user.email,
        userType: user.userType,
        ip: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully. Please check your email to verify your account.',
        data: {
          userId: user._id,
          email: user.email,
          userType: user.userType,
          walletAddress: user.walletAddress,
          emailVerified: false
        }
      });

    } catch (error) {
      logger.error('Registration failed', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(500).json({
        success: false,
        message: 'Internal server error during registration'
      });
    }
  }

  async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid credentials format',
          errors: errors.array()
        });
      }

      const { email, password } = req.body;
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      if (user.security.accountLockedUntil && user.security.accountLockedUntil > new Date()) {
        return res.status(423).json({
          success: false,
          message: 'Account temporarily locked due to too many failed login attempts'
        });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        user.security.failedLoginAttempts += 1;
        
        if (user.security.failedLoginAttempts >= 5) {
          user.security.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
          logger.warn('Account locked due to failed login attempts', {
            userId: user._id,
            email: user.email,
            attempts: user.security.failedLoginAttempts
          });
        }
        
        await user.save();
        
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      if (!user.emailVerification.isVerified) {
        return res.status(403).json({
          success: false,
          message: 'Please verify your email address before logging in'
        });
      }

      user.security.failedLoginAttempts = 0;
      user.security.accountLockedUntil = null;
      user.metadata.lastActive = new Date();
      user.metadata.ipAddress = req.ip;
      user.metadata.userAgent = req.get('User-Agent');
      await user.save();

      const { accessToken, refreshToken } = authService.generateTokens(user);

      const sessionId = crypto.randomUUID();
      const sessionData = {
        userId: user._id.toString(),
        email: user.email,
        userType: user.userType,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        createdAt: new Date().toISOString()
      };

      await redisClient.setex(
        `session:${sessionId}`,
        7 * 24 * 60 * 60,
        JSON.stringify(sessionData)
      );

      await redisClient.setex(
        `refresh:${user._id}:${sessionId}`,
        30 * 24 * 60 * 60,
        refreshToken
      );

      logger.info('User logged in successfully', {
        userId: user._id,
        email: user.email,
        userType: user.userType,
        sessionId,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            userType: user.userType,
            walletAddress: user.walletAddress,
            firstName: user.personalInfo.firstName,
            lastName: user.personalInfo.lastName,
            profileImage: user.personalInfo.profileImage,
            emailVerified: user.emailVerification.isVerified,
            twoFactorEnabled: user.security.twoFactorEnabled
          },
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: '15m'
          },
          sessionId
        }
      });

    } catch (error) {
      logger.error('Login failed', {
        error: error.message,
        stack: error.stack,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Internal server error during login'
      });
    }
  }

  async walletLogin(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid wallet login data',
          errors: errors.array()
        });
      }

      const { walletAddress, signature, message } = req.body;

      const isValidSignature = await blockchainService.verifySignature(
        walletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({
          success: false,
          message: 'Invalid wallet signature'
        });
      }

      const user = await User.findOne({ 
        walletAddress: walletAddress.toLowerCase() 
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found for this wallet address'
        });
      }

      user.metadata.lastActive = new Date();
      user.metadata.ipAddress = req.ip;
      user.metadata.userAgent = req.get('User-Agent');
      await user.save();

      const { accessToken, refreshToken } = authService.generateTokens(user);

      const sessionId = crypto.randomUUID();
      const sessionData = {
        userId: user._id.toString(),
        email: user.email,
        userType: user.userType,
        loginMethod: 'wallet',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        createdAt: new Date().toISOString()
      };

      await redisClient.setex(
        `session:${sessionId}`,
        7 * 24 * 60 * 60,
        JSON.stringify(sessionData)
      );

      await redisClient.setex(
        `refresh:${user._id}:${sessionId}`,
        30 * 24 * 60 * 60,
        refreshToken
      );

      logger.info('Wallet login successful', {
        userId: user._id,
        walletAddress: user.walletAddress,
        userType: user.userType,
        sessionId,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Wallet login successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            userType: user.userType,
            walletAddress: user.walletAddress,
            firstName: user.personalInfo.firstName,
            lastName: user.personalInfo.lastName,
            profileImage: user.personalInfo.profileImage
          },
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: '15m'
          },
          sessionId
        }
      });

    } catch (error) {
      logger.error('Wallet login failed', {
        error: error.message,
        stack: error.stack,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Internal server error during wallet login'
      });
    }
  }

  async logout(req, res) {
    try {
      const sessionId = req.headers['x-session-id'];
      
      if (sessionId) {
        await redisClient.del(`session:${sessionId}`);
        await redisClient.del(`refresh:${req.user.id}:${sessionId}`);
      }

      const refreshTokenPattern = `refresh:${req.user.id}:*`;
      const keys = await redisClient.keys(refreshTokenPattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      logger.info('User logged out', {
        userId: req.user.id,
        sessionId,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      logger.error('Logout failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error during logout'
      });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token required'
        });
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      
      const storedToken = await redisClient.get(`refresh:${decoded.userId}:${decoded.sessionId}`);
      
      if (!storedToken || storedToken !== refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      const { accessToken, refreshToken: newRefreshToken } = authService.generateTokens(user);

      await redisClient.setex(
        `refresh:${user._id}:${decoded.sessionId}`,
        30 * 24 * 60 * 60,
        newRefreshToken
      );

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: '15m'
        }
      });

    } catch (error) {
      logger.error('Token refresh failed', {
        error: error.message,
        ip: req.ip
      });

      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
  }

  async forgotPassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
          errors: errors.array()
        });
      }

      const { email } = req.body;
      const user = await User.findOne({ email: email.toLowerCase() });

      if (!user) {
        return res.json({
          success: true,
          message: 'If an account exists, a password reset email has been sent'
        });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpiry = new Date(Date.now() + 30 * 60 * 1000);

      user.passwordReset = {
        token: resetToken,
        expiresAt: resetExpiry,
        isUsed: false
      };
      await user.save();

      await emailService.sendPasswordResetEmail(email, resetToken);

      logger.info('Password reset requested', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password reset email sent'
      });

    } catch (error) {
      logger.error('Password reset failed', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error processing password reset request'
      });
    }
  }

  async resetPassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset data',
          errors: errors.array()
        });
      }

      const { token, password } = req.body;

      const user = await User.findOne({
        'passwordReset.token': token,
        'passwordReset.expiresAt': { $gt: new Date() },
        'passwordReset.isUsed': false
      }).select('+password');

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }

      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      user.password = hashedPassword;
      user.security.lastPasswordChange = new Date();
      user.passwordReset.isUsed = true;
      user.security.failedLoginAttempts = 0;
      user.security.accountLockedUntil = null;

      await user.save();

      const refreshTokenPattern = `refresh:${user._id}:*`;
      const keys = await redisClient.keys(refreshTokenPattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      logger.info('Password reset successful', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password reset successful'
      });

    } catch (error) {
      logger.error('Password reset failed', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error resetting password'
      });
    }
  }

  async verifyEmail(req, res) {
    try {
      const { token } = req.body;

      const user = await User.findOne({
        'emailVerification.token': token,
        'emailVerification.expiresAt': { $gt: new Date() }
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired verification token'
        });
      }

      user.emailVerification.isVerified = true;
      user.emailVerification.verifiedAt = new Date();
      user.emailVerification.token = null;
      user.emailVerification.expiresAt = null;

      await user.save();

      logger.info('Email verified successfully', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error) {
      logger.error('Email verification failed', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error verifying email'
      });
    }
  }

  async resendVerification(req, res) {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.emailVerification.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email already verified'
        });
      }

      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      user.emailVerification.token = verificationToken;
      user.emailVerification.expiresAt = verificationExpiry;
      await user.save();

      await emailService.sendVerificationEmail(user.email, verificationToken);

      res.json({
        success: true,
        message: 'Verification email sent'
      });

    } catch (error) {
      logger.error('Resend verification failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error sending verification email'
      });
    }
  }

  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        data: {
          id: user._id,
          email: user.email,
          userType: user.userType,
          walletAddress: user.walletAddress,
          personalInfo: user.personalInfo,
          emailVerified: user.emailVerification.isVerified,
          twoFactorEnabled: user.security.twoFactorEnabled,
          lastActive: user.metadata.lastActive,
          createdAt: user.createdAt
        }
      });

    } catch (error) {
      logger.error('Get profile failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error retrieving profile'
      });
    }
  }

  async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const { firstName, lastName, phone, profileImage } = req.body;

      if (firstName !== undefined) user.personalInfo.firstName = firstName;
      if (lastName !== undefined) user.personalInfo.lastName = lastName;
      if (phone !== undefined) user.personalInfo.phone = phone;
      if (profileImage !== undefined) user.personalInfo.profileImage = profileImage;

      user.metadata.updatedAt = new Date();
      await user.save();

      logger.info('Profile updated', {
        userId: user._id,
        fields: Object.keys(req.body),
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          personalInfo: user.personalInfo
        }
      });

    } catch (error) {
      logger.error('Profile update failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error updating profile'
      });
    }
  }

  async changePassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid password data',
          errors: errors.array()
        });
      }

      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user.id).select('+password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      const isSamePassword = await bcrypt.compare(newPassword, user.password);
      if (isSamePassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from current password'
        });
      }

      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      user.password = hashedNewPassword;
      user.security.lastPasswordChange = new Date();
      await user.save();

      const refreshTokenPattern = `refresh:${user._id}:*`;
      const keys = await redisClient.keys(refreshTokenPattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      logger.info('Password changed successfully', {
        userId: user._id,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Password change failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error changing password'
      });
    }
  }

  async deleteAccount(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid confirmation data',
          errors: errors.array()
        });
      }

      const { password, confirmation } = req.body;
      const user = await User.findById(req.user.id).select('+password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }

      await User.findByIdAndDelete(req.user.id);

      const refreshTokenPattern = `refresh:${user._id}:*`;
      const sessionPattern = `session:*`;
      
      const refreshKeys = await redisClient.keys(refreshTokenPattern);
      const sessionKeys = await redisClient.keys(sessionPattern);
      
      const allKeys = [...refreshKeys, ...sessionKeys];
      if (allKeys.length > 0) {
        await redisClient.del(...allKeys);
      }

      logger.warn('Account deleted', {
        userId: user._id,
        email: user.email,
        userType: user.userType,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Account deleted successfully'
      });

    } catch (error) {
      logger.error('Account deletion failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error deleting account'
      });
    }
  }

  async getActiveSessions(req, res) {
    try {
      const sessionPattern = `session:*`;
      const sessionKeys = await redisClient.keys(sessionPattern);
      
      const userSessions = [];
      
      for (const key of sessionKeys) {
        const sessionData = await redisClient.get(key);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.userId === req.user.id) {
            userSessions.push({
              sessionId: key.replace('session:', ''),
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              createdAt: session.createdAt,
              loginMethod: session.loginMethod || 'email'
            });
          }
        }
      }

      res.json({
        success: true,
        data: userSessions
      });

    } catch (error) {
      logger.error('Get sessions failed', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error retrieving sessions'
      });
    }
  }

  async revokeSession(req, res) {
    try {
      const { sessionId } = req.params;
      
      const sessionData = await redisClient.get(`session:${sessionId}`);
      
      if (!sessionData) {
        return res.status(404).json({
          success: false,
          message: 'Session not found'
        });
      }

      const session = JSON.parse(sessionData);
      
      if (session.userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Cannot revoke another user\'s session'
        });
      }

      await redisClient.del(`session:${sessionId}`);
      await redisClient.del(`refresh:${req.user.id}:${sessionId}`);

      logger.info('Session revoked', {
        userId: req.user.id,
        sessionId,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Session revoked successfully'
      });

    } catch (error) {
      logger.error('Session revocation failed', {
        error: error.message,
        userId: req.user?.id,
        sessionId: req.params.sessionId,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        message: 'Error revoking session'
      });
    }
  }
}

module.exports = new AuthController();