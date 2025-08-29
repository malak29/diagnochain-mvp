import Web3 from 'web3';
import { toast } from 'react-toastify';

const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum Mainnet', symbol: 'ETH', rpcUrl: 'https://mainnet.infura.io/v3/' },
  5: { name: 'Goerli Testnet', symbol: 'ETH', rpcUrl: 'https://goerli.infura.io/v3/' },
  11155111: { name: 'Sepolia Testnet', symbol: 'ETH', rpcUrl: 'https://sepolia.infura.io/v3/' },
  137: { name: 'Polygon Mainnet', symbol: 'MATIC', rpcUrl: 'https://polygon-rpc.com/' },
  80001: { name: 'Mumbai Testnet', symbol: 'MATIC', rpcUrl: 'https://rpc-mumbai.maticvigil.com/' },
  1337: { name: 'Local Network', symbol: 'ETH', rpcUrl: 'http://localhost:8545' }
};

const CONTRACT_ADDRESSES = {
  1: {
    PatientRegistry: '0x...',
    MedicalRecords: '0x...',
    AccessControl: '0x...',
    PaymentEscrow: '0x...'
  },
  5: {
    PatientRegistry: process.env.REACT_APP_PATIENT_REGISTRY_GOERLI,
    MedicalRecords: process.env.REACT_APP_MEDICAL_RECORDS_GOERLI,
    AccessControl: process.env.REACT_APP_ACCESS_CONTROL_GOERLI,
    PaymentEscrow: process.env.REACT_APP_PAYMENT_ESCROW_GOERLI
  },
  1337: {
    PatientRegistry: process.env.REACT_APP_PATIENT_REGISTRY_LOCAL,
    MedicalRecords: process.env.REACT_APP_MEDICAL_RECORDS_LOCAL,
    AccessControl: process.env.REACT_APP_ACCESS_CONTROL_LOCAL,
    PaymentEscrow: process.env.REACT_APP_PAYMENT_ESCROW_LOCAL
  }
};

let web3Instance = null;
let contractInstances = {};

export const getWeb3 = () => {
  if (!web3Instance) {
    if (window.ethereum) {
      web3Instance = new Web3(window.ethereum);
    } else if (window.web3) {
      web3Instance = new Web3(window.web3.currentProvider);
    } else {
      const fallbackRpc = process.env.REACT_APP_FALLBACK_RPC_URL || 'http://localhost:8545';
      web3Instance = new Web3(new Web3.providers.HttpProvider(fallbackRpc));
      console.warn('No web3 provider detected, using fallback RPC');
    }
  }
  return web3Instance;
};

export const isMetaMaskInstalled = () => {
  return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
};

export const requestAccount = async () => {
  try {
    if (!window.ethereum) {
      throw new Error('MetaMask not detected');
    }

    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (accounts.length === 0) {
      throw new Error('No accounts found');
    }

    return accounts[0];
  } catch (error) {
    console.error('Account request failed:', error);
    
    if (error.code === 4001) {
      toast.error('Please connect your wallet to continue');
    } else if (error.code === -32002) {
      toast.warning('Wallet connection request is already pending');
    } else {
      toast.error(error.message || 'Failed to connect wallet');
    }
    
    throw error;
  }
};

export const getAccounts = async () => {
  try {
    const web3 = getWeb3();
    const accounts = await web3.eth.getAccounts();
    return accounts;
  } catch (error) {
    console.error('Failed to get accounts:', error);
    return [];
  }
};

export const getCurrentAccount = async () => {
  try {
    const accounts = await getAccounts();
    return accounts[0] || null;
  } catch (error) {
    console.error('Failed to get current account:', error);
    return null;
  }
};

export const getNetworkId = async () => {
  try {
    const web3 = getWeb3();
    return await web3.eth.getChainId();
  } catch (error) {
    console.error('Failed to get network ID:', error);
    return null;
  }
};

