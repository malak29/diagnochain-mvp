const mongoose = require('mongoose');
const logger = require('../utils/logger');

class DatabaseConfig {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
    this.reconnectInterval = 5000;
    this.connectionOptions = this.buildConnectionOptions();
  }

  buildConnectionOptions() {
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '10'),
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '2'),
      maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME || '30000'),
      serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT || '5000'),
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT || '45000'),
      connectTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'),
      heartbeatFrequencyMS: parseInt(process.env.DB_HEARTBEAT_FREQUENCY || '10000'),
      retryWrites: process.env.DB_RETRY_WRITES !== 'false',
      writeConcern: {
        w: process.env.DB_WRITE_CONCERN || 'majority',
        j: process.env.DB_JOURNAL !== 'false',
        wtimeout: parseInt(process.env.DB_WRITE_TIMEOUT || '10000')
      },
      readPreference: process.env.DB_READ_PREFERENCE || 'primary',
      readConcern: {
        level: process.env.DB_READ_CONCERN || 'majority'
      },
      compressors: process.env.DB_COMPRESSORS ? process.env.DB_COMPRESSORS.split(',') : ['zstd', 'zlib'],
      zlibCompressionLevel: parseInt(process.env.DB_ZLIB_COMPRESSION_LEVEL || '6'),
      authSource: process.env.DB_AUTH_SOURCE || 'admin',
      ssl: process.env.DB_SSL === 'true',
      sslValidate: process.env.DB_SSL_VALIDATE !== 'false',
      bufferMaxEntries: 0,
      bufferCommands: false
    };

    if (process.env.DB_SSL_CA_FILE) {
      options.sslCA = require('fs').readFileSync(process.env.DB_SSL_CA_FILE);
    }

    if (process.env.DB_SSL_CERT_FILE) {
      options.sslCert = require('fs').readFileSync(process.env.DB_SSL_CERT_FILE);
    }

    if (process.env.DB_SSL_KEY_FILE) {
      options.sslKey = require('fs').readFileSync(process.env.DB_SSL_KEY_FILE);
    }

    if (process.env.NODE_ENV === 'development') {
      options.debug = process.env.DB_DEBUG === 'true';
      options.serverSelectionTimeoutMS = 30000;
      options.socketTimeoutMS = 60000;
    }

    if (process.env.NODE_ENV === 'test') {
      options.maxPoolSize = 5;
      options.minPoolSize = 1;
    }

    return options;
  }

  buildConnectionString() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '27017';
    const database = process.env.DB_NAME || 'diagnochain';
    const username = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;

    let connectionString;

    if (process.env.DB_CONNECTION_STRING) {
      connectionString = process.env.DB_CONNECTION_STRING;
    } else if (username && password) {
      connectionString = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    } else {
      connectionString = `mongodb://${host}:${port}/${database}`;
    }

    if (process.env.DB_REPLICA_SET) {
      const url = new URL(connectionString.replace('mongodb://', 'http://'));
      url.searchParams.set('replicaSet', process.env.DB_REPLICA_SET);
      connectionString = url.toString().replace('http://', 'mongodb://');
    }

    return connectionString;
  }

  async connect() {
    try {
      if (this.isConnected) {
        logger.info('Database already connected');
        return this.connection;
      }

      this.connectionAttempts++;
      const connectionString = this.buildConnectionString();
      
      logger.info('Attempting database connection', {
        attempt: this.connectionAttempts,
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'diagnochain',
        maxAttempts: this.maxConnectionAttempts
      });

      this.connection = await mongoose.connect(connectionString, this.connectionOptions);
      
      this.setupEventHandlers();
      this.isConnected = true;
      this.connectionAttempts = 0;

      logger.info('Database connected successfully', {
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        database: mongoose.connection.name,
        readyState: mongoose.connection.readyState
      });

      await this.setupIndexes();
      await this.runHealthCheck();

      return this.connection;

    } catch (error) {
      this.isConnected = false;
      
      logger.error('Database connection failed', {
        attempt: this.connectionAttempts,
        error: error.message,
        code: error.code,
        codeName: error.codeName
      });

      if (this.connectionAttempts < this.maxConnectionAttempts) {
        logger.info(`Retrying database connection in ${this.reconnectInterval}ms`, {
          nextAttempt: this.connectionAttempts + 1,
          maxAttempts: this.maxConnectionAttempts
        });

        await this.delay(this.reconnectInterval);
        return this.connect();
      } else {
        logger.error('Max database connection attempts reached', {
          maxAttempts: this.maxConnectionAttempts
        });
        throw new Error(`Database connection failed after ${this.maxConnectionAttempts} attempts: ${error.message}`);
      }
    }
  }

  setupEventHandlers() {
    mongoose.connection.on('connected', () => {
      this.isConnected = true;
      logger.info('Database connection established');
    });

    mongoose.connection.on('error', (error) => {
      this.isConnected = false;
      logger.error('Database connection error', {
        error: error.message,
        code: error.code
      });
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('Database disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      this.isConnected = true;
      logger.info('Database reconnected');
    });

    mongoose.connection.on('reconnectFailed', () => {
      this.isConnected = false;
      logger.error('Database reconnection failed');
    });

    mongoose.connection.on('close', () => {
      this.isConnected = false;
      logger.info('Database connection closed');
    });

    mongoose.connection.on('fullsetup', () => {
      logger.info('Database replica set fully connected');
    });

    mongoose.connection.on('all', () => {
      logger.info('All database servers in replica set connected');
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, gracefully closing database connection');
      await this.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, gracefully closing database connection');
      await this.disconnect();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception, closing database connection', {
        error: error.message,
        stack: error.stack
      });
      await this.disconnect();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('Unhandled rejection, closing database connection', {
        reason: reason?.message || reason,
        promise: promise.toString()
      });
      await this.disconnect();
      process.exit(1);
    });
  }

  async setupIndexes() {
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      
      for (const collection of collections) {
        try {
          const collectionName = collection.name;
          const indexes = await mongoose.connection.db.collection(collectionName).indexes();
          
          logger.debug('Collection indexes', {
            collection: collectionName,
            indexCount: indexes.length
          });
        } catch (indexError) {
          logger.warn('Failed to check indexes for collection', {
            collection: collection.name,
            error: indexError.message
          });
        }
      }

      await this.createCustomIndexes();

      logger.info('Database indexes setup completed');
    } catch (error) {
      logger.error('Failed to setup database indexes', {
        error: error.message
      });
    }
  }

  async createCustomIndexes() {
    try {
      const db = mongoose.connection.db;

      await db.collection('users').createIndex(
        { email: 1, walletAddress: 1 }, 
        { unique: true, background: true }
      );

      await db.collection('users').createIndex(
        { 'metadata.lastActive': -1 }, 
        { background: true }
      );

      await db.collection('users').createIndex(
        { userType: 1, status: 1 }, 
        { background: true }
      );

      await db.collection('users').createIndex(
        { 'emailVerification.isVerified': 1 }, 
        { background: true }
      );

      await db.collection('users').createIndex(
        { deletedAt: 1 }, 
        { background: true, partialFilterExpression: { deletedAt: { $exists: true } } }
      );

      await db.collection('medicalrecords').createIndex(
        { patientId: 1, createdAt: -1 }, 
        { background: true }
      );

      await db.collection('medicalrecords').createIndex(
        { 'blockchain.transactionHash': 1 }, 
        { background: true, sparse: true }
      );

      await db.collection('appointments').createIndex(
        { patientId: 1, doctorId: 1, dateTime: 1 }, 
        { background: true }
      );

      await db.collection('appointments').createIndex(
        { status: 1, dateTime: 1 }, 
        { background: true }
      );

      await db.collection('payments').createIndex(
        { 'blockchain.transactionHash': 1 }, 
        { background: true, unique: true, sparse: true }
      );

      await db.collection('accesslogs').createIndex(
        { patientId: 1, timestamp: -1 }, 
        { background: true }
      );

      await db.collection('accesslogs').createIndex(
        { timestamp: 1 }, 
        { background: true, expireAfterSeconds: 7776000 }
      );

      logger.info('Custom indexes created successfully');
    } catch (error) {
      logger.error('Failed to create custom indexes', {
        error: error.message
      });
    }
  }

  async runHealthCheck() {
    try {
      const adminDb = mongoose.connection.db.admin();
      const status = await adminDb.serverStatus();
      
      const healthInfo = {
        status: 'healthy',
        database: mongoose.connection.name,
        host: status.host,
        version: status.version,
        uptime: status.uptime,
        connections: status.connections,
        memory: {
          resident: status.mem?.resident,
          virtual: status.mem?.virtual,
          mapped: status.mem?.mapped
        },
        replication: status.repl ? {
          ismaster: status.repl.ismaster,
          secondary: status.repl.secondary,
          setName: status.repl.setName
        } : null
      };

      logger.info('Database health check passed', healthInfo);
      
      return healthInfo;
    } catch (error) {
      logger.error('Database health check failed', {
        error: error.message
      });
      
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  async disconnect() {
    try {
      if (this.connection && this.isConnected) {
        await mongoose.disconnect();
        this.connection = null;
        this.isConnected = false;
        
        logger.info('Database connection closed gracefully');
      }
    } catch (error) {
      logger.error('Error during database disconnection', {
        error: error.message
      });
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      connectionAttempts: this.connectionAttempts
    };
  }

  async getStats() {
    try {
      if (!this.isConnected) {
        return { error: 'Database not connected' };
      }

      const db = mongoose.connection.db;
      const admin = db.admin();
      
      const [serverStatus, dbStats, replSetStatus] = await Promise.allSettled([
        admin.serverStatus(),
        db.stats(),
        admin.replSetGetStatus().catch(() => null)
      ]);

      const stats = {
        server: serverStatus.status === 'fulfilled' ? {
          host: serverStatus.value.host,
          version: serverStatus.value.version,
          uptime: serverStatus.value.uptime,
          connections: serverStatus.value.connections,
          network: serverStatus.value.network,
          memory: serverStatus.value.mem
        } : null,
        database: dbStats.status === 'fulfilled' ? {
          collections: dbStats.value.collections,
          objects: dbStats.value.objects,
          avgObjSize: dbStats.value.avgObjSize,
          dataSize: dbStats.value.dataSize,
          storageSize: dbStats.value.storageSize,
          indexes: dbStats.value.indexes,
          indexSize: dbStats.value.indexSize
        } : null,
        replication: replSetStatus.status === 'fulfilled' && replSetStatus.value ? {
          setName: replSetStatus.value.set,
          myState: replSetStatus.value.myState,
          members: replSetStatus.value.members?.length
        } : null
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get database stats', {
        error: error.message
      });
      
      return { error: error.message };
    }
  }

  async backup(options = {}) {
    try {
      const backupName = options.name || `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const collections = options.collections || await this.getCollectionNames();
      
      logger.info('Starting database backup', {
        backupName,
        collections: collections.length
      });

      const backupData = {};
      
      for (const collectionName of collections) {
        try {
          const collection = mongoose.connection.db.collection(collectionName);
          const documents = await collection.find({}).toArray();
          backupData[collectionName] = documents;
          
          logger.debug('Collection backed up', {
            collection: collectionName,
            documents: documents.length
          });
        } catch (collectionError) {
          logger.warn('Failed to backup collection', {
            collection: collectionName,
            error: collectionError.message
          });
        }
      }

      const backupMetadata = {
        name: backupName,
        timestamp: new Date().toISOString(),
        database: mongoose.connection.name,
        collections: Object.keys(backupData),
        totalDocuments: Object.values(backupData).reduce((sum, docs) => sum + docs.length, 0)
      };

      logger.info('Database backup completed', backupMetadata);
      
      return {
        metadata: backupMetadata,
        data: backupData
      };
    } catch (error) {
      logger.error('Database backup failed', {
        error: error.message
      });
      throw error;
    }
  }

  async restore(backupData, options = {}) {
    try {
      if (!backupData.metadata || !backupData.data) {
        throw new Error('Invalid backup data format');
      }

      logger.info('Starting database restore', {
        backupName: backupData.metadata.name,
        collections: backupData.metadata.collections.length,
        totalDocuments: backupData.metadata.totalDocuments
      });

      if (options.dropExisting) {
        logger.warn('Dropping existing collections before restore');
        
        for (const collectionName of backupData.metadata.collections) {
          try {
            await mongoose.connection.db.collection(collectionName).drop();
          } catch (dropError) {
            if (dropError.code !== 26) {
              logger.warn('Failed to drop collection', {
                collection: collectionName,
                error: dropError.message
              });
            }
          }
        }
      }

      for (const [collectionName, documents] of Object.entries(backupData.data)) {
        try {
          const collection = mongoose.connection.db.collection(collectionName);
          
          if (documents.length > 0) {
            await collection.insertMany(documents, { ordered: false });
            logger.debug('Collection restored', {
              collection: collectionName,
              documents: documents.length
            });
          }
        } catch (restoreError) {
          logger.warn('Failed to restore collection', {
            collection: collectionName,
            error: restoreError.message
          });
        }
      }

      await this.setupIndexes();

      logger.info('Database restore completed', {
        backupName: backupData.metadata.name
      });
      
      return {
        success: true,
        restored: backupData.metadata.collections.length
      };
    } catch (error) {
      logger.error('Database restore failed', {
        error: error.message
      });
      throw error;
    }
  }

  async getCollectionNames() {
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      return collections.map(col => col.name).filter(name => !name.startsWith('system.'));
    } catch (error) {
      logger.error('Failed to get collection names', {
        error: error.message
      });
      return [];
    }
  }

  async optimizePerformance() {
    try {
      logger.info('Starting database performance optimization');

      const collections = await this.getCollectionNames();
      
      for (const collectionName of collections) {
        try {
          const collection = mongoose.connection.db.collection(collectionName);
          await collection.reIndex();
          
          logger.debug('Collection reindexed', {
            collection: collectionName
          });
        } catch (reindexError) {
          logger.warn('Failed to reindex collection', {
            collection: collectionName,
            error: reindexError.message
          });
        }
      }

      if (process.env.DB_ENABLE_PROFILING === 'true') {
        await mongoose.connection.db.setProfilingLevel(2, { slowms: 100 });
        logger.info('Database profiling enabled');
      }

      logger.info('Database performance optimization completed');
    } catch (error) {
      logger.error('Database performance optimization failed', {
        error: error.message
      });
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const databaseConfig = new DatabaseConfig();

module.exports = databaseConfig;