const express = require('express');
const { body, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    error: 'Too many registration attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/register', [
  registerLimiter,
  body('walletAddress')
    .isEthereumAddress()
    .withMessage('Invalid Ethereum wallet address'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least 8 characters with uppercase, lowercase, number and special character'),
  body('userType')
    .isIn(['patient', 'doctor', 'admin'])
    .withMessage('Invalid user type'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2-50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2-50 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Invalid phone number')
], authController.register);

router.post('/login', [
  loginLimiter,
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], authController.login);

router.post('/wallet-login', [
  loginLimiter,
  body('walletAddress')
    .isEthereumAddress()
    .withMessage('Invalid wallet address'),
  body('signature')
    .notEmpty()
    .withMessage('Signature is required'),
  body('message')
    .notEmpty()
    .withMessage('Message is required')
], authController.walletLogin);

router.post('/logout', auth, authController.logout);

router.post('/refresh', [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
], authController.refreshToken);

router.post('/forgot-password', [
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { error: 'Too many password reset attempts' }
  }),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address')
], authController.forgotPassword);

router.post('/reset-password', [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must meet security requirements')
], authController.resetPassword);

router.post('/verify-email', [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required')
], authController.verifyEmail);

router.post('/resend-verification', [
  auth,
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 2,
    message: { error: 'Too many verification requests' }
  })
], authController.resendVerification);

router.get('/profile', auth, authController.getProfile);

router.put('/profile', [
  auth,
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2-50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2-50 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Invalid phone number'),
  body('profileImage')
    .optional()
    .isURL()
    .withMessage('Invalid profile image URL')
], authController.updateProfile);

router.post('/change-password', [
  auth,
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must meet security requirements')
], authController.changePassword);

router.delete('/account', [
  auth,
  body('password')
    .notEmpty()
    .withMessage('Password confirmation required'),
  body('confirmation')
    .equals('DELETE')
    .withMessage('Account deletion confirmation required')
], authController.deleteAccount);

router.get('/sessions', auth, authController.getActiveSessions);

router.delete('/sessions/:sessionId', auth, authController.revokeSession);

module.exports = router;