const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true,
    validate: {
      validator: function(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
      },
      message: 'Invalid Ethereum wallet address format'
    }
  },
  
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true,
    validate: {
      validator: function(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      },
      message: 'Invalid email format'
    }
  },
  
  password: {
    type: String,
    required: function() {
      return !this.isWalletOnlyLogin;
    },
    minlength: 8,
    select: false,
    validate: {
      validator: function(password) {
        if (!password && this.isWalletOnlyLogin) return true;
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(password);
      },
      message: 'Password must contain at least 8 characters with uppercase, lowercase, number and special character'
    }
  },
  
  userType: {
    type: String,
    required: true,
    enum: ['patient', 'doctor', 'admin'],
    index: true
  },
  
  personalInfo: {
    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50
    },
    dateOfBirth: {
      type: Date,
      validate: {
        validator: function(date) {
          return date < new Date() && date > new Date('1900-01-01');
        },
        message: 'Invalid date of birth'
      }
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say']
    },
    phone: {
      type: String,
      validate: {
        validator: function(phone) {
          if (!phone) return true;
          return /^\+?[\d\s\-\(\)]+$/.test(phone);
        },
        message: 'Invalid phone number format'
      }
    },
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String
    },
    profileImage: {
      type: String,
      validate: {
        validator: function(url) {
          if (!url) return true;
          return /^https?:\/\/.+\.(jpg|jpeg|png|gif)$/i.test(url);
        },
        message: 'Invalid image URL format'
      }
    },
    timezone: {
      type: String,
      default: 'America/New_York'
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'zh', 'ja']
    }
  },
  
  medicalInfo: {
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
    },
    height: {
      value: Number,
      unit: {
        type: String,
        enum: ['cm', 'ft'],
        default: 'cm'
      }
    },
    weight: {
      value: Number,
      unit: {
        type: String,
        enum: ['kg', 'lbs'],
        default: 'kg'
      }
    },
    allergies: [{
      allergen: String,
      severity: {
        type: String,
        enum: ['mild', 'moderate', 'severe']
      },
      reaction: String,
      diagnosedDate: Date
    }],
    chronicConditions: [{
      condition: String,
      diagnosedDate: Date,
      status: {
        type: String,
        enum: ['active', 'managed', 'resolved'],
        default: 'active'
      },
      notes: String
    }],
    medications: [{
      name: String,
      dosage: String,
      frequency: String,
      startDate: Date,
      endDate: Date,
      prescribedBy: String,
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    insuranceInfo: {
      provider: String,
      policyNumber: String,
      groupNumber: String,
      expirationDate: Date
    }
  },
  
  emergencyContact: {
    name: {
      type: String,
      required: function() {
        return this.userType === 'patient';
      }
    },
    relationship: {
      type: String,
      enum: ['spouse', 'parent', 'child', 'sibling', 'friend', 'other'],
      required: function() {
        return this.userType === 'patient';
      }
    },
    phone: {
      type: String,
      required: function() {
        return this.userType === 'patient';
      },
      validate: {
        validator: function(phone) {
          return /^\+?[\d\s\-\(\)]+$/.test(phone);
        },
        message: 'Invalid emergency contact phone number'
      }
    },
    email: String,
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String
    }
  },
  
  professionalInfo: {
    licenseNumber: {
      type: String,
      required: function() {
        return this.userType === 'doctor';
      }
    },
    specialty: {
      type: String,
      required: function() {
        return this.userType === 'doctor';
      }
    },
    boardCertifications: [String],
    medicalSchool: String,
    residencyProgram: String,
    fellowships: [String],
    hospitalAffiliations: [{
      name: String,
      role: String,
      startDate: Date,
      endDate: Date,
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    yearsOfExperience: Number,
    consultationFee: {
      amount: Number,
      currency: {
        type: String,
        enum: ['USD', 'BTC', 'ETH'],
        default: 'USD'
      }
    },
    availableHours: [{
      dayOfWeek: {
        type: Number,
        min: 0,
        max: 6
      },
      startTime: String,
      endTime: String,
      timezone: String
    }]
  },
  
  emailVerification: {
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },
    token: String,
    expiresAt: Date,
    verifiedAt: Date
  },
  
  passwordReset: {
    token: String,
    expiresAt: Date,
    isUsed: {
      type: Boolean,
      default: false
    },
    requestedAt: Date
  },
  
  security: {
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    twoFactorSecret: String,
    twoFactorBackupCodes: [String],
    lastPasswordChange: {
      type: Date,
      default: Date.now
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      max: 10
    },
    accountLockedUntil: Date,
    loginHistory: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      ipAddress: String,
      userAgent: String,
      location: {
        country: String,
        city: String,
        coordinates: {
          latitude: Number,
          longitude: Number
        }
      },
      success: {
        type: Boolean,
        default: true
      },
      method: {
        type: String,
        enum: ['password', 'wallet', '2fa'],
        default: 'password'
      }
    }],
    sessionTokens: [{
      token: String,
      createdAt: {
        type: Date,
        default: Date.now
      },
      expiresAt: Date,
      ipAddress: String,
      userAgent: String,
      isActive: {
        type: Boolean,
        default: true
      }
    }]
  },
  
  preferences: {
    notifications: {
      email: {
        appointments: {
          type: Boolean,
          default: true
        },
        recordUpdates: {
          type: Boolean,
          default: true
        },
        accessRequests: {
          type: Boolean,
          default: true
        },
        payments: {
          type: Boolean,
          default: true
        },
        marketing: {
          type: Boolean,
          default: false
        }
      },
      push: {
        appointments: {
          type: Boolean,
          default: true
        },
        recordUpdates: {
          type: Boolean,
          default: true
        },
        accessRequests: {
          type: Boolean,
          default: true
        },
        payments: {
          type: Boolean,
          default: true
        }
      },
      sms: {
        appointments: {
          type: Boolean,
          default: false
        },
        emergencies: {
          type: Boolean,
          default: true
        }
      }
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: ['public', 'healthcare_providers', 'private'],
        default: 'healthcare_providers'
      },
      dataSharing: {
        anonymousResearch: {
          type: Boolean,
          default: false
        },
        publicHealthStudies: {
          type: Boolean,
          default: false
        }
      },
      searchEngineIndexing: {
        type: Boolean,
        default: false
      }
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    dateFormat: {
      type: String,
      enum: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
      default: 'MM/DD/YYYY'
    },
    timeFormat: {
      type: String,
      enum: ['12h', '24h'],
      default: '12h'
    }
  },
  
  accessGrants: [{
    id: {
      type: String,
      default: () => crypto.randomUUID()
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    doctorWalletAddress: {
      type: String,
      required: true,
      lowercase: true
    },
    permissions: [{
      type: String,
      enum: ['read', 'write', 'delete', 'share'],
      required: true
    }],
    resourceTypes: [{
      type: String,
      enum: ['all', 'medical_records', 'documents', 'appointments', 'lab_results']
    }],
    conditions: {
      timeRestriction: {
        startTime: String,
        endTime: String,
        timezone: String
      },
      locationRestriction: {
        allowedCountries: [String],
        blockedCountries: [String]
      },
      purposeRestriction: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expirationDate: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    revokedAt: Date,
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    accessCount: {
      type: Number,
      default: 0
    },
    lastAccessed: Date,
    grantedVia: {
      type: String,
      enum: ['manual', 'qr_code', 'email_invitation', 'emergency_access'],
      default: 'manual'
    },
    blockchainTxHash: String,
    ipfsHash: String
  }],
  
  apiKeys: [{
    id: {
      type: String,
      default: () => crypto.randomUUID()
    },
    name: {
      type: String,
      required: true
    },
    hashedKey: {
      type: String,
      required: true
    },
    permissions: [{
      type: String,
      enum: ['read', 'write', 'admin']
    }],
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date,
    lastUsed: Date,
    usageCount: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    rateLimit: {
      requestsPerHour: {
        type: Number,
        default: 1000
      },
      requestsPerDay: {
        type: Number,
        default: 10000
      }
    }
  }],
  
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'past_due', 'unpaid'],
      default: 'active'
    },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    features: {
      maxRecords: {
        type: Number,
        default: 100
      },
      maxStorage: {
        type: Number,
        default: 1024
      },
      advancedAnalytics: {
        type: Boolean,
        default: false
      },
      prioritySupport: {
        type: Boolean,
        default: false
      }
    }
  },
  
  blockchain: {
    deployedContracts: [{
      name: String,
      address: String,
      chainId: Number,
      deployedAt: Date,
      txHash: String
    }],
    totalTransactions: {
      type: Number,
      default: 0
    },
    lastTransactionHash: String,
    lastTransactionDate: Date,
    dataIntegrityHash: String,
    encryptionKeys: [{
      keyId: String,
      publicKey: String,
      createdAt: {
        type: Date,
        default: Date.now
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }]
  },
  
  metadata: {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    version: {
      type: Number,
      default: 1
    },
    tags: [String],
    notes: String,
    lastActive: {
      type: Date,
      default: Date.now,
      index: true
    },
    ipAddress: String,
    userAgent: String,
    referralSource: String,
    marketingConsent: {
      type: Boolean,
      default: false
    },
    termsAcceptedVersion: String,
    privacyPolicyAcceptedVersion: String,
    gdprConsent: {
      type: Boolean,
      default: false
    },
    dataRetentionConsent: {
      type: Boolean,
      default: true
    }
  },
  
  isWalletOnlyLogin: {
    type: Boolean,
    default: false
  },
  
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending_verification'],
    default: 'pending_verification',
    index: true
  },
  
  deletedAt: {
    type: Date,
    index: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.security.twoFactorSecret;
      delete ret.security.twoFactorBackupCodes;
      delete ret.emailVerification.token;
      delete ret.passwordReset;
      delete ret.apiKeys;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.security.twoFactorSecret;
      delete ret.security.twoFactorBackupCodes;
      delete ret.emailVerification.token;
      delete ret.passwordReset;
      delete ret.apiKeys;
      delete ret.__v;
      return ret;
    }
  }
});

