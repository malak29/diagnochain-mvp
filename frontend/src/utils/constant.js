export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001/api';
export const WS_BASE_URL = process.env.REACT_APP_WS_BASE_URL || 'ws://localhost:3001';
export const BLOCKCHAIN_EXPLORER_URL = process.env.REACT_APP_EXPLORER_URL || 'https://etherscan.io';

export const SUPPORTED_NETWORKS = {
  1: {
    name: 'Ethereum Mainnet',
    symbol: 'ETH',
    rpcUrl: `https://mainnet.infura.io/v3/${process.env.REACT_APP_INFURA_PROJECT_ID}`,
    explorerUrl: 'https://etherscan.io',
    chainId: 1,
    isTestnet: false
  },
  5: {
    name: 'Goerli Testnet',
    symbol: 'ETH',
    rpcUrl: `https://goerli.infura.io/v3/${process.env.REACT_APP_INFURA_PROJECT_ID}`,
    explorerUrl: 'https://goerli.etherscan.io',
    chainId: 5,
    isTestnet: true
  },
  11155111: {
    name: 'Sepolia Testnet',
    symbol: 'ETH',
    rpcUrl: `https://sepolia.infura.io/v3/${process.env.REACT_APP_INFURA_PROJECT_ID}`,
    explorerUrl: 'https://sepolia.etherscan.io',
    chainId: 11155111,
    isTestnet: true
  },
  137: {
    name: 'Polygon Mainnet',
    symbol: 'MATIC',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    chainId: 137,
    isTestnet: false
  },
  80001: {
    name: 'Mumbai Testnet',
    symbol: 'MATIC',
    rpcUrl: 'https://rpc-mumbai.maticvigil.com',
    explorerUrl: 'https://mumbai.polygonscan.com',
    chainId: 80001,
    isTestnet: true
  },
  1337: {
    name: 'Local Network',
    symbol: 'ETH',
    rpcUrl: 'http://localhost:8545',
    explorerUrl: null,
    chainId: 1337,
    isTestnet: true
  }
};

export const DEFAULT_CHAIN_ID = parseInt(process.env.REACT_APP_CHAIN_ID || '1337');

export const CONTRACT_ADDRESSES = {
  1: {
    PatientRegistry: process.env.REACT_APP_PATIENT_REGISTRY_MAINNET,
    MedicalRecords: process.env.REACT_APP_MEDICAL_RECORDS_MAINNET,
    AccessControl: process.env.REACT_APP_ACCESS_CONTROL_MAINNET,
    PaymentEscrow: process.env.REACT_APP_PAYMENT_ESCROW_MAINNET,
    DiagnoToken: process.env.REACT_APP_DIAGNO_TOKEN_MAINNET
  },
  5: {
    PatientRegistry: process.env.REACT_APP_PATIENT_REGISTRY_GOERLI,
    MedicalRecords: process.env.REACT_APP_MEDICAL_RECORDS_GOERLI,
    AccessControl: process.env.REACT_APP_ACCESS_CONTROL_GOERLI,
    PaymentEscrow: process.env.REACT_APP_PAYMENT_ESCROW_GOERLI,
    DiagnoToken: process.env.REACT_APP_DIAGNO_TOKEN_GOERLI
  },
  1337: {
    PatientRegistry: process.env.REACT_APP_PATIENT_REGISTRY_LOCAL,
    MedicalRecords: process.env.REACT_APP_MEDICAL_RECORDS_LOCAL,
    AccessControl: process.env.REACT_APP_ACCESS_CONTROL_LOCAL,
    PaymentEscrow: process.env.REACT_APP_PAYMENT_ESCROW_LOCAL,
    DiagnoToken: process.env.REACT_APP_DIAGNO_TOKEN_LOCAL
  }
};

export const USER_TYPES = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  ADMIN: 'admin'
};

export const MEDICAL_RECORD_TYPES = {
  DIAGNOSIS: 'diagnosis',
  PRESCRIPTION: 'prescription',
  LAB_RESULT: 'lab_result',
  IMAGING: 'imaging',
  SURGERY: 'surgery',
  CONSULTATION: 'consultation',
  TREATMENT_PLAN: 'treatment_plan',
  PROGRESS_NOTE: 'progress_note',
  DISCHARGE_SUMMARY: 'discharge_summary',
  REFERRAL: 'referral'
};

