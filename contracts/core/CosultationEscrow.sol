pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./AccessControl.sol";
import "./DoctorRegistry.sol";

/**
 * @title Consultation Escrow
 * @dev Manages consultation payments and escrow with Bitcoin hooks
 */
contract ConsultationEscrow is DiagnoAccessControl, ReentrancyGuard {
    DoctorRegistry public immutable doctorRegistry;
    
    enum ConsultationStatus { 
        PENDING, 
        ACCEPTED,
        IN_PROGRESS, 
        COMPLETED, 
        DISPUTED, 
        CANCELLED,
        EXPIRED
    }

    struct Consultation {
        address patient;
        address doctor;
        uint256 fee;
        uint256 btcEquivalent; // BTC amount calculated by oracle
        string symptomsHash; // IPFS hash of encrypted symptoms
        string diagnosisHash; // IPFS hash of diagnosis
        ConsultationStatus status;
        uint256 createdAt;
        uint256 deadline;
        bool isUrgent;
        string specialty;
    }

    mapping(uint256 => Consultation) public consultations;
    mapping(address => uint256[]) public patientConsultations;
    mapping(address => uint256[]) public doctorConsultations;
    
    uint256 public nextConsultationId = 1; // Start from 1, not 0
    uint256 public constant CONSULTATION_TIMEOUT = 24 hours;
    uint256 public constant URGENT_CONSULTATION_TIMEOUT = 2 hours;
    uint256 public platformFeePercent = 300; // 3% (300 basis points)
    
    address public feeCollector;
    address public btcOracle;
    
    event ConsultationCreated(uint256 indexed consultationId, address indexed patient, address indexed doctor);
    event ConsultationAccepted(uint256 indexed consultationId, address indexed doctor);
    event DiagnosisSubmitted(uint256 indexed consultationId, string diagnosisHash);
    event PaymentReleased(uint256 indexed consultationId, address indexed doctor, uint256 amount);
    event ConsultationDisputed(uint256 indexed consultationId, address indexed disputer, string reason);
    event BTCPaymentCalculated(uint256 indexed consultationId, uint256 btcAmount);
    event ConsultationCancelled(uint256 indexed consultationId, string reason);

    constructor(address _doctorRegistry, address _feeCollector) {
        doctorRegistry = DoctorRegistry(_doctorRegistry);
        feeCollector = _feeCollector;
    }

    function setBtcOracle(address _btcOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        btcOracle = _btcOracle;
    }

    /**
     * @dev Patient creates consultation request
     */
    function createConsultation(
        address _doctor,
        string memory _symptomsHash,
        string memory _specialty,
        bool _isUrgent
    ) external payable whenNotPaused onlyPatient nonReentrant returns (uint256) {
        require(doctorRegistry.isVerifiedDoctor(_doctor), "Doctor not verified");
        require(msg.value > 0, "Fee required");
        require(bytes(_symptomsHash).length > 0, "Symptoms required");

        uint256 consultationId = nextConsultationId++;
        uint256 timeout = _isUrgent ? URGENT_CONSULTATION_TIMEOUT : CONSULTATION_TIMEOUT;

        consultations[consultationId] = Consultation({
            patient: msg.sender,
            doctor: _doctor,
            fee: msg.value,
            btcEquivalent: 0, // Set by oracle
            symptomsHash: _symptomsHash,
            diagnosisHash: "",
            status: ConsultationStatus.PENDING,
            createdAt: block.timestamp,
            deadline: block.timestamp + timeout,
            isUrgent: _isUrgent,
            specialty: _specialty
        });

        patientConsultations[msg.sender].push(consultationId);
        doctorConsultations[_doctor].push(consultationId);

        emit ConsultationCreated(consultationId, msg.sender, _doctor);
        return consultationId;
    }

    /**
     * @dev Doctor accepts consultation
     */
    function acceptConsultation(uint256 _consultationId) external onlyDoctor whenNotPaused {
        Consultation storage consultation = consultations[_consultationId];
        require(consultation.doctor == msg.sender, "Not assigned doctor");
        require(consultation.status == ConsultationStatus.PENDING, "Invalid status");
        require(block.timestamp <= consultation.deadline, "Expired");

        consultation.status = ConsultationStatus.ACCEPTED;
        emit ConsultationAccepted(_consultationId, msg.sender);
    }

    /**
     * @dev Doctor submits diagnosis and triggers payment
     */
    function submitDiagnosis(
        uint256 _consultationId, 
        string memory _diagnosisHash
    ) external onlyDoctor whenNotPaused {
        Consultation storage consultation = consultations[_consultationId];
        require(consultation.doctor == msg.sender, "Not assigned doctor");
        require(consultation.status == ConsultationStatus.ACCEPTED, "Not in progress");
        require(bytes(_diagnosisHash).length > 0, "Diagnosis required");

        consultation.diagnosisHash = _diagnosisHash;
        consultation.status = ConsultationStatus.COMPLETED;

        emit DiagnosisSubmitted(_consultationId, _diagnosisHash);
        _releasePayment(_consultationId);
    }

    function _releasePayment(uint256 _consultationId) internal {
        Consultation storage consultation = consultations[_consultationId];
        
        uint256 platformFee = (consultation.fee * platformFeePercent) / 10000;
        uint256 doctorPayment = consultation.fee - platformFee;

        (bool doctorSuccess,) = payable(consultation.doctor).call{value: doctorPayment}("");
        (bool feeSuccess,) = payable(feeCollector).call{value: platformFee}("");
        
        require(doctorSuccess && feeSuccess, "Payment failed");
        emit PaymentReleased(_consultationId, consultation.doctor, doctorPayment);
    }

    /**
     * @dev Dispute a completed consultation
     */
    function disputeConsultation(uint256 _consultationId, string memory _reason) external whenNotPaused {
        Consultation storage consultation = consultations[_consultationId];
        require(
            msg.sender == consultation.patient || msg.sender == consultation.doctor, 
            "Only consultation parties"
        );
        require(consultation.status == ConsultationStatus.COMPLETED, "Can only dispute completed");

        consultation.status = ConsultationStatus.DISPUTED;
        emit ConsultationDisputed(_consultationId, msg.sender, _reason);
    }

    function getConsultation(uint256 _consultationId) external view returns (Consultation memory) {
        return consultations[_consultationId];
    }

    function getPatientConsultations(address _patient) external view returns (uint256[] memory) {
        return patientConsultations[_patient];
    }

    function getDoctorConsultations(address _doctor) external view returns (uint256[] memory) {
        return doctorConsultations[_doctor];
    }
}