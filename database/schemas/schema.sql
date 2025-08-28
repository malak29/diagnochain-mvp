-- DiagnoChain Database Schema
-- PostgreSQL 14+ with UUID extension

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop tables if they exist (for clean setup)
DROP TABLE IF EXISTS consultation_feedback CASCADE;
DROP TABLE IF EXISTS diagnostic_nfts CASCADE;
DROP TABLE IF EXISTS consultations CASCADE;
DROP TABLE IF EXISTS doctor_verifications CASCADE;
DROP TABLE IF EXISTS btc_transactions CASCADE;
DROP TABLE IF EXISTS escrow_records CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS doctors CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Core user management
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    eth_address VARCHAR(42) NOT NULL UNIQUE,
    btc_address VARCHAR(62),
    user_role VARCHAR(20) NOT NULL DEFAULT 'patient',
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT valid_eth_address CHECK (eth_address ~* '^0x[a-f0-9]{40}$'),
    CONSTRAINT valid_user_role CHECK (user_role IN ('patient', 'doctor', 'verifier', 'admin')),
    CONSTRAINT valid_btc_address CHECK (btc_address IS NULL OR length(btc_address) BETWEEN 26 AND 62)
);

-- Doctor-specific information
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    license_number VARCHAR(50),
    institution VARCHAR(255),
    specialties TEXT[] NOT NULL DEFAULT '{}',
    credentials_ipfs_hash VARCHAR(100),
    staked_amount DECIMAL(20,8) DEFAULT 0,
    reputation_score INTEGER DEFAULT 1000,
    total_consultations INTEGER DEFAULT 0,
    successful_diagnoses INTEGER DEFAULT 0,
    average_response_time_minutes INTEGER DEFAULT 0,
    verification_status VARCHAR(20) DEFAULT 'pending',
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_reputation CHECK (reputation_score >= 0 AND reputation_score <= 5000),
    CONSTRAINT valid_verification_status CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
    CONSTRAINT positive_staked_amount CHECK (staked_amount >= 0)
);

-- Doctor verification process tracking
CREATE TABLE doctor_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    request_id INTEGER NOT NULL,
    credentials_hash VARCHAR(100) NOT NULL,
    stake_amount DECIMAL(20,8) NOT NULL,
    verifier_votes INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    is_approved BOOLEAN DEFAULT FALSE,
    verification_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT positive_stake CHECK (stake_amount > 0),
    CONSTRAINT valid_votes CHECK (verifier_votes <= total_votes)
);

-- Medical consultations
CREATE TABLE consultations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id INTEGER NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialty VARCHAR(50) NOT NULL,
    symptoms_ipfs_hash VARCHAR(100) NOT NULL,
    diagnosis_ipfs_hash VARCHAR(100),
    fee_eth DECIMAL(20,8) NOT NULL,
    fee_btc DECIMAL(20,8),
    is_urgent BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending',
    confidence_level INTEGER,
    follow_up_recommendation VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    accepted_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'disputed', 'cancelled', 'expired')),
    CONSTRAINT valid_confidence CHECK (confidence_level IS NULL OR (confidence_level >= 1 AND confidence_level <= 10)),
    CONSTRAINT valid_specialty CHECK (specialty IN ('general_practice', 'dermatology', 'cardiology', 'neurology', 'oncology', 'psychiatry')),
    CONSTRAINT positive_fees CHECK (fee_eth > 0),
    CONSTRAINT valid_follow_up CHECK (follow_up_recommendation IS NULL OR follow_up_recommendation IN ('none', '1week', '2weeks', '1month', 'specialist', 'emergency'))
);