export const getNetworkInfo = async () => {
  try {
    const chainId = await getNetworkId();
    return SUPPORTED_CHAINS[chainId] || { name: 'Unknown Network', symbol: 'ETH' };
  } catch (error) {
    console.error('Failed to get network info:', error);
    return { name: 'Unknown Network', symbol: 'ETH' };
  }
};

export const isCorrectNetwork = async () => {
  try {
    const chainId = await getNetworkId();
    const targetChainId = parseInt(process.env.REACT_APP_CHAIN_ID || '1337');
    return chainId === targetChainId;
  } catch (error) {
    console.error('Failed to check network:', error);
    return false;
  }
};

export const switchNetwork = async (chainId) => {
  try {
    if (!window.ethereum) {
      throw new Error('MetaMask not detected');
    }

    const hexChainId = `0x${chainId.toString(16)}`;
    
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });

    return true;
  } catch (error) {
    if (error.code === 4902) {
      try {
        const networkConfig = SUPPORTED_CHAINS[chainId];
        if (networkConfig) {
          await addNetwork(chainId, networkConfig);
          return true;
        }
      } catch (addError) {
        console.error('Failed to add network:', addError);
        toast.error('Failed to add network to wallet');
      }
    } else {
      console.error('Failed to switch network:', error);
      toast.error('Failed to switch network');
    }
    return false;
  }
};

export const addNetwork = async (chainId, networkConfig) => {
  try {
    if (!window.ethereum) {
      throw new Error('MetaMask not detected');
    }

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: `0x${chainId.toString(16)}`,
        chainName: networkConfig.name,
        nativeCurrency: {
          name: networkConfig.symbol,
          symbol: networkConfig.symbol,
          decimals: 18
        },
        rpcUrls: [networkConfig.rpcUrl],
        blockExplorerUrls: networkConfig.blockExplorerUrl ? [networkConfig.blockExplorerUrl] : null
      }],
    });

    return true;
  } catch (error) {
    console.error('Failed to add network:', error);
    throw error;
  }
};

export const getContract = async (contractName, chainId = null) => {
  try {
    if (!chainId) {
      chainId = await getNetworkId();
    }

    const contractKey = `${contractName}_${chainId}`;
    
    if (contractInstances[contractKey]) {
      return contractInstances[contractKey];
    }

    const web3 = getWeb3();
    const contractAddress = CONTRACT_ADDRESSES[chainId]?.[contractName];
    
    if (!contractAddress) {
      throw new Error(`Contract ${contractName} not deployed on chain ${chainId}`);
    }

    const contractABI = await import(`../contracts/abis/${contractName}.json`);
    const contract = new web3.eth.Contract(contractABI.default, contractAddress);
    
    contractInstances[contractKey] = contract;
    return contract;
  } catch (error) {
    console.error(`Failed to get contract ${contractName}:`, error);
    throw error;
  }
};

export const getBalance = async (address) => {
  try {
    const web3 = getWeb3();
    const balance = await web3.eth.getBalance(address);
    return web3.utils.fromWei(balance, 'ether');
  } catch (error) {
    console.error('Failed to get balance:', error);
    return '0';
  }
};

export const getGasPrice = async () => {
  try {
    const web3 = getWeb3();
    const gasPrice = await web3.eth.getGasPrice();
    return gasPrice;
  } catch (error) {
    console.error('Failed to get gas price:', error);
    return web3.utils.toWei('20', 'gwei');
  }
};

export const estimateGas = async (transaction) => {
  try {
    const web3 = getWeb3();
    const gasEstimate = await web3.eth.estimateGas(transaction);
    return Math.ceil(gasEstimate * 1.1);
  } catch (error) {
    console.error('Failed to estimate gas:', error);
    return 100000;
  }
};

