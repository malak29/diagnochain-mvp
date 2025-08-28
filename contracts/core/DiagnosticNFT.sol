pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./AccessControl.sol";
import "./ConsultationEscrow.sol";

/**
 * @title Diagnostic NFT
 * @dev Creates immutable NFTs for medical diagnoses and second opinions
 */
contract DiagnosticNFT is ERC721URIStorage, DiagnoAccessControl {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    ConsultationEscrow public immutable escrowContract;

    struct DiagnosticRecord {
        uint256 consultationId;
        address patient;
        address doctor;
        string diagnosisHash; // IPFS hash of encrypted diagnosis
        string specialty;
        uint256 diagnosisDate;
        bool isSecondOpinion;
        uint256 originalNFTId;
        uint8 confidenceLevel; // 1-10 scale
    }

    mapping(uint256 => DiagnosticRecord) public diagnosticRecords;
    mapping(address => uint256[]) public patientNFTs;
    mapping(address => uint256[]) public doctorNFTs;
    mapping(uint256 => uint256) public consultationToNFT; // consultationId => tokenId
    
    event DiagnosticNFTMinted(
        uint256 indexed tokenId, 
        uint256 indexed consultationId, 
        address indexed patient,
        address doctor
    );
    event SecondOpinionRequested(uint256 indexed originalNFTId, uint256 indexed newNFTId);
    event SecondOpinionCompleted(uint256 indexed nftId, string diagnosisHash);

    constructor(address _escrowContract) ERC721("DiagnoChain Medical Records", "DGMR") {
        escrowContract = ConsultationEscrow(_escrowContract);
    }

    /**
     * @dev Mints diagnostic NFT after consultation completion
     */
    function mintDiagnosticNFT(
        uint256 _consultationId,
        string memory _diagnosisHash,
        uint8 _confidenceLevel,
        string memory _metadataURI
    ) external onlyDoctor whenNotPaused returns (uint256) {
        require(_confidenceLevel >= 1 && _confidenceLevel <= 10, "Invalid confidence level");
        require(consultationToNFT[_consultationId] == 0, "NFT already minted");
        
        ConsultationEscrow.Consultation memory consultation = escrowContract.getConsultation(_consultationId);
        require(consultation.doctor == msg.sender, "Not assigned doctor");
        require(consultation.status == ConsultationEscrow.ConsultationStatus.COMPLETED, "Not completed");

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        diagnosticRecords[newTokenId] = DiagnosticRecord({
            consultationId: _consultationId,
            patient: consultation.patient,
            doctor: consultation.doctor,
            diagnosisHash: _diagnosisHash,
            specialty: consultation.specialty,
            diagnosisDate: block.timestamp,
            isSecondOpinion: false,
            originalNFTId: 0,
            confidenceLevel: _confidenceLevel
        });

        consultationToNFT[_consultationId] = newTokenId;
        
        _mint(consultation.patient, newTokenId);
        _setTokenURI(newTokenId, _metadataURI);
        
        patientNFTs[consultation.patient].push(newTokenId);
        doctorNFTs[consultation.doctor].push(newTokenId);

        emit DiagnosticNFTMinted(newTokenId, _consultationId, consultation.patient, consultation.doctor);
        return newTokenId;
    }

    /**
     * @dev Request second opinion on existing diagnosis
     */
    function requestSecondOpinion(
        uint256 _originalNFTId,
        address _secondDoctor,
        string memory _metadataURI
    ) external payable whenNotPaused returns (uint256) {
        require(ownerOf(_originalNFTId) == msg.sender, "Not NFT owner");
        require(doctorRegistry.isVerifiedDoctor(_secondDoctor), "Doctor not verified");
        require(msg.value > 0, "Payment required for second opinion");
        
        DiagnosticRecord storage originalRecord = diagnosticRecords[_originalNFTId];
        require(originalRecord.doctor != _secondDoctor, "Same doctor not allowed");

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        diagnosticRecords[newTokenId] = DiagnosticRecord({
            consultationId: 0, // No consultation for second opinions
            patient: msg.sender,
            doctor: _secondDoctor,
            diagnosisHash: "", // Empty until completed
            specialty: originalRecord.specialty,
            diagnosisDate: 0,
            isSecondOpinion: true,
            originalNFTId: _originalNFTId,
            confidenceLevel: 0
        });

        _mint(msg.sender, newTokenId);
        _setTokenURI(newTokenId, _metadataURI);

        emit SecondOpinionRequested(_originalNFTId, newTokenId);
        return newTokenId;
    }

    /**
     * @dev Complete second opinion diagnosis
     */
    function completeSecondOpinion(
        uint256 _nftId,
        string memory _diagnosisHash,
        uint8 _confidenceLevel
    ) external onlyDoctor whenNotPaused {
        DiagnosticRecord storage record = diagnosticRecords[_nftId];
        require(record.doctor == msg.sender, "Not assigned doctor");
        require(record.isSecondOpinion, "Not a second opinion");
        require(bytes(record.diagnosisHash).length == 0, "Already completed");

        record.diagnosisHash = _diagnosisHash;
        record.diagnosisDate = block.timestamp;
        record.confidenceLevel = _confidenceLevel;

        emit SecondOpinionCompleted(_nftId, _diagnosisHash);
        
        // Auto-release payment to second opinion doctor
        uint256 payment = address(this).balance; // Simplification for MVP
        if(payment > 0) {
            payable(msg.sender).transfer(payment);
        }
    }

    function getDiagnosticRecord(uint256 _tokenId) external view returns (DiagnosticRecord memory) {
        require(_exists(_tokenId), "Token doesn't exist");
        return diagnosticRecords[_tokenId];
    }

    // Medical records should generally not be transferable
    function transferFrom(address from, address to, uint256 tokenId) public override {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Medical records non-transferable");
        super.transferFrom(from, to, tokenId);
    }

    // Accept ETH for second opinion payments
    receive() external payable {}
}