userSchema.index({ email: 1, walletAddress: 1 });
userSchema.index({ userType: 1, status: 1 });
userSchema.index({ 'personalInfo.lastName': 1, 'personalInfo.firstName': 1 });
userSchema.index({ 'accessGrants.doctorId': 1, 'accessGrants.isActive': 1 });
userSchema.index({ 'metadata.lastActive': -1 });
userSchema.index({ deletedAt: 1 }, { partialFilterExpression: { deletedAt: { $exists: true } } });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  if (this.password) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  next();
});

userSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.metadata.version += 1;
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generatePasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordReset = {
    token: crypto.createHash('sha256').update(resetToken).digest('hex'),
    expiresAt: Date.now() + 30 * 60 * 1000,
    isUsed: false,
    requestedAt: new Date()
  };
  return resetToken;
};

userSchema.methods.generateEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  this.emailVerification = {
    token: crypto.createHash('sha256').update(verificationToken).digest('hex'),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    isVerified: false
  };
  return verificationToken;
};

userSchema.methods.hasPermission = function(doctorId, permission, resourceType = 'all') {
  const activeGrants = this.accessGrants.filter(grant => {
    return grant.isActive && 
           grant.doctorId.toString() === doctorId.toString() &&
           (!grant.expirationDate || grant.expirationDate > new Date()) &&
           grant.permissions.includes(permission) &&
           (grant.resourceTypes.includes('all') || grant.resourceTypes.includes(resourceType));
  });
  
  return activeGrants.length > 0;
};

