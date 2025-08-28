pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./AccessControl.sol";

/**
 * @title Doctor Registry
 * @dev Handles doctor verification, staking, and credential management
 */
contract DoctorRegistry is DiagnoAccessControl, ReentrancyGuard {
    IERC20 public immutable stakingToken;
    
    struct Doctor {
        string ipfsCredentialsHash;
        string[] specialties;
        uint256 stakedAmount;
        uint256 reputationScore;
        uint256 totalConsultations;
        uint256 successfulDiagnoses;
        bool isActive;
        uint256 registrationTime;
    }

    struct VerificationRequest {
        address doctor;
        string credentialsHash;
        string[] specialties;
        uint256 stakingAmount;
        uint256 verifierVotes;
        uint256 totalVotes;
        bool isApproved;
        uint256 deadline;
    }

    mapping(address => Doctor) public doctors;
    mapping(uint256 => VerificationRequest) public verificationRequests;
    mapping(string => bool) public approvedSpecialties;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    
    uint256 public constant MIN_STAKE_AMOUNT = 1000 * 10**18; // 1000 tokens
    uint256 public constant VERIFICATION_PERIOD = 7 days;
    uint256 public constant MIN_VERIFIER_VOTES = 3;
    
    uint256 public nextRequestId;
    uint256 public totalStaked;

    event DoctorRegistrationRequested(uint256 indexed requestId, address indexed doctor);
    event DoctorVerified(address indexed doctor, string[] specialties);
    event DoctorStakeSlashed(address indexed doctor, uint256 amount, string reason);
    event ReputationUpdated(address indexed doctor, uint256 newScore);
    event SpecialtyAdded(string specialty);

    constructor(address _stakingToken) {
        stakingToken = IERC20(_stakingToken);
        
        // Add common medical specialties
        _addSpecialty("dermatology");
        _addSpecialty("cardiology");
        _addSpecialty("neurology");
        _addSpecialty("oncology");
        _addSpecialty("psychiatry");
        _addSpecialty("general_practice");
    }

    function _addSpecialty(string memory _specialty) internal {
        approvedSpecialties[_specialty] = true;
        emit SpecialtyAdded(_specialty);
    }

    function addSpecialty(string memory _specialty) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _addSpecialty(_specialty);
    }

    /**
     * @dev Doctor requests verification with credential staking
     */
    function requestVerification(
        string memory _credentialsHash,
        string[] memory _specialties,
        uint256 _stakeAmount
    ) external whenNotPaused {
        require(_stakeAmount >= MIN_STAKE_AMOUNT, "Insufficient stake");
        require(_specialties.length > 0, "Must specify specialties");
        require(!doctors[msg.sender].isActive, "Doctor already verified");
        
        // Validate specialties
        for(uint i = 0; i < _specialties.length; i++) {
            require(approvedSpecialties[_specialties[i]], "Invalid specialty");
        }

        // Transfer stake to contract
        require(stakingToken.transferFrom(msg.sender, address(this), _stakeAmount), "Stake transfer failed");

        uint256 requestId = nextRequestId++;
        verificationRequests[requestId] = VerificationRequest({
            doctor: msg.sender,
            credentialsHash: _credentialsHash,
            specialties: _specialties,
            stakingAmount: _stakeAmount,
            verifierVotes: 0,
            totalVotes: 0,
            isApproved: false,
            deadline: block.timestamp + VERIFICATION_PERIOD
        });

        emit DoctorRegistrationRequested(requestId, msg.sender);
    }

    /**
     * @dev Verifiers vote on doctor applications
     */
    function voteOnVerification(uint256 _requestId, bool _approve) external onlyVerifier whenNotPaused {
        VerificationRequest storage request = verificationRequests[_requestId];
        require(block.timestamp <= request.deadline, "Verification expired");
        require(!request.isApproved, "Already approved");
        require(!hasVoted[_requestId][msg.sender], "Already voted");

        hasVoted[_requestId][msg.sender] = true;
        request.totalVotes++;
        
        if(_approve) {
            request.verifierVotes++;
        }

        // Check if verification passes
        if(request.verifierVotes >= MIN_VERIFIER_VOTES && 
           request.verifierVotes * 2 > request.totalVotes) {
            _approveDoctor(_requestId);
        }
    }

    function _approveDoctor(uint256 _requestId) internal {
        VerificationRequest storage request = verificationRequests[_requestId];
        request.isApproved = true;

        doctors[request.doctor] = Doctor({
            ipfsCredentialsHash: request.credentialsHash,
            specialties: request.specialties,
            stakedAmount: request.stakingAmount,
            reputationScore: 1000, // Starting score (scaled by 1000)
            totalConsultations: 0,
            successfulDiagnoses: 0,
            isActive: true,
            registrationTime: block.timestamp
        });

        totalStaked += request.stakingAmount;
        _grantRole(DOCTOR_ROLE, request.doctor);
        
        emit DoctorVerified(request.doctor, request.specialties);
    }

    function slashStake(address _doctor, uint256 _amount, string memory _reason) 
        external onlyRole(EMERGENCY_ROLE) {
        require(doctors[_doctor].stakedAmount >= _amount, "Insufficient stake");
        
        doctors[_doctor].stakedAmount -= _amount;
        totalStaked -= _amount;
        
        require(stakingToken.transfer(msg.sender, _amount), "Slash failed");
        emit DoctorStakeSlashed(_doctor, _amount, _reason);
    }

    function updateReputation(address _doctor, uint256 _newScore) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Only admin");
        doctors[_doctor].reputationScore = _newScore;
        emit ReputationUpdated(_doctor, _newScore);
    }

    function isVerifiedDoctor(address _doctor) external view returns (bool) {
        return hasRole(DOCTOR_ROLE, _doctor) && doctors[_doctor].isActive;
    }

    function getDoctorInfo(address _doctor) external view returns (Doctor memory) {
        return doctors[_doctor];
    }
}