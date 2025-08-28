pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./AccessControl.sol";
import "./DoctorRegistry.sol";
import "./ConsultationEscrow.sol";

/**
 * @title Reputation System
 * @dev Manages doctor ratings, reputation scoring, and BTC reward distribution
 */
contract ReputationSystem is DiagnoAccessControl, ReentrancyGuard {
    DoctorRegistry public immutable doctorRegistry;
    ConsultationEscrow public immutable escrowContract;

    struct ReputationMetrics {
        uint256 totalRating; // Sum of all ratings
        uint256 ratingCount; // Number of ratings received
        uint256 averageRating; // Scaled by 1000 (e.g., 4500 = 4.5 stars)
        uint256 streak; // Consecutive good ratings (4+ stars)
        uint256 lastRewardClaim;
        uint256 totalRewardsEarned;
        uint256 responseTimeAvg; // Average response time in minutes
    }

    struct PatientFeedback {
        uint256 rating; // 1-5 scale
        string commentHash; // IPFS hash of encrypted comment
        bool isVerified;
        uint256 timestamp;
        uint256 responseTime; // How long doctor took to respond
    }

    mapping(address => ReputationMetrics) public doctorMetrics;
    mapping(uint256 => PatientFeedback) public consultationFeedback;
    mapping(address => mapping(uint256 => bool)) public hasClaimedDaily; // doctor => day => claimed
    
    uint256 public constant MAX_RATING = 5;
    uint256 public constant MIN_RATING = 1;
    uint256 public constant STREAK_THRESHOLD = 10;
    uint256 public constant GOOD_RATING_THRESHOLD = 4;
    uint256 public dailyRewardPool = 0.01 ether;
    
    uint256 public totalDoctorsEligible;
    
    event FeedbackSubmitted(uint256 indexed consultationId, uint256 rating, address indexed doctor);
    event ReputationUpdated(address indexed doctor, uint256 newAverage, uint256 streak);
    event RewardClaimed(address indexed doctor, uint256 amount);
    event StreakBonusEarned(address indexed doctor, uint256 streakLength, uint256 bonus);
    event RewardPoolFunded(uint256 amount);

    constructor(address _doctorRegistry, address _escrowContract) {
        doctorRegistry = DoctorRegistry(_doctorRegistry);
        escrowContract = ConsultationEscrow(_escrowContract);
    }

    /**
     * @dev Patient submits feedback for completed consultation
     */
    function submitFeedback(
        uint256 _consultationId,
        uint256 _rating,
        string memory _commentHash
    ) external onlyPatient whenNotPaused {
        require(_rating >= MIN_RATING && _rating <= MAX_RATING, "Invalid rating");
        require(consultationFeedback[_consultationId].timestamp == 0, "Feedback exists");
        
        ConsultationEscrow.Consultation memory consultation = escrowContract.getConsultation(_consultationId);
        require(consultation.patient == msg.sender, "Not your consultation");
        require(consultation.status == ConsultationEscrow.ConsultationStatus.COMPLETED, "Not completed");

        // Calculate response time
        uint256 responseTime = (consultation.deadline - consultation.createdAt) / 60; // minutes

        consultationFeedback[_consultationId] = PatientFeedback({
            rating: _rating,
            commentHash: _commentHash,
            isVerified: true,
            timestamp: block.timestamp,
            responseTime: responseTime
        });

        _updateDoctorReputation(consultation.doctor, _rating, responseTime);
        emit FeedbackSubmitted(_consultationId, _rating, consultation.doctor);
    }

    function _updateDoctorReputation(address _doctor, uint256 _rating, uint256 _responseTime) internal {
        ReputationMetrics storage metrics = doctorMetrics[_doctor];
        
        // Update rating metrics
        metrics.totalRating += _rating;
        metrics.ratingCount++;
        metrics.averageRating = (metrics.totalRating * 1000) / metrics.ratingCount;

        // Update response time average
        if(metrics.responseTimeAvg == 0) {
            metrics.responseTimeAvg = _responseTime;
        } else {
            metrics.responseTimeAvg = (metrics.responseTimeAvg + _responseTime) / 2;
        }

        // Update streak
        if(_rating >= GOOD_RATING_THRESHOLD) {
            metrics.streak++;
            
            // Distribute streak bonus
            if(metrics.streak >= STREAK_THRESHOLD && metrics.streak % STREAK_THRESHOLD == 0) {
                _distributeStreakBonus(_doctor);
            }
        } else {
            metrics.streak = 0; // Reset on poor rating
        }

        // Update doctor registry
        doctorRegistry.updateReputation(_doctor, metrics.averageRating);
        
        emit ReputationUpdated(_doctor, metrics.averageRating, metrics.streak);
    }

    function _distributeStreakBonus(address _doctor) internal {
        uint256 bonus = dailyRewardPool / 20; // 5% of daily pool
        if(address(this).balance >= bonus) {
            doctorMetrics[_doctor].totalRewardsEarned += bonus;
            
            (bool success,) = payable(_doctor).call{value: bonus}("");
            require(success, "Bonus transfer failed");
            
            emit StreakBonusEarned(_doctor, doctorMetrics[_doctor].streak, bonus);
        }
    }

    /**
     * @dev High-performing doctors claim daily BTC-equivalent rewards
     */
    function claimDailyReward() external onlyDoctor whenNotPaused nonReentrant {
        uint256 today = block.timestamp / 1 days;
        require(!hasClaimedDaily[msg.sender][today], "Already claimed today");
        
        ReputationMetrics storage metrics = doctorMetrics[msg.sender];
        require(metrics.averageRating >= 4000, "Need 4.0+ rating"); // 4000/1000 = 4.0
        require(metrics.ratingCount >= 5, "Need minimum 5 ratings");
        
        // Calculate reward based on reputation and efficiency
        uint256 baseReward = dailyRewardPool / totalDoctorsEligible;
        uint256 reputationBonus = (metrics.averageRating - 4000) * baseReward / 1000; // Bonus for >4.0
        
        // Fast response bonus (under 30 min average)
        uint256 speedBonus = metrics.responseTimeAvg <= 30 ? baseReward / 4 : 0;
        
        uint256 totalReward = baseReward + reputationBonus + speedBonus;
        
        if(address(this).balance >= totalReward) {
            hasClaimedDaily[msg.sender][today] = true;
            metrics.lastRewardClaim = block.timestamp;
            metrics.totalRewardsEarned += totalReward;
            
            (bool success,) = payable(msg.sender).call{value: totalReward}("");
            require(success, "Reward transfer failed");
            
            emit RewardClaimed(msg.sender, totalReward);
        }
    }

    /**
     * @dev Fund the reward pool (accepts ETH, BTC integration via oracle)
     */
    function fundRewardPool() external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        require(msg.value > 0, "Must send ETH");
        emit RewardPoolFunded(msg.value);
    }

    function updateDailyRewardPool(uint256 _newAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyRewardPool = _newAmount;
    }

    function updateEligibleDoctorsCount(uint256 _count) external onlyRole(ORACLE_ROLE) {
        totalDoctorsEligible = _count;
    }

    function getDoctorMetrics(address _doctor) external view returns (ReputationMetrics memory) {
        return doctorMetrics[_doctor];
    }

    function getConsultationFeedback(uint256 _consultationId) external view returns (PatientFeedback memory) {
        return consultationFeedback[_consultationId];
    }

    // Accept ETH deposits for reward pool
    receive() external payable {
        emit RewardPoolFunded(msg.value);
    }
}