userSchema.methods.grantAccess = function(doctorId, doctorWalletAddress, permissions, options = {}) {
  const grant = {
    doctorId,
    doctorWalletAddress: doctorWalletAddress.toLowerCase(),
    permissions,
    resourceTypes: options.resourceTypes || ['all'],
    expirationDate: options.expirationDate,
    conditions: options.conditions || {},
    grantedVia: options.grantedVia || 'manual',
    blockchainTxHash: options.blockchainTxHash,
    ipfsHash: options.ipfsHash
  };
  
  this.accessGrants.push(grant);
  return grant;
};

userSchema.methods.revokeAccess = function(doctorId, revokedBy) {
  const grant = this.accessGrants.find(grant => 
    grant.doctorId.toString() === doctorId.toString() && grant.isActive
  );
  
  if (grant) {
    grant.isActive = false;
    grant.revokedAt = new Date();
    grant.revokedBy = revokedBy;
    return grant;
  }
  
  return null;
};

userSchema.methods.updateLastActive = function(ipAddress, userAgent) {
  this.metadata.lastActive = new Date();
  if (ipAddress) this.metadata.ipAddress = ipAddress;
  if (userAgent) this.metadata.userAgent = userAgent;
};

userSchema.methods.addLoginHistory = function(ipAddress, userAgent, success = true, method = 'password', location = null) {
  this.security.loginHistory.push({
    timestamp: new Date(),
    ipAddress,
    userAgent,
    success,
    method,
    location
  });
  
  if (this.security.loginHistory.length > 50) {
    this.security.loginHistory = this.security.loginHistory.slice(-50);
  }
};