export const MEDICAL_RECORD_LABELS = {
  [MEDICAL_RECORD_TYPES.DIAGNOSIS]: 'Diagnosis',
  [MEDICAL_RECORD_TYPES.PRESCRIPTION]: 'Prescription',
  [MEDICAL_RECORD_TYPES.LAB_RESULT]: 'Lab Result',
  [MEDICAL_RECORD_TYPES.IMAGING]: 'Medical Imaging',
  [MEDICAL_RECORD_TYPES.SURGERY]: 'Surgery Record',
  [MEDICAL_RECORD_TYPES.CONSULTATION]: 'Consultation Notes',
  [MEDICAL_RECORD_TYPES.TREATMENT_PLAN]: 'Treatment Plan',
  [MEDICAL_RECORD_TYPES.PROGRESS_NOTE]: 'Progress Note',
  [MEDICAL_RECORD_TYPES.DISCHARGE_SUMMARY]: 'Discharge Summary',
  [MEDICAL_RECORD_TYPES.REFERRAL]: 'Referral'
};

export const ACCESS_PERMISSIONS = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete',
  SHARE: 'share',
  ADMIN: 'admin'
};

export const ACCESS_PERMISSION_LABELS = {
  [ACCESS_PERMISSIONS.READ]: 'Read Only',
  [ACCESS_PERMISSIONS.WRITE]: 'Read & Write',
  [ACCESS_PERMISSIONS.DELETE]: 'Full Access (Read, Write, Delete)',
  [ACCESS_PERMISSIONS.SHARE]: 'Share Records',
  [ACCESS_PERMISSIONS.ADMIN]: 'Administrator'
};

export const DOCUMENT_TYPES = {
  LAB_REPORT: 'lab_report',
  PRESCRIPTION: 'prescription',
  INSURANCE_CARD: 'insurance_card',
  ID_DOCUMENT: 'id_document',
  MEDICAL_IMAGE: 'medical_image',
  TREATMENT_PLAN: 'treatment_plan',
  CONSENT_FORM: 'consent_form',
  DISCHARGE_NOTES: 'discharge_notes',
  VACCINATION_RECORD: 'vaccination_record'
};

export const DOCUMENT_TYPE_LABELS = {
  [DOCUMENT_TYPES.LAB_REPORT]: 'Laboratory Report',
  [DOCUMENT_TYPES.PRESCRIPTION]: 'Prescription',
  [DOCUMENT_TYPES.INSURANCE_CARD]: 'Insurance Card',
  [DOCUMENT_TYPES.ID_DOCUMENT]: 'Identification Document',
  [DOCUMENT_TYPES.MEDICAL_IMAGE]: 'Medical Image/Scan',
  [DOCUMENT_TYPES.TREATMENT_PLAN]: 'Treatment Plan',
  [DOCUMENT_TYPES.CONSENT_FORM]: 'Consent Form',
  [DOCUMENT_TYPES.DISCHARGE_NOTES]: 'Discharge Notes',
  [DOCUMENT_TYPES.VACCINATION_RECORD]: 'Vaccination Record'
};

export const APPOINTMENT_STATUSES = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
  RESCHEDULED: 'rescheduled'
};

export const APPOINTMENT_STATUS_LABELS = {
  [APPOINTMENT_STATUSES.SCHEDULED]: 'Scheduled',
  [APPOINTMENT_STATUSES.CONFIRMED]: 'Confirmed',
  [APPOINTMENT_STATUSES.IN_PROGRESS]: 'In Progress',
  [APPOINTMENT_STATUSES.COMPLETED]: 'Completed',
  [APPOINTMENT_STATUSES.CANCELLED]: 'Cancelled',
  [APPOINTMENT_STATUSES.NO_SHOW]: 'No Show',
  [APPOINTMENT_STATUSES.RESCHEDULED]: 'Rescheduled'
};

export const APPOINTMENT_TYPES = {
  CONSULTATION: 'consultation',
  FOLLOW_UP: 'follow_up',
  EMERGENCY: 'emergency',
  ROUTINE_CHECKUP: 'routine_checkup',
  SPECIALIST: 'specialist',
  TELEMEDICINE: 'telemedicine',
  SURGERY: 'surgery',
  PROCEDURE: 'procedure'
};

export const NOTIFICATION_TYPES = {
  APPOINTMENT_REMINDER: 'appointment_reminder',
  RECORD_UPDATED: 'record_updated',
  ACCESS_GRANTED: 'access_granted',
  ACCESS_REVOKED: 'access_revoked',
  PAYMENT_RECEIVED: 'payment_received',
  SYSTEM_UPDATE: 'system_update',
  SECURITY_ALERT: 'security_alert',
  DOCUMENT_SHARED: 'document_shared'
};

