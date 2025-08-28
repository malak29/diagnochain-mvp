pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title DiagnoChain Access Control
 * @dev Manages roles and permissions across the entire ecosystem
 */
contract DiagnoAccessControl is AccessControl, Pausable {
    bytes32 public constant DOCTOR_ROLE = keccak256("DOCTOR_ROLE");
    bytes32 public constant PATIENT_ROLE = keccak256("PATIENT_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    event RoleGrantedWithTimestamp(bytes32 indexed role, address indexed account, uint256 timestamp);
    event RoleRevokedWithTimestamp(bytes32 indexed role, address indexed account, uint256 timestamp);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    function grantRoleWithTimestamp(bytes32 role, address account) external onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
        emit RoleGrantedWithTimestamp(role, account, block.timestamp);
    }

    function revokeRoleWithTimestamp(bytes32 role, address account) external onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
        emit RoleRevokedWithTimestamp(role, account, block.timestamp);
    }

    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function emergencyUnpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    modifier onlyDoctor() {
        require(hasRole(DOCTOR_ROLE, msg.sender), "Must be verified doctor");
        _;
    }

    modifier onlyPatient() {
        require(hasRole(PATIENT_ROLE, msg.sender), "Must be registered patient");
        _;
    }

    modifier onlyVerifier() {
        require(hasRole(VERIFIER_ROLE, msg.sender), "Must be verified verifier");
        _;
    }
}