-- NFT records for diagnoses
CREATE TABLE diagnostic_nfts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id INTEGER NOT NULL UNIQUE,
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diagnosis_ipfs_hash VARCHAR(100) NOT NULL,
    metadata_ipfs_hash VARCHAR(100),
    specialty VARCHAR(50) NOT NULL,
    confidence_level INTEGER NOT NULL,
    is_second_opinion BOOLEAN DEFAULT FALSE,
    original_nft_id UUID REFERENCES diagnostic_nfts(id),
    minted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blockchain_tx_hash VARCHAR(66),
    
    CONSTRAINT valid_token_id CHECK (token_id > 0),
    CONSTRAINT valid_confidence_nft CHECK (confidence_level >= 1 AND confidence_level <= 10),
    CONSTRAINT second_opinion_logic CHECK (
        (is_second_opinion = FALSE AND original_nft_id IS NULL) OR
        (is_second_opinion = TRUE AND original_nft_id IS NOT NULL)
    )
);

-- Patient feedback and ratings
CREATE TABLE consultation_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment_ipfs_hash VARCHAR(100),
    response_time_minutes INTEGER,
    is_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_rating CHECK (rating >= 1 AND rating <= 5),
    CONSTRAINT positive_response_time CHECK (response_time_minutes IS NULL OR response_time_minutes >= 0),
    CONSTRAINT unique_consultation_feedback UNIQUE (consultation_id, patient_id)
);

-- Bitcoin transaction tracking
CREATE TABLE btc_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,
    transaction_type VARCHAR(30) NOT NULL,
    txid VARCHAR(64) UNIQUE,
    amount_btc DECIMAL(20,8) NOT NULL,
    amount_usd DECIMAL(10,2),
    fee_btc DECIMAL(20,8),
    from_address VARCHAR(62),
    to_address VARCHAR(62) NOT NULL,
    payment_method VARCHAR(20) DEFAULT 'onchain',
    status VARCHAR(20) DEFAULT 'pending',
    confirmations INTEGER DEFAULT 0,
    block_height INTEGER,
    lightning_payment_hash VARCHAR(64),
    lightning_preimage VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('consultation_payment', 'doctor_reward', 'daily_reward', 'platform_fee', 'refund', 'arbitrator_fee')),
    CONSTRAINT valid_payment_method CHECK (payment_method IN ('onchain', 'lightning', 'multisig')),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
    CONSTRAINT positive_amount CHECK (amount_btc > 0),
    CONSTRAINT positive_confirmations CHECK (confirmations >= 0)
);

-- Escrow records for payment management
CREATE TABLE escrow_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_id VARCHAR(100) NOT NULL UNIQUE,
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_btc DECIMAL(20,8) NOT NULL,
    escrow_address VARCHAR(62),
    redeem_script TEXT,
    status VARCHAR(20) DEFAULT 'created',
    payment_method VARCHAR(20) DEFAULT 'lightning',
    funded_at TIMESTAMP WITH TIME ZONE,
    released_at TIMESTAMP WITH TIME ZONE,
    refunded_at TIMESTAMP WITH TIME ZONE,
    dispute_reason TEXT,
    resolution_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    CONSTRAINT valid_escrow_status CHECK (status IN ('created', 'funded', 'released', 'refunded', 'disputed', 'expired')),
    CONSTRAINT positive_escrow_amount CHECK (amount_btc > 0)
);

-- User role assignments and permissions
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name VARCHAR(20) NOT NULL,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    
    CONSTRAINT valid_role_name CHECK (role_name IN ('patient', 'doctor', 'verifier', 'oracle', 'admin', 'emergency')),
    UNIQUE(user_id, role_name)
);

-- Indexes for performance optimization
CREATE INDEX idx_users_eth_address ON users(eth_address);
CREATE INDEX idx_users_btc_address ON users(btc_address);
CREATE INDEX idx_users_role ON users(user_role);
CREATE INDEX idx_users_created_at ON users(created_at);

CREATE INDEX idx_doctors_user_id ON doctors(user_id);
CREATE INDEX idx_doctors_specialties ON doctors USING GIN(specialties);
CREATE INDEX idx_doctors_reputation ON doctors(reputation_score DESC);
CREATE INDEX idx_doctors_verification_status ON doctors(verification_status);