userSchema.methods.isAccountLocked = function() {
  return this.security.accountLockedUntil && this.security.accountLockedUntil > new Date();
};

userSchema.methods.lockAccount = function(duration = 30 * 60 * 1000) {
  this.security.accountLockedUntil = new Date(Date.now() + duration);
  this.security.failedLoginAttempts += 1;
};

userSchema.methods.unlockAccount = function() {
  this.security.accountLockedUntil = undefined;
  this.security.failedLoginAttempts = 0;
};

userSchema.methods.softDelete = function() {
  this.deletedAt = new Date();
  this.status = 'inactive';
  this.email = `${this.email}.deleted.${this.deletedAt.getTime()}`;
  this.walletAddress = `${this.walletAddress}.deleted.${this.deletedAt.getTime()}`;
};

userSchema.methods.restore = function() {
  this.deletedAt = undefined;
  this.status = 'active';
  
  if (this.email.includes('.deleted.')) {
    this.email = this.email.split('.deleted.')[0];
  }
  if (this.walletAddress.includes('.deleted.')) {
    this.walletAddress = this.walletAddress.split('.deleted.')[0];
  }
};

userSchema.statics.findByWallet = function(walletAddress) {
  return this.findOne({ 
    walletAddress: walletAddress.toLowerCase(),
    deletedAt: { $exists: false }
  });
};

userSchema.statics.findByEmail = function(email) {
  return this.findOne({ 
    email: email.toLowerCase(),
    deletedAt: { $exists: false }
  });
};

userSchema.statics.findActive = function() {
  return this.find({ 
    status: 'active',
    deletedAt: { $exists: false }
  });
};

userSchema.statics.findByUserType = function(userType) {
  return this.find({ 
    userType,
    status: 'active',
    deletedAt: { $exists: false }
  });
};

userSchema.statics.searchUsers = function(query, userType = null, limit = 20, skip = 0) {
  const searchRegex = new RegExp(query, 'i');
  const filter = {
    deletedAt: { $exists: false },
    status: 'active',
    $or: [
      { 'personalInfo.firstName': searchRegex },
      { 'personalInfo.lastName': searchRegex },
      { email: searchRegex },
      { walletAddress: searchRegex }
    ]
  };
  
  if (userType) {
    filter.userType = userType;
  }
  
  return this.find(filter)
    .limit(limit)
    .skip(skip)
    .sort({ 'metadata.lastActive': -1 });
};

userSchema.plugin(require('mongoose-paginate-v2'));

const User = mongoose.model('User', userSchema);

module.exports = User;