export const TRANSACTION_TYPES = {
  RECORD_CREATION: 'record_creation',
  RECORD_UPDATE: 'record_update',
  ACCESS_GRANT: 'access_grant',
  ACCESS_REVOKE: 'access_revoke',
  PAYMENT: 'payment',
  DATA_BACKUP: 'data_backup'
};

export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const PAYMENT_METHODS = {
  BITCOIN: 'bitcoin',
  LIGHTNING: 'lightning',
  ETHEREUM: 'ethereum',
  CREDIT_CARD: 'credit_card'
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled'
};

export const BLOOD_TYPES = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
];

export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' }
];

export const RELATIONSHIPS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' }
];

export const TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney'
];

export const DATE_FORMATS = {
  SHORT: 'MM/DD/YYYY',
  LONG: 'MMMM Do, YYYY',
  ISO: 'YYYY-MM-DD',
  DISPLAY: 'MMM DD, YYYY',
  TIME: 'h:mm A'
};

export const FILE_UPLOAD_LIMITS = {
  MAX_SIZE: 50 * 1024 * 1024,
  ALLOWED_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  ALLOWED_EXTENSIONS: [
    '.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.doc', '.docx'
  ]
};

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100
};

export const TOAST_MESSAGES = {
  WALLET_CONNECTED: 'Wallet connected successfully',
  WALLET_DISCONNECTED: 'Wallet disconnected',
  NETWORK_CHANGED: 'Network changed',
  TRANSACTION_PENDING: 'Transaction submitted, waiting for confirmation...',
  TRANSACTION_SUCCESS: 'Transaction confirmed successfully',
  TRANSACTION_FAILED: 'Transaction failed',
  RECORD_CREATED: 'Medical record created successfully',
  RECORD_UPDATED: 'Medical record updated successfully',
  RECORD_DELETED: 'Medical record deleted successfully',
  ACCESS_GRANTED: 'Access granted successfully',
  ACCESS_REVOKED: 'Access revoked successfully',
  FILE_UPLOADED: 'File uploaded successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
  PASSWORD_CHANGED: 'Password changed successfully',
  EMAIL_VERIFIED: 'Email verified successfully',
  ERROR_GENERIC: 'An error occurred. Please try again.',
  ERROR_NETWORK: 'Network error. Please check your connection.',
  ERROR_UNAUTHORIZED: 'Unauthorized. Please log in again.',
  ERROR_VALIDATION: 'Please check your input and try again.'
};

export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s\-\(\)]+$/,
  ETHEREUM_ADDRESS: /^0x[a-fA-F0-9]{40}$/,
  BITCOIN_ADDRESS: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/,
  TRANSACTION_HASH: /^0x[a-fA-F0-9]{64}$/,
  IPFS_HASH: /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
};

export const VALIDATION_MESSAGES = {
  REQUIRED: 'This field is required',
  EMAIL_INVALID: 'Please enter a valid email address',
  PASSWORD_WEAK: 'Password must be at least 8 characters with uppercase, lowercase, number and special character',
  PHONE_INVALID: 'Please enter a valid phone number',
  ADDRESS_INVALID: 'Please enter a valid wallet address',
  FILE_TOO_LARGE: 'File size exceeds maximum limit',
  FILE_TYPE_INVALID: 'File type not supported',
  DATE_INVALID: 'Please enter a valid date',
  AMOUNT_INVALID: 'Please enter a valid amount'
};

export const SECURITY_SETTINGS = {
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000,
  TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 30 * 60 * 1000,
  PASSWORD_MIN_LENGTH: 8,
  TWO_FACTOR_ISSUER: 'DiagnoChain',
  BACKUP_CODES_COUNT: 8
};

export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  LOGIN: '/login',
  REGISTER: '/register',
  PROFILE: '/profile',
  SETTINGS: '/settings',
  PATIENTS: '/patients',
  MEDICAL_RECORDS: '/medical-records',
  APPOINTMENTS: '/appointments',
  ACCESS_CONTROL: '/access-control',
  PAYMENTS: '/payments',
  TRANSACTIONS: '/transactions',
  BLOCKCHAIN: '/blockchain',
  ADMIN: '/admin',
  HELP: '/help',
  PRIVACY: '/privacy',
  TERMS: '/terms'
};

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  USER_PROFILE: 'userProfile',
  WALLET_ADDRESS: 'walletAddress',
  THEME_PREFERENCE: 'themePreference',
  LANGUAGE_PREFERENCE: 'languagePreference',
  LAST_ACTIVITY: 'lastActivity'
};

export const THEME_OPTIONS = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
};