export const sendTransaction = async (transaction, account) => {
  try {
    const web3 = getWeb3();
    
    const gasPrice = await getGasPrice();
    const gasLimit = await estimateGas(transaction);
    
    const txParams = {
      ...transaction,
      from: account,
      gasPrice: gasPrice,
      gas: gasLimit
    };

    const result = await web3.eth.sendTransaction(txParams);
    
    toast.success('Transaction submitted successfully');
    return result;
  } catch (error) {
    console.error('Transaction failed:', error);
    
    if (error.code === 4001) {
      toast.error('Transaction cancelled by user');
    } else if (error.message.includes('insufficient funds')) {
      toast.error('Insufficient funds for transaction');
    } else {
      toast.error(error.message || 'Transaction failed');
    }
    
    throw error;
  }
};

export const waitForTransaction = async (txHash) => {
  try {
    const web3 = getWeb3();
    let receipt = null;
    let attempts = 0;
    const maxAttempts = 60;

    while (!receipt && attempts < maxAttempts) {
      try {
        receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt) break;
      } catch (error) {
        console.warn(`Attempt ${attempts + 1} failed:`, error.message);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!receipt) {
      throw new Error('Transaction confirmation timeout');
    }

    if (!receipt.status) {
      throw new Error('Transaction failed');
    }

    return receipt;
  } catch (error) {
    console.error('Failed to wait for transaction:', error);
    throw error;
  }
};

export const signMessage = async (message, account) => {
  try {
    const web3 = getWeb3();
    
    const signature = await web3.eth.personal.sign(message, account, '');
    return signature;
  } catch (error) {
    console.error('Failed to sign message:', error);
    
    if (error.code === 4001) {
      toast.error('Message signing cancelled by user');
    } else {
      toast.error(error.message || 'Failed to sign message');
    }
    
    throw error;
  }
};

export const verifySignature = (message, signature, address) => {
  try {
    const web3 = getWeb3();
    const recoveredAddress = web3.eth.accounts.recover(message, signature);
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (error) {
    console.error('Failed to verify signature:', error);
    return false;
  }
};

export const createSigningMessage = (walletAddress, timestamp = Date.now()) => {
  const nonce = Math.floor(Math.random() * 1000000);
  
  return `DiagnoChain Authentication

Wallet Address: ${walletAddress}
Timestamp: ${timestamp}
Nonce: ${nonce}

By signing this message, you authenticate with DiagnoChain and agree to our Terms of Service.

This request will not trigger a blockchain transaction or cost any gas fees.`;
};

export const formatAddress = (address, chars = 4) => {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
};

export const formatWei = (wei, unit = 'ether', decimals = 4) => {
  try {
    const web3 = getWeb3();
    const value = web3.utils.fromWei(wei.toString(), unit);
    return parseFloat(value).toFixed(decimals);
  } catch (error) {
    console.error('Failed to format wei:', error);
    return '0';
  }
};

export const toWei = (value, unit = 'ether') => {
  try {
    const web3 = getWeb3();
    return web3.utils.toWei(value.toString(), unit);
  } catch (error) {
    console.error('Failed to convert to wei:', error);
    return '0';
  }
};

export const isValidAddress = (address) => {
  try {
    const web3 = getWeb3();
    return web3.utils.isAddress(address);
  } catch (error) {
    console.error('Failed to validate address:', error);
    return false;
  }
};

export const getTransactionStatus = async (txHash) => {
  try {
    const web3 = getWeb3();
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return 'pending';
    }
    
    return receipt.status ? 'success' : 'failed';
  } catch (error) {
    console.error('Failed to get transaction status:', error);
    return 'unknown';
  }
};

export const getBlockNumber = async () => {
  try {
    const web3 = getWeb3();
    return await web3.eth.getBlockNumber();
  } catch (error) {
    console.error('Failed to get block number:', error);
    return null;
  }
};

export const listenToContractEvents = (contract, eventName, filter = {}, callback) => {
  try {
    const event = contract.events[eventName](filter);
    
    event.on('data', callback);
    event.on('error', (error) => {
      console.error(`Error listening to ${eventName}:`, error);
    });
    
    return event;
  } catch (error) {
    console.error(`Failed to listen to contract events:`, error);
    return null;
  }
};

