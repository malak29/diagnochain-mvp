import { useState, useEffect, useCallback, useContext, createContext } from 'react';
import { toast } from 'react-toastify';
import web3Utils from '../utils/web3Utils';
import { SUPPORTED_NETWORKS, DEFAULT_CHAIN_ID } from '../utils/constants';

const WalletContext = createContext();

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState('0');
  const [chainId, setChainId] = useState(null);
  const [networkInfo, setNetworkInfo] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const clearWalletData = useCallback(() => {
    setIsConnected(false);
    setAccount(null);
    setBalance('0');
    setChainId(null);
    setNetworkInfo(null);
    setError(null);
    setTransactions([]);
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAccount');
  }, []);

  const updateBalance = useCallback(async (address) => {
    try {
      if (address) {
        const newBalance = await web3Utils.getBalance(address);
        setBalance(newBalance);
      }
    } catch (error) {
      console.error('Failed to update balance:', error);
    }
  }, []);

  const updateNetworkInfo = useCallback(async () => {
    try {
      const currentChainId = await web3Utils.getNetworkId();
      const network = await web3Utils.getNetworkInfo();
      
      setChainId(currentChainId);
      setNetworkInfo(network);
      
      return { chainId: currentChainId, network };
    } catch (error) {
      console.error('Failed to update network info:', error);
      return null;
    }
  }, []);

  const setupEventListeners = useCallback(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        clearWalletData();
        toast.warning('Wallet disconnected');
      } else if (accounts[0] !== account) {
        setAccount(accounts[0]);
        updateBalance(accounts[0]);
        localStorage.setItem('walletAccount', accounts[0]);
        toast.info('Account changed');
      }
    };

    const handleChainChanged = async (newChainId) => {
      const chainIdNum = parseInt(newChainId, 16);
      setChainId(chainIdNum);
      
      try {
        const network = SUPPORTED_NETWORKS[chainIdNum];
        setNetworkInfo(network || { name: 'Unknown Network', symbol: 'ETH' });
        
        if (account) {
          await updateBalance(account);
        }
        
        toast.info(`Network changed to ${network?.name || 'Unknown Network'}`);
      } catch (error) {
        console.error('Error handling chain change:', error);
      }
    };

    const handleConnect = (connectInfo) => {
      console.log('Wallet connected:', connectInfo);
    };

    const handleDisconnect = (error) => {
      console.log('Wallet disconnected:', error);
      clearWalletData();
      toast.error('Wallet connection lost');
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('connect', handleConnect);
    window.ethereum.on('disconnect', handleDisconnect);

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('connect', handleConnect);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [account, clearWalletData, updateBalance]);

  const connect = useCallback(async () => {
    if (isConnecting) return;

    setIsConnecting(true);
    setError(null);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
      }

      const requestedAccount = await web3Utils.requestAccount();
      const networkData = await updateNetworkInfo();
      
      if (!networkData) {
        throw new Error('Failed to get network information');
      }

      setAccount(requestedAccount);
      setIsConnected(true);
      
      await updateBalance(requestedAccount);
      
      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAccount', requestedAccount);
      
      toast.success('Wallet connected successfully');
      
      return {
        account: requestedAccount,
        chainId: networkData.chainId,
        network: networkData.network
      };

    } catch (error) {
      console.error('Wallet connection failed:', error);
      setError(error.message);
      
      if (error.code === 4001) {
        toast.error('Connection rejected by user');
      } else if (error.code === -32002) {
        toast.warning('Connection request already pending');
      } else {
        toast.error(error.message || 'Failed to connect wallet');
      }
      
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, updateBalance, updateNetworkInfo]);

  const disconnect = useCallback(async () => {
    try {
      clearWalletData();
      toast.success('Wallet disconnected');
    } catch (error) {
      console.error('Disconnect error:', error);
      toast.error('Error disconnecting wallet');
    }
  }, [clearWalletData]);

  const switchNetwork = useCallback(async (targetChainId) => {
    try {
      setIsConnecting(true);
      
      const success = await web3Utils.switchNetwork(targetChainId);
      
      if (success) {
        await updateNetworkInfo();
        if (account) {
          await updateBalance(account);
        }
        toast.success('Network switched successfully');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Network switch failed:', error);
      toast.error('Failed to switch network');
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [account, updateBalance, updateNetworkInfo]);

  const signMessage = useCallback(async (message) => {
    try {
      if (!account) {
        throw new Error('No account connected');
      }

      const signature = await web3Utils.signMessage(message, account);
      
      toast.success('Message signed successfully');
      return signature;
    } catch (error) {
      console.error('Message signing failed:', error);
      
      if (error.code === 4001) {
        toast.error('Signing rejected by user');
      } else {
        toast.error(error.message || 'Failed to sign message');
      }
      
      throw error;
    }
  }, [account]);

  const sendTransaction = useCallback(async (transactionData) => {
    try {
      if (!account) {
        throw new Error('No account connected');
      }

      setIsConnecting(true);
      
      const txHash = await web3Utils.sendTransaction(transactionData, account);
      
      const pendingTx = {
        hash: txHash,
        status: 'pending',
        timestamp: Date.now(),
        from: account,
        to: transactionData.to,
        value: transactionData.value || '0'
      };
      
      setTransactions(prev => [pendingTx, ...prev]);
      
      toast.success('Transaction submitted successfully');
      
      web3Utils.waitForTransaction(txHash)
        .then((receipt) => {
          setTransactions(prev => 
            prev.map(tx => 
              tx.hash === txHash 
                ? { ...tx, status: 'confirmed', receipt }
                : tx
            )
          );
          toast.success('Transaction confirmed');
        })
        .catch((error) => {
          setTransactions(prev => 
            prev.map(tx => 
              tx.hash === txHash 
                ? { ...tx, status: 'failed', error: error.message }
                : tx
            )
          );
          toast.error('Transaction failed');
        });
      
      return txHash;
    } catch (error) {
      console.error('Transaction failed:', error);
      toast.error(error.message || 'Transaction failed');
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [account]);

  const addToken = useCallback(async (tokenAddress, tokenSymbol, tokenDecimals, tokenImage) => {
    try {
      const success = await web3Utils.addTokenToWallet(
        tokenAddress,
        tokenSymbol,
        tokenDecimals,
        tokenImage
      );
      
      if (success) {
        toast.success(`${tokenSymbol} token added to wallet`);
      }
      
      return success;
    } catch (error) {
      console.error('Add token failed:', error);
      toast.error('Failed to add token to wallet');
      throw error;
    }
  }, []);

  const getTransactionHistory = useCallback(async (limit = 10) => {
    try {
      if (!account) return [];
      
      // This would typically call a backend service or blockchain indexer
      const history = await web3Utils.getTransactionHistory(account, limit);
      return history;
    } catch (error) {
      console.error('Failed to get transaction history:', error);
      return [];
    }
  }, [account]);

  const estimateGas = useCallback(async (transactionData) => {
    try {
      return await web3Utils.estimateGas(transactionData);
    } catch (error) {
      console.error('Gas estimation failed:', error);
      throw error;
    }
  }, []);

  const getGasPrice = useCallback(async () => {
    try {
      return await web3Utils.getGasPrice();
    } catch (error) {
      console.error('Failed to get gas price:', error);
      throw error;
    }
  }, []);

  const isCorrectNetwork = useCallback(() => {
    return chainId === DEFAULT_CHAIN_ID;
  }, [chainId]);

  const formatAddress = useCallback((address, chars = 4) => {
    return web3Utils.formatAddress(address, chars);
  }, []);

  const formatBalance = useCallback((balance, decimals = 4) => {
    if (!balance || balance === '0') return '0.0000';
    return parseFloat(balance).toFixed(decimals);
  }, []);

  const checkWalletInstalled = useCallback(() => {
    return web3Utils.isMetaMaskInstalled();
  }, []);

  const autoConnect = useCallback(async () => {
    if (isInitialized) return;

    try {
      const wasConnected = localStorage.getItem('walletConnected') === 'true';
      const savedAccount = localStorage.getItem('walletAccount');

      if (wasConnected && savedAccount && window.ethereum) {
        const accounts = await web3Utils.getAccounts();
        
        if (accounts.length > 0 && accounts.includes(savedAccount)) {
          setAccount(savedAccount);
          setIsConnected(true);
          
          await Promise.all([
            updateBalance(savedAccount),
            updateNetworkInfo()
          ]);
        } else {
          clearWalletData();
        }
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
      clearWalletData();
    } finally {
      setIsInitialized(true);
    }
  }, [isInitialized, clearWalletData, updateBalance, updateNetworkInfo]);

  useEffect(() => {
    autoConnect();
  }, [autoConnect]);

  useEffect(() => {
    if (isInitialized) {
      const cleanup = setupEventListeners();
      return cleanup;
    }
  }, [isInitialized, setupEventListeners]);

  useEffect(() => {
    if (account && isConnected) {
      const interval = setInterval(() => {
        updateBalance(account);
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [account, isConnected, updateBalance]);

  const value = {
    // State
    isConnected,
    account,
    balance,
    chainId,
    networkInfo,
    isConnecting,
    error,
    transactions,
    isInitialized,

    // Actions
    connect,
    disconnect,
    switchNetwork,
    signMessage,
    sendTransaction,
    addToken,
    getTransactionHistory,
    estimateGas,
    getGasPrice,
    updateBalance: () => updateBalance(account),

    // Utilities
    isCorrectNetwork,
    formatAddress,
    formatBalance,
    checkWalletInstalled,

    // Computed values
    formattedBalance: formatBalance(balance),
    formattedAccount: formatAddress(account),
    networkName: networkInfo?.name || 'Unknown',
    isMainnet: chainId === 1,
    isTestnet: chainId !== 1 && SUPPORTED_NETWORKS[chainId]?.isTestnet
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};