export const LANGUAGE_OPTIONS = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' }
];

export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/'
];

export const ENCRYPTION_CONFIG = {
  ALGORITHM: 'AES-256-GCM',
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  TAG_LENGTH: 16
};

export const ANALYTICS_EVENTS = {
  USER_REGISTERED: 'user_registered',
  USER_LOGGED_IN: 'user_logged_in',
  WALLET_CONNECTED: 'wallet_connected',
  RECORD_CREATED: 'record_created',
  ACCESS_GRANTED: 'access_granted',
  PAYMENT_MADE: 'payment_made',
  DOCUMENT_UPLOADED: 'document_uploaded',
  APPOINTMENT_SCHEDULED: 'appointment_scheduled'
};

export const HEALTH_CHECK_ENDPOINTS = {
  API: '/health',
  DATABASE: '/health/database',
  BLOCKCHAIN: '/health/blockchain',
  STORAGE: '/health/storage',
  PAYMENT: '/health/payment'
};

export const ERROR_CODES = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  SERVER_ERROR: 500,
  NETWORK_ERROR: 502,
  SERVICE_UNAVAILABLE: 503
};

export const BITCOIN_NETWORK_CONFIGS = {
  mainnet: {
    name: 'Bitcoin Mainnet',
    explorer: 'https://blockstream.info',
    feeEstimateUrl: 'https://blockstream.info/api/fee-estimates'
  },
  testnet: {
    name: 'Bitcoin Testnet',
    explorer: 'https://blockstream.info/testnet',
    feeEstimateUrl: 'https://blockstream.info/testnet/api/fee-estimates'
  },
  regtest: {
    name: 'Bitcoin Regtest',
    explorer: 'http://localhost:3002',
    feeEstimateUrl: 'http://localhost:3002/api/fee-estimates'
  }
};

export const LIGHTNING_CONFIG = {
  NETWORK: process.env.REACT_APP_LIGHTNING_NETWORK || 'testnet',
  NODE_PUBKEY: process.env.REACT_APP_LIGHTNING_NODE_PUBKEY,
  REST_ENDPOINT: process.env.REACT_APP_LIGHTNING_REST_URL || 'http://localhost:8080'
};

export const FEATURE_FLAGS = {
  ENABLE_LIGHTNING_PAYMENTS: process.env.REACT_APP_ENABLE_LIGHTNING === 'true',
  ENABLE_BIOMETRIC_AUTH: process.env.REACT_APP_ENABLE_BIOMETRIC === 'true',
  ENABLE_ANALYTICS: process.env.REACT_APP_ENABLE_ANALYTICS === 'true',
  ENABLE_NOTIFICATIONS: process.env.REACT_APP_ENABLE_NOTIFICATIONS === 'true',
  ENABLE_DARK_MODE: process.env.REACT_APP_ENABLE_DARK_MODE === 'true',
  ENABLE_MULTI_LANGUAGE: process.env.REACT_APP_ENABLE_MULTI_LANGUAGE === 'true',
  ENABLE_TELEMEDICINE: process.env.REACT_APP_ENABLE_TELEMEDICINE === 'true'
};

export const DEFAULT_EXPORT = {
  API_BASE_URL,
  WS_BASE_URL,
  BLOCKCHAIN_EXPLORER_URL,
  SUPPORTED_NETWORKS,
  DEFAULT_CHAIN_ID,
  CONTRACT_ADDRESSES,
  USER_TYPES,
  MEDICAL_RECORD_TYPES,
  MEDICAL_RECORD_LABELS,
  ACCESS_PERMISSIONS,
  ACCESS_PERMISSION_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPES,
  NOTIFICATION_TYPES,
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  BLOOD_TYPES,
  GENDERS,
  RELATIONSHIPS,
  TIME_ZONES,
  DATE_FORMATS,
  FILE_UPLOAD_LIMITS,
  PAGINATION_DEFAULTS,
  TOAST_MESSAGES,
  REGEX_PATTERNS,
  VALIDATION_MESSAGES,
  SECURITY_SETTINGS,
  ROUTES,
  STORAGE_KEYS,
  THEME_OPTIONS,
  LANGUAGE_OPTIONS,
  IPFS_GATEWAYS,
  ENCRYPTION_CONFIG,
  ANALYTICS_EVENTS,
  HEALTH_CHECK_ENDPOINTS,
  ERROR_CODES,
  BITCOIN_NETWORK_CONFIGS,
  LIGHTNING_CONFIG,
  FEATURE_FLAGS
};

export default DEFAULT_EXPORT;