export const stopListening = (eventSubscription) => {
  try {
    if (eventSubscription && typeof eventSubscription.unsubscribe === 'function') {
      eventSubscription.unsubscribe();
    }
  } catch (error) {
    console.error('Failed to stop listening:', error);
  }
};

export const calculateTransactionFee = async (transaction) => {
  try {
    const gasPrice = await getGasPrice();
    const gasLimit = await estimateGas(transaction);
    
    const web3 = getWeb3();
    const feeInWei = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    const feeInEth = web3.utils.fromWei(feeInWei, 'ether');
    
    return {
      gasPrice: formatWei(gasPrice, 'gwei'),
      gasLimit,
      feeInWei: feeInWei.toString(),
      feeInEth: parseFloat(feeInEth).toFixed(6)
    };
  } catch (error) {
    console.error('Failed to calculate transaction fee:', error);
    return {
      gasPrice: '0',
      gasLimit: 0,
      feeInWei: '0',
      feeInEth: '0'
    };
  }
};

export const addTokenToWallet = async (tokenAddress, tokenSymbol, tokenDecimals, tokenImage) => {
  try {
    if (!window.ethereum) {
      throw new Error('MetaMask not detected');
    }

    const wasAdded = await window.ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: tokenAddress,
          symbol: tokenSymbol,
          decimals: tokenDecimals,
          image: tokenImage,
        },
      },
    });

    if (wasAdded) {
      toast.success('Token added to wallet successfully');
    }
    
    return wasAdded;
  } catch (error) {
    console.error('Failed to add token to wallet:', error);
    toast.error('Failed to add token to wallet');
    return false;
  }
};

export const setupWeb3EventListeners = () => {
  if (!window.ethereum) return;

  window.ethereum.on('accountsChanged', (accounts) => {
    if (accounts.length === 0) {
      toast.warning('Wallet disconnected');
      window.location.reload();
    } else {
      toast.info('Account changed');
      window.location.reload();
    }
  });

  window.ethereum.on('chainChanged', (chainId) => {
    toast.info('Network changed');
    window.location.reload();
  });

  window.ethereum.on('connect', (connectInfo) => {
    console.log('Wallet connected:', connectInfo);
  });

  window.ethereum.on('disconnect', (error) => {
    console.log('Wallet disconnected:', error);
    toast.error('Wallet connection lost');
  });
};

export const cleanup = () => {
  if (window.ethereum) {
    window.ethereum.removeAllListeners('accountsChanged');
    window.ethereum.removeAllListeners('chainChanged');
    window.ethereum.removeAllListeners('connect');
    window.ethereum.removeAllListeners('disconnect');
  }
  
  contractInstances = {};
  web3Instance = null;
};

export const detectProvider = () => {
  if (window.ethereum) {
    return 'MetaMask';
  } else if (window.web3) {
    return 'Legacy Web3';
  } else {
    return null;
  }
};

export const getProviderInfo = async () => {
  try {
    if (!window.ethereum) return null;
    
    return {
      isMetaMask: window.ethereum.isMetaMask,
      chainId: await getNetworkId(),
      accounts: await getAccounts(),
      provider: detectProvider()
    };
  } catch (error) {
    console.error('Failed to get provider info:', error);
    return null;
  }
};

export default {
  getWeb3,
  isMetaMaskInstalled,
  requestAccount,
  getAccounts,
  getCurrentAccount,
  getNetworkId,
  getNetworkInfo,
  isCorrectNetwork,
  switchNetwork,
  addNetwork,
  getContract,
  getBalance,
  sendTransaction,
  waitForTransaction,
  signMessage,
  verifySignature,
  createSigningMessage,
  formatAddress,
  formatWei,
  toWei,
  isValidAddress,
  getTransactionStatus,
  setupWeb3EventListeners,
  cleanup
};