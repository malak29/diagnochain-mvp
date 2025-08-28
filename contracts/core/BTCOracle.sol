pragma solidity ^0.8.19;

import "./AccessControl.sol";

/**
 * @title Bitcoin Oracle
 * @dev Provides BTC price feeds and manages Bitcoin payment coordination
 */
contract BTCOracle is DiagnoAccessControl {
    struct PriceData {
        uint256 price; // BTC price in USD (scaled by 10^8)
        uint256 timestamp;
        bool isActive;
    }

    struct BTCPayment {
        uint256 consultationId;
        uint256 ethAmount;
        uint256 btcAmount; // Satoshis
        string btcAddress;
        string txHash;
        bool isPaid;
        uint256 createdAt;
    }

    PriceData public latestPrice;
    mapping(uint256 => BTCPayment) public btcPayments; // consultationId => payment
    mapping(string => bool) public usedTxHashes;
    
    uint256 public constant PRICE_VALIDITY_PERIOD = 15 minutes;
    uint256 public constant SATOSHIS_PER_BTC = 100_000_000;
    
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event BTCPaymentCreated(uint256 indexed consultationId, uint256 btcAmount, string btcAddress);
    event BTCPaymentConfirmed(uint256 indexed consultationId, string txHash);
    event LightningPaymentRequest(uint256 indexed consultationId, string invoice);

    constructor() {
        // Initialize with approximate BTC price (will be updated by oracle)
        latestPrice = PriceData({
            price: 43000 * 10**8, // $43,000 USD scaled
            timestamp: block.timestamp,
            isActive: true
        });
    }

    /**
     * @dev Oracle updates BTC price feed
     */
    function updateBTCPrice(uint256 _priceUSD) external onlyRole(ORACLE_ROLE) {
        require(_priceUSD > 0, "Invalid price");
        
        latestPrice = PriceData({
            price: _priceUSD,
            timestamp: block.timestamp,
            isActive: true
        });
        
        emit PriceUpdated(_priceUSD, block.timestamp);
    }

    /**
     * @dev Calculate BTC equivalent for ETH consultation fee
     */
    function calculateBTCAmount(uint256 _ethAmount) public view returns (uint256) {
        require(isPriceValid(), "Price data stale");
        
        // Simplified: assume 1 ETH = $2000 for MVP
        uint256 ethPriceUSD = 2000 * 10**8; // $2000 scaled
        uint256 usdAmount = (_ethAmount * ethPriceUSD) / 10**18; // Convert wei to USD
        
        return (usdAmount * SATOSHIS_PER_BTC) / latestPrice.price; // USD to satoshis
    }

    /**
     * @dev Create BTC payment request for consultation
     */
    function createBTCPayment(
        uint256 _consultationId,
        uint256 _ethAmount,
        string memory _btcAddress
    ) external onlyRole(ORACLE_ROLE) returns (uint256) {
        require(btcPayments[_consultationId].createdAt == 0, "Payment already exists");
        
        uint256 btcAmount = calculateBTCAmount(_ethAmount);
        
        btcPayments[_consultationId] = BTCPayment({
            consultationId: _consultationId,
            ethAmount: _ethAmount,
            btcAmount: btcAmount,
            btcAddress: _btcAddress,
            txHash: "",
            isPaid: false,
            createdAt: block.timestamp
        });

        emit BTCPaymentCreated(_consultationId, btcAmount, _btcAddress);
        return btcAmount;
    }

    /**
     * @dev Confirm BTC payment with transaction hash
     */
    function confirmBTCPayment(
        uint256 _consultationId,
        string memory _txHash
    ) external onlyRole(ORACLE_ROLE) {
        require(!usedTxHashes[_txHash], "Transaction already used");
        
        BTCPayment storage payment = btcPayments[_consultationId];
        require(!payment.isPaid, "Already confirmed");
        
        payment.txHash = _txHash;
        payment.isPaid = true;
        usedTxHashes[_txHash] = true;
        
        emit BTCPaymentConfirmed(_consultationId, _txHash);
    }

    /**
     * @dev Generate Lightning Network invoice for instant payments
     */
    function requestLightningPayment(
        uint256 _consultationId,
        string memory _invoice
    ) external onlyRole(ORACLE_ROLE) {
        emit LightningPaymentRequest(_consultationId, _invoice);
    }

    function isPriceValid() public view returns (bool) {
        return block.timestamp <= latestPrice.timestamp + PRICE_VALIDITY_PERIOD;
    }

    function getBTCPayment(uint256 _consultationId) external view returns (BTCPayment memory) {
        return btcPayments[_consultationId];
    }

    function getCurrentPrice() external view returns (uint256 price, uint256 timestamp, bool isValid) {
        return (latestPrice.price, latestPrice.timestamp, isPriceValid());
    }
}