CREATE INDEX idx_consultations_consultation_id ON consultations(consultation_id);
CREATE INDEX idx_consultations_patient_id ON consultations(patient_id);
CREATE INDEX idx_consultations_doctor_id ON consultations(doctor_id);
CREATE INDEX idx_consultations_status ON consultations(status);
CREATE INDEX idx_consultations_specialty ON consultations(specialty);
CREATE INDEX idx_consultations_created_at ON consultations(created_at DESC);
CREATE INDEX idx_consultations_deadline ON consultations(deadline);

CREATE INDEX idx_nfts_token_id ON diagnostic_nfts(token_id);
CREATE INDEX idx_nfts_patient_id ON diagnostic_nfts(patient_id);
CREATE INDEX idx_nfts_doctor_id ON diagnostic_nfts(doctor_id);
CREATE INDEX idx_nfts_consultation_id ON diagnostic_nfts(consultation_id);
CREATE INDEX idx_nfts_minted_at ON diagnostic_nfts(minted_at DESC);

CREATE INDEX idx_feedback_consultation_id ON consultation_feedback(consultation_id);
CREATE INDEX idx_feedback_doctor_id ON consultation_feedback(doctor_id);
CREATE INDEX idx_feedback_rating ON consultation_feedback(rating);
CREATE INDEX idx_feedback_created_at ON consultation_feedback(created_at DESC);

CREATE INDEX idx_btc_txns_txid ON btc_transactions(txid);
CREATE INDEX idx_btc_txns_user_id ON btc_transactions(user_id);
CREATE INDEX idx_btc_txns_consultation_id ON btc_transactions(consultation_id);
CREATE INDEX idx_btc_txns_type ON btc_transactions(transaction_type);
CREATE INDEX idx_btc_txns_status ON btc_transactions(status);
CREATE INDEX idx_btc_txns_created_at ON btc_transactions(created_at DESC);

CREATE INDEX idx_escrow_escrow_id ON escrow_records(escrow_id);
CREATE INDEX idx_escrow_consultation_id ON escrow_records(consultation_id);
CREATE INDEX idx_escrow_status ON escrow_records(status);
CREATE INDEX idx_escrow_expires_at ON escrow_records(expires_at);

-- Functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE VIEW active_doctors AS
SELECT 
    u.eth_address,
    u.btc_address,
    d.license_number,
    d.institution,
    d.specialties,
    d.reputation_score,
    d.total_consultations,
    d.average_response_time_minutes,
    d.verification_status,
    d.created_at
FROM users u
JOIN doctors d ON u.id = d.user_id
WHERE u.is_active = TRUE 
  AND d.verification_status = 'approved'
  AND u.user_role = 'doctor';

CREATE VIEW consultation_summary AS
SELECT 
    c.consultation_id,
    c.specialty,
    c.status,
    c.is_urgent,
    c.fee_eth,
    c.fee_btc,
    c.confidence_level,
    c.created_at,
    c.completed_at,
    p_user.eth_address as patient_address,
    d_user.eth_address as doctor_address,
    d.reputation_score as doctor_reputation,
    f.rating as patient_rating,
    f.response_time_minutes,
    nft.token_id as nft_token_id
FROM consultations c
JOIN users p_user ON c.patient_id = p_user.id
JOIN users d_user ON c.doctor_id = d_user.id
JOIN doctors d ON d_user.id = d.user_id
LEFT JOIN consultation_feedback f ON c.id = f.consultation_id
LEFT JOIN diagnostic_nfts nft ON c.id = nft.consultation_id;

CREATE VIEW doctor_performance AS
SELECT 
    u.eth_address as doctor_address,
    d.reputation_score,
    d.total_consultations,
    d.successful_diagnoses,
    d.average_response_time_minutes,
    COALESCE(AVG(f.rating), 0) as average_rating,
    COUNT(f.id) as total_ratings,
    COUNT(CASE WHEN f.rating >= 4 THEN 1 END) as good_ratings,
    COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_consultations,
    SUM(c.fee_eth) as total_earnings_eth,
    SUM(bt.amount_btc) as total_earnings_btc
