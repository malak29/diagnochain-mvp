const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const logger = require('../../backend/src/utils/logger');

class DatabaseMigrations {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'diagnochain',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    
    this.migrationsTable = 'schema_migrations';
    this.migrationsPath = path.join(__dirname);
    
    this.migrations = [
      {
        id: 1,
        name: 'initial_schema',
        description: 'Create initial database schema with all tables',
        file: 'schema.sql'
      },
      {
        id: 2,
        name: 'add_reputation_triggers',
        description: 'Add automatic reputation calculation triggers',
        sql: `
          CREATE OR REPLACE FUNCTION calculate_streak_bonus(p_doctor_id UUID)
          RETURNS INTEGER AS $$
          DECLARE
              consecutive_good_ratings INTEGER := 0;
              rating_record RECORD;
          BEGIN
              FOR rating_record IN 
                  SELECT rating 
                  FROM consultation_feedback f
                  JOIN consultations c ON f.consultation_id = c.id
                  WHERE c.doctor_id = p_doctor_id
                  ORDER BY f.created_at DESC
                  LIMIT 50
              LOOP
                  IF rating_record.rating >= 4 THEN
                      consecutive_good_ratings := consecutive_good_ratings + 1;
                  ELSE
                      EXIT;
                  END IF;
              END LOOP;
              
              UPDATE doctors 
              SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'), 
                  '{current_streak}', 
                  consecutive_good_ratings::text::jsonb
              )
              WHERE user_id = p_doctor_id;
              
              RETURN consecutive_good_ratings;
          END;
          $$ LANGUAGE plpgsql;
        `
      },
      {
        id: 3,
        name: 'add_payment_tracking',
        description: 'Enhanced payment tracking and status updates',
        sql: `
          ALTER TABLE btc_transactions ADD COLUMN IF NOT EXISTS 
          escrow_id VARCHAR(100) REFERENCES escrow_records(escrow_id);
          
          CREATE INDEX IF NOT EXISTS idx_btc_txns_escrow_id 
          ON btc_transactions(escrow_id);
          
          CREATE OR REPLACE FUNCTION update_transaction_status()
          RETURNS TRIGGER AS $$
          BEGIN
              IF NEW.confirmations >= 3 AND OLD.confirmations < 3 THEN
                  NEW.status = 'confirmed';
                  NEW.confirmed_at = NOW();
              END IF;
              RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
          
          CREATE TRIGGER update_btc_tx_status
              BEFORE UPDATE ON btc_transactions
              FOR EACH ROW
              EXECUTE FUNCTION update_transaction_status();
        `
      },
      {
        id: 4,
        name: 'add_dispute_resolution',
        description: 'Add dispute resolution tracking tables',
        sql: `
          CREATE TABLE IF NOT EXISTS dispute_cases (
              id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
              consultation_id UUID NOT NULL REFERENCES consultations(id),
              escrow_id VARCHAR(100) NOT NULL,
              disputed_by UUID NOT NULL REFERENCES users(id),
              dispute_reason TEXT NOT NULL,
              evidence_ipfs_hash VARCHAR(100),
              status VARCHAR(20) DEFAULT 'open',
              arbitrator_votes JSONB DEFAULT '[]',
              resolution JSONB,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              resolved_at TIMESTAMP WITH TIME ZONE,
              deadline TIMESTAMP WITH TIME ZONE NOT NULL,
              
              CONSTRAINT valid_dispute_status CHECK (status IN ('open', 'voting', 'resolved', 'expired'))
          );
          
          CREATE INDEX idx_disputes_consultation_id ON dispute_cases(consultation_id);
          CREATE INDEX idx_disputes_status ON dispute_cases(status);
          CREATE INDEX idx_disputes_deadline ON dispute_cases(deadline);
        `
      },
      {
        id: 5,
        name: 'add_analytics_tables',
        description: 'Add analytics and reporting tables',
        sql: `
          CREATE TABLE IF NOT EXISTS daily_stats (
              id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
              stat_date DATE NOT NULL UNIQUE,
              total_consultations INTEGER DEFAULT 0,
              completed_consultations INTEGER DEFAULT 0,
              total_revenue_eth DECIMAL(20,8) DEFAULT 0,
              total_revenue_btc DECIMAL(20,8) DEFAULT 0,
              new_patients INTEGER DEFAULT 0,
              new_doctors INTEGER DEFAULT 0,
              average_rating DECIMAL(3,2),
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              
              CONSTRAINT future_date_check CHECK (stat_date <= CURRENT_DATE)
          );
          
          CREATE OR REPLACE FUNCTION update_daily_stats()
          RETURNS VOID AS $$
          DECLARE
              today_date DATE := CURRENT_DATE;
          BEGIN
              INSERT INTO daily_stats (
                  stat_date,
                  total_consultations,
                  completed_consultations,
                  total_revenue_eth,
                  new_patients,
                  new_doctors,
                  average_rating
              )
              SELECT 
                  today_date,
                  COUNT(*),
                  COUNT(CASE WHEN status = 'completed' THEN 1 END),
                  SUM(fee_eth),
                  (SELECT COUNT(*) FROM users WHERE DATE(created_at) = today_date AND user_role = 'patient'),
                  (SELECT COUNT(*) FROM doctors WHERE DATE(created_at) = today_date),
                  AVG(f.rating)
              FROM consultations c
              LEFT JOIN consultation_feedback f ON c.id = f.consultation_id
              WHERE DATE(c.created_at) = today_date
              ON CONFLICT (stat_date) DO UPDATE SET
                  total_consultations = EXCLUDED.total_consultations,
                  completed_consultations = EXCLUDED.completed_consultations,
                  total_revenue_eth = EXCLUDED.total_revenue_eth,
                  new_patients = EXCLUDED.new_patients,
                  new_doctors = EXCLUDED.new_doctors,
                  average_rating = EXCLUDED.average_rating;
          END;
          $$ LANGUAGE plpgsql;
        `
      }
    ];
  }

  async createMigrationsTable() {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          description TEXT,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          success BOOLEAN DEFAULT TRUE,
          error_message TEXT,
          execution_time_ms INTEGER
        );
        
        CREATE INDEX IF NOT EXISTS idx_migrations_executed_at 
        ON ${this.migrationsTable}(executed_at DESC);
      `;

      await this.pool.query(createTableQuery);
      logger.info('Migrations table created/verified');

    } catch (error) {
      logger.error('Error creating migrations table:', error);
      throw error;
    }
  }

  async getExecutedMigrations() {
    try {
      const result = await this.pool.query(
        `SELECT id, name, executed_at FROM ${this.migrationsTable} 
         WHERE success = TRUE ORDER BY id ASC`
      );
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        executedAt: row.executed_at
      }));

    } catch (error) {
      if (error.code === '42P01') { // Table doesn't exist
        return [];
      }
      throw error;
    }
  }

  async executeMigration(migration) {
    const startTime = Date.now();
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      let sql;
      if (migration.file) {
        const filePath = path.join(path.dirname(__dirname), 'schemas', migration.file);
        sql = await fs.readFile(filePath, 'utf8');
      } else {
        sql = migration.sql;
      }

      await client.query(sql);

      const executionTime = Date.now() - startTime;
      
      await client.query(
        `INSERT INTO ${this.migrationsTable} (id, name, description, execution_time_ms)
         VALUES ($1, $2, $3, $4)`,
        [migration.id, migration.name, migration.description, executionTime]
      );

      await client.query('COMMIT');

      logger.info('Migration executed successfully:', {
        id: migration.id,
        name: migration.name,
        executionTime: `${executionTime}ms`
      });

      return { success: true, executionTime };

    } catch (error) {
      await client.query('ROLLBACK');
      
      const executionTime = Date.now() - startTime;
      
      try {
        await client.query(
          `INSERT INTO ${this.migrationsTable} (id, name, description, success, error_message, execution_time_ms)
           VALUES ($1, $2, $3, FALSE, $4, $5)`,
          [migration.id, migration.name, migration.description, error.message, executionTime]
        );
      } catch (insertError) {
        logger.error('Failed to record migration failure:', insertError);
      }

      logger.error('Migration failed:', {
        id: migration.id,
        name: migration.name,
        error: error.message
      });

      throw error;

    } finally {
      client.release();
    }
  }

  async runMigrations() {
    try {
      logger.info('Starting database migrations...');
      
      await this.createMigrationsTable();
      
      const executed = await this.getExecutedMigrations();
      const executedIds = new Set(executed.map(m => m.id));

      const pendingMigrations = this.migrations.filter(m => !executedIds.has(m.id));

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations found');
        return { success: true, executed: 0 };
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      let successCount = 0;
      let failureCount = 0;

      for (const migration of pendingMigrations) {
        try {
          await this.executeMigration(migration);
          successCount++;
        } catch (error) {
          failureCount++;
          
          if (migration.required !== false) {
            logger.error('Required migration failed, stopping:', migration.name);
            throw error;
          } else {
            logger.warn('Optional migration failed, continuing:', migration.name);
          }
        }
      }

      logger.info('Migration batch completed:', {
        successful: successCount,
        failed: failureCount,
        total: pendingMigrations.length
      });

      return {
        success: failureCount === 0,
        executed: successCount,
        failed: failureCount
      };

    } catch (error) {
      logger.error('Migration process failed:', error);
      throw error;
    }
  }

  async rollbackMigration(migrationId) {
    try {
      const migration = this.migrations.find(m => m.id === migrationId);
      if (!migration) {
        throw new Error(`Migration ${migrationId} not found`);
      }

      if (!migration.rollback) {
        throw new Error(`Migration ${migrationId} has no rollback defined`);
      }

      const client = await this.pool.connect();
      
      try {
        await client.query('BEGIN');
        await client.query(migration.rollback);
        await client.query(
          `DELETE FROM ${this.migrationsTable} WHERE id = $1`,
          [migrationId]
        );
        await client.query('COMMIT');

        logger.info('Migration rolled back:', migration.name);
        return { success: true };

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      logger.error('Rollback failed:', error);
      throw error;
    }
  }

  async seedTestData() {
    try {
      logger.info('Seeding test data...');

      const seedQueries = [
        // Additional test doctors
        `INSERT INTO users (eth_address, btc_address, user_role, is_verified) VALUES
         ('0xdoctor2345678901234567890123456789012345', 'tb1qtest2doctor2345678901234567890123456', 'doctor', TRUE),
         ('0xdoctor3456789012345678901234567890123456', 'tb1qtest3doctor3456789012345678901234567', 'doctor', TRUE)
         ON CONFLICT (eth_address) DO NOTHING`,

        // Test patients  
        `INSERT INTO users (eth_address, btc_address, user_role, is_verified) VALUES
         ('0xpatient234567890123456789012345678901234', 'tb1qtest2patient234567890123456789012345', 'patient', TRUE),
         ('0xpatient345678901234567890123456789012345', 'tb1qtest3patient345678901234567890123456', 'patient', TRUE)
         ON CONFLICT (eth_address) DO NOTHING`,

        // Doctor profiles
        `INSERT INTO doctors (user_id, license_number, institution, specialties, staked_amount, verification_status, verified_at)
         SELECT 
           u.id, 'MD67890', 'Johns Hopkins', 
           ARRAY['cardiology', 'general_practice'], 
           1500.00000000, 'approved', NOW()
         FROM users u WHERE u.eth_address = '0xdoctor2345678901234567890123456789012345'
         ON CONFLICT DO NOTHING`,

        `INSERT INTO doctors (user_id, license_number, institution, specialties, staked_amount, verification_status, verified_at)
         SELECT 
           u.id, 'MD11111', 'Mayo Clinic', 
           ARRAY['neurology', 'psychiatry'], 
           2000.00000000, 'approved', NOW()
         FROM users u WHERE u.eth_address = '0xdoctor3456789012345678901234567890123456'
         ON CONFLICT DO NOTHING`,

        // Sample consultations
        `INSERT INTO consultations (
           consultation_id, patient_id, doctor_id, specialty, symptoms_ipfs_hash,
           diagnosis_ipfs_hash, fee_eth, fee_btc, status, confidence_level,
           created_at, completed_at
         )
         SELECT 
           1001,
           p.id as patient_id,
           d.id as doctor_id,
           'dermatology',
           'QmTestSymptoms1234567890abcdef',
           'QmTestDiagnosis1234567890abcdef',
           0.05,
           0.00234,
           'completed',
           8,
           NOW() - INTERVAL '2 days',
           NOW() - INTERVAL '1 day'
         FROM users p, users d
         WHERE p.eth_address = '0xpatient234567890123456789012345678901234'
           AND d.eth_address = '0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc'
         ON CONFLICT (consultation_id) DO NOTHING`,

        // Sample feedback
        `INSERT INTO consultation_feedback (consultation_id, patient_id, doctor_id, rating, response_time_minutes)
         SELECT 
           c.id,
           c.patient_id,
           c.doctor_id,
           5,
           15
         FROM consultations c
         WHERE c.consultation_id = 1001
         ON CONFLICT (consultation_id, patient_id) DO NOTHING`,

        // Sample NFT
        `INSERT INTO diagnostic_nfts (
           token_id, consultation_id, patient_id, doctor_id,
           diagnosis_ipfs_hash, specialty, confidence_level
         )
         SELECT 
           1,
           c.id,
           c.patient_id,
           c.doctor_id,
           'QmTestDiagnosis1234567890abcdef',
           'dermatology',
           8
         FROM consultations c
         WHERE c.consultation_id = 1001
         ON CONFLICT (token_id) DO NOTHING`,

        // Sample BTC transactions
        `INSERT INTO btc_transactions (
           user_id, consultation_id, transaction_type, txid,
           amount_btc, to_address, status, confirmations
         )
         SELECT 
           d_user.id,
           c.id,
           'consultation_payment',
           encode(gen_random_bytes(32), 'hex'),
           0.00234,
           'tb1qtest1doctor1234567890123456789012345',
           'confirmed',
           6
         FROM consultations c
         JOIN users d_user ON c.doctor_id = d_user.id
         WHERE c.consultation_id = 1001`
      ];

      for (const query of seedQueries) {
        await this.pool.query(query);
      }

      logger.info('Test data seeded successfully');
      return { success: true };

    } catch (error) {
      logger.error('Error seeding test data:', error);
      throw error;
    }
  }

  async resetDatabase() {
    try {
      logger.warn('Resetting database - ALL DATA WILL BE LOST');

      const resetQueries = [
        'DROP SCHEMA public CASCADE',
        'CREATE SCHEMA public',
        'GRANT ALL ON SCHEMA public TO postgres',
        'GRANT ALL ON SCHEMA public TO public'
      ];

      for (const query of resetQueries) {
        await this.pool.query(query);
      }

      await this.runMigrations();
      
      logger.info('Database reset completed');
      return { success: true };

    } catch (error) {
      logger.error('Error resetting database:', error);
      throw error;
    }
  }

  async checkDatabaseHealth() {
    try {
      const healthChecks = [
        {
          name: 'connection',
          query: 'SELECT 1 as test',
          expected: 1
        },
        {
          name: 'users_table',
          query: 'SELECT COUNT(*) as count FROM users',
          expected: 'number'
        },
        {
          name: 'consultations_table', 
          query: 'SELECT COUNT(*) as count FROM consultations',
          expected: 'number'
        },
        {
          name: 'migrations_table',
          query: `SELECT COUNT(*) as count FROM ${this.migrationsTable}`,
          expected: 'number'
        }
      ];

      const results = {};

      for (const check of healthChecks) {
        try {
          const result = await this.pool.query(check.query);
          const value = result.rows[0][Object.keys(result.rows[0])[0]];
          
          results[check.name] = {
            status: 'healthy',
            value: value,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          results[check.name] = {
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          };
        }
      }

      const allHealthy = Object.values(results).every(r => r.status === 'healthy');

      return {
        overall: allHealthy ? 'healthy' : 'degraded',
        checks: results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        overall: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async optimizeDatabase() {
    try {
      logger.info('Running database optimization...');

      const optimizationQueries = [
        'VACUUM ANALYZE users',
        'VACUUM ANALYZE doctors', 
        'VACUUM ANALYZE consultations',
        'VACUUM ANALYZE consultation_feedback',
        'VACUUM ANALYZE btc_transactions',
        'VACUUM ANALYZE escrow_records',
        'REINDEX TABLE consultations',
        'REINDEX TABLE btc_transactions',
        'UPDATE pg_stat_user_tables SET n_mod_since_analyze = 0'
      ];

      const results = [];

      for (const query of optimizationQueries) {
        try {
          const startTime = Date.now();
          await this.pool.query(query);
          const duration = Date.now() - startTime;
          
          results.push({
            query: query.split(' ')[0] + ' ' + query.split(' ')[1],
            duration: `${duration}ms`,
            success: true
          });
        } catch (error) {
          results.push({
            query: query.split(' ')[0] + ' ' + query.split(' ')[1],
            success: false,
            error: error.message
          });
        }
      }

      logger.info('Database optimization completed:', {
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });

      return { success: true, results };

    } catch (error) {
      logger.error('Database optimization failed:', error);
      throw error;
    }
  }

  async exportData(tables = []) {
    try {
      const tablesToExport = tables.length > 0 ? tables : [
        'users', 'doctors', 'consultations', 'consultation_feedback',
        'diagnostic_nfts', 'btc_transactions', 'escrow_records'
      ];

      const exportData = {
        timestamp: new Date().toISOString(),
        database: process.env.DB_NAME,
        tables: {}
      };

      for (const table of tablesToExport) {
        try {
          const result = await this.pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
          exportData.tables[table] = {
            rowCount: result.rowCount,
            data: result.rows
          };
        } catch (error) {
          exportData.tables[table] = {
            error: error.message
          };
        }
      }

      logger.info('Data export completed:', {
        tables: Object.keys(exportData.tables).length,
        totalRows: Object.values(exportData.tables).reduce((sum, t) => sum + (t.rowCount || 0), 0)
      });

      return exportData;

    } catch (error) {
      logger.error('Error exporting data:', error);
      throw error;
    }
  }

  async getTableStats() {
    try {
      const statsQuery = `
        SELECT 
          schemaname,
          tablename,
          attname as column_name,
          n_distinct,
          most_common_vals,
          most_common_freqs
        FROM pg_stats 
        WHERE schemaname = 'public'
        ORDER BY tablename, attname;
      `;

      const result = await this.pool.query(statsQuery);
      
      const tableStats = {};
      result.rows.forEach(row => {
        if (!tableStats[row.tablename]) {
          tableStats[row.tablename] = [];
        }
        tableStats[row.tablename].push({
          column: row.column_name,
          distinctValues: row.n_distinct,
          commonValues: row.most_common_vals,
          frequencies: row.most_common_freqs
        });
      });

      return tableStats;

    } catch (error) {
      logger.error('Error getting table stats:', error);
      return {};
    }
  }

  async close() {
    try {
      await this.pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database pool:', error);
    }
  }
}

module.exports = new DatabaseMigrations();