FROM doctors d
JOIN users u ON d.user_id = u.id
LEFT JOIN consultations c ON d.user_id = c.doctor_id
LEFT JOIN consultation_feedback f ON c.id = f.consultation_id
LEFT JOIN btc_transactions bt ON c.id = bt.consultation_id AND bt.transaction_type = 'consultation_payment'
WHERE u.user_role = 'doctor' AND u.is_active = TRUE
GROUP BY u.id, u.eth_address, d.reputation_score, d.total_consultations, d.successful_diagnoses, d.average_response_time_minutes;

-- Stored procedures for common operations
CREATE OR REPLACE FUNCTION create_user_with_role(
    p_eth_address VARCHAR(42),
    p_btc_address VARCHAR(62) DEFAULT NULL,
    p_user_role VARCHAR(20) DEFAULT 'patient'
)
RETURNS UUID AS $$
DECLARE
    new_user_id UUID;
BEGIN
    INSERT INTO users (eth_address, btc_address, user_role)
    VALUES (p_eth_address, p_btc_address, p_user_role)
    RETURNING id INTO new_user_id;
    
    INSERT INTO user_roles (user_id, role_name)
    VALUES (new_user_id, p_user_role);
    
    RETURN new_user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION register_doctor(
    p_user_id UUID,
    p_license_number VARCHAR(50),
    p_institution VARCHAR(255),
    p_specialties TEXT[],
    p_credentials_hash VARCHAR(100),
    p_stake_amount DECIMAL(20,8)
)
RETURNS UUID AS $$
DECLARE
    doctor_id UUID;
BEGIN
    INSERT INTO doctors (
        user_id, license_number, institution, specialties, 
        credentials_ipfs_hash, staked_amount
    )
    VALUES (
        p_user_id, p_license_number, p_institution, p_specialties,
        p_credentials_hash, p_stake_amount
    )
    RETURNING id INTO doctor_id;
    
    UPDATE users SET user_role = 'doctor' WHERE id = p_user_id;
    
    INSERT INTO user_roles (user_id, role_name)
    VALUES (p_user_id, 'doctor');
    
    RETURN doctor_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_consultation(
    p_consultation_id INTEGER,
    p_diagnosis_hash VARCHAR(100),
    p_confidence_level INTEGER,
    p_follow_up VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    consultation_record RECORD;
BEGIN
    SELECT * INTO consultation_record 
    FROM consultations 
    WHERE consultation_id = p_consultation_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Consultation not found: %', p_consultation_id;
    END IF;
    
    IF consultation_record.status != 'accepted' THEN
        RAISE EXCEPTION 'Consultation not in accepted status: %', consultation_record.status;
    END IF;
    
    UPDATE consultations
    SET 
        diagnosis_ipfs_hash = p_diagnosis_hash,
        confidence_level = p_confidence_level,
        follow_up_recommendation = p_follow_up,
        status = 'completed',
        completed_at = NOW()
    WHERE consultation_id = p_consultation_id;
    
    UPDATE doctors
    SET 
        total_consultations = total_consultations + 1,
        successful_diagnoses = successful_diagnoses + 1
    WHERE user_id = consultation_record.doctor_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate doctor reputation
CREATE OR REPLACE FUNCTION update_doctor_reputation(p_doctor_id UUID)
RETURNS INTEGER AS $$
DECLARE
    avg_rating DECIMAL;
    new_reputation INTEGER;
    total_ratings INTEGER;
BEGIN
    SELECT 
        AVG(rating)::DECIMAL,
        COUNT(*)
    INTO avg_rating, total_ratings
    FROM consultation_feedback f
    JOIN consultations c ON f.consultation_id = c.id
    WHERE c.doctor_id = p_doctor_id;
    
    IF total_ratings = 0 THEN
        new_reputation := 1000; -- Default reputation
    ELSE
        -- Scale rating (1-5) to reputation score (0-5000)
        new_reputation := GREATEST(0, LEAST(5000, ROUND(avg_rating * 1000)));
    END IF;
    
    UPDATE doctors
    SET reputation_score = new_reputation
    WHERE user_id = p_doctor_id;
    
    RETURN new_reputation;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update doctor reputation after feedback
CREATE OR REPLACE FUNCTION trigger_reputation_update()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_doctor_reputation(
        (SELECT doctor_id FROM consultations WHERE id = NEW.consultation_id)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_reputation_after_feedback
    AFTER INSERT ON consultation_feedback
    FOR EACH ROW
    EXECUTE FUNCTION trigger_reputation_update();

-- Initial data seeds
INSERT INTO users (eth_address, btc_address, user_role, is_verified) VALUES
('0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc', 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'doctor', TRUE),
('0x1234567890123456789012345678901234567890', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'patient', TRUE),
('0x987fed321cba987fed321cba987fed321cba9876', 'tb1q9vlzqrpx3qxzqrpx3qxzqrpx3qxzqrpx3qxzqr', 'verifier', TRUE);

-- Insert test doctor
INSERT INTO doctors (user_id, license_number, institution, specialties, staked_amount, verification_status, verified_at)
SELECT 
    id, 'MD12345', 'Stanford Medical School', 
    ARRAY['dermatology', 'general_practice'], 
    1000.00000000, 'approved', NOW()
FROM users WHERE eth_address = '0x742d35cc9f8f34d9b9c8c7d2b4b1234567890abc';

-- Grant roles
INSERT INTO user_roles (user_id, role_name)
SELECT id, user_role FROM users WHERE user_role IN ('doctor', 'patient', 'verifier');

-- Create admin user
INSERT INTO users (eth_address, user_role, is_verified) VALUES
('0xadmin123456789abcdef123456789abcdef123456', 'admin', TRUE);

INSERT INTO user_roles (user_id, role_name)
SELECT id, 'admin' FROM users WHERE eth_address = '0xadmin123456789abcdef123456789abcdef123456';

-- Performance optimization settings
ALTER TABLE consultations SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE btc_transactions SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE consultation_feedback SET (autovacuum_vacuum_scale_factor = 0.2);

-- Additional constraints for data integrity
ALTER TABLE consultations ADD CONSTRAINT deadline_after_creation 
CHECK (deadline > created_at);

ALTER TABLE consultations ADD CONSTRAINT completed_after_creation 
CHECK (completed_at IS NULL OR completed_at > created_at);

ALTER TABLE escrow_records ADD CONSTRAINT expires_after_creation 
CHECK (expires_at > created_at);

ALTER TABLE btc_transactions ADD CONSTRAINT confirmed_after_creation 
CHECK (confirmed_at IS NULL OR confirmed_at >= created_at);

-- Comments for documentation
COMMENT ON TABLE users IS 'Core user accounts with Ethereum addresses';
COMMENT ON TABLE doctors IS 'Extended doctor profiles with medical credentials';
COMMENT ON TABLE consultations IS 'Medical consultations with payment tracking';
COMMENT ON TABLE diagnostic_nfts IS 'NFT records for immutable diagnoses';
COMMENT ON TABLE consultation_feedback IS 'Patient ratings and feedback';
COMMENT ON TABLE btc_transactions IS 'Bitcoin payment transaction log';
COMMENT ON TABLE escrow_records IS 'Payment escrow management';
COMMENT ON TABLE user_roles IS 'Role-based access control';

COMMENT ON COLUMN users.eth_address IS 'Ethereum wallet address (lowercase)';
COMMENT ON COLUMN users.btc_address IS 'Bitcoin address for payments';
COMMENT ON COLUMN doctors.reputation_score IS 'Reputation score (0-5000, scaled by 1000)';
COMMENT ON COLUMN consultations.fee_eth IS 'Consultation fee in ETH';
COMMENT ON COLUMN consultations.fee_btc IS 'Equivalent fee in BTC';
COMMENT ON COLUMN btc_transactions.amount_btc IS 'Transaction amount in BTC';

-- Grant permissions (adjust for your setup)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO diagnochain_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO diagnochain_app;

-- Final success message
SELECT 'DiagnoChain database schema created successfully!' as status;