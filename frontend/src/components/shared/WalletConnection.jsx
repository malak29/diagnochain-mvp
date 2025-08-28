import React, { useState, useEffect } from 'react';
import { Wallet, Bitcoin, Shield, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';

const WalletConnection = ({ onConnect }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [btcAddress, setBtcAddress] = useState('');
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState('0');
  const [connectedAccount, setConnectedAccount] = useState(null);

  const supportedNetworks = {
    5: { name: 'Goerli Testnet', currency: 'ETH', explorer: 'https://goerli.etherscan.io' },
    11155111: { name: 'Sepolia Testnet', currency: 'ETH', explorer: 'https://sepolia.etherscan.io' },
    1337: { name: 'Local Network', currency: 'ETH', explorer: 'http://localhost:8545' }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      
      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, []);

  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      setWalletError('Please connect to MetaMask');
      setConnectedAccount(null);
    } else {
      setWalletError('');
      setConnectedAccount(accounts[0]);
    }
  };

  const handleChainChanged = (chainId) => {
    const networkId = parseInt(chainId, 16);
    setChainId(networkId);
    
    if (!supportedNetworks[networkId]) {
      setWalletError('Please switch to a supported test network');
    } else {
      setWalletError('');
    }
  };

  const connectMetaMask = async () => {
    if (typeof window.ethereum === 'undefined') {
      setWalletError('MetaMask not detected. Please install MetaMask.');
      return;
    }

    setIsConnecting(true);
    setWalletError('');

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      const networkId = parseInt(chainId, 16);
      setChainId(networkId);

      if (!supportedNetworks[networkId]) {
        setWalletError('Please switch to a supported test network (Goerli, Sepolia, or Local)');
        setIsConnecting(false);
        return;
      }

      const balance = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [accounts[0], 'latest'],
      });
      
      const balanceInEth = (parseInt(balance, 16) / Math.pow(10, 18)).toFixed(4);
      setBalance(balanceInEth);
      setConnectedAccount(accounts[0]);

      await checkExistingRole(accounts[0]);
      
    } catch (error) {
      console.error('Error connecting to MetaMask:', error);
      if (error.code === 4001) {
        setWalletError('Connection rejected by user');
      } else {
        setWalletError(error.message || 'Failed to connect wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const checkExistingRole = async (account) => {
    try {
      const response = await fetch(`/api/user/role/${account}`);
      if (response.ok) {
        const data = await response.json();
        if (data.role) {
          onConnect(account, data.role);
        } else {
          setShowRoleModal(true);
        }
      } else {
        setShowRoleModal(true);
      }
    } catch (error) {
      console.log('No existing role found, showing role selection');
      setShowRoleModal(true);
    }
  };

  const selectUserRole = async (role) => {
    try {
      if (!connectedAccount) {
        setWalletError('Wallet not connected');
        return;
      }

      const userData = {
        address: connectedAccount, 
        role,
        btcAddress: btcAddress || generateMockBTCAddress(),
        chainId: chainId
      };

      const response = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        onConnect(connectedAccount, role);
        setShowRoleModal(false);
      } else {
        throw new Error('Registration failed');
      }
      
    } catch (error) {
      console.error('Error registering user role:', error);
      
      onConnect(connectedAccount, role);
      setShowRoleModal(false);
    }
  };

  const generateMockBTCAddress = () => {
    return 'tb1q' + Math.random().toString(36).substring(2, 30);
  };

  const switchNetwork = async (targetChainId) => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch (error) {
      console.error('Error switching network:', error);
      setWalletError('Failed to switch network. Please switch manually in MetaMask.');
    }
  };

  const addNetwork = async (networkId) => {
    const networkParams = {
      5: {
        chainId: '0x5',
        chainName: 'Goerli Testnet',
        rpcUrls: ['https://goerli.infura.io/v3/YOUR_API_KEY'],
        nativeCurrency: { name: 'Goerli ETH', symbol: 'ETH', decimals: 18 }
      },
      11155111: {
        chainId: '0xaa36a7',
        chainName: 'Sepolia Testnet', 
        rpcUrls: ['https://sepolia.infura.io/v3/YOUR_API_KEY'],
        nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }
      }
    };

    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [networkParams[networkId]],
      });
    } catch (error) {
      console.error('Error adding network:', error);
    }
  };

  if (showRoleModal) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Welcome to DiagnoChain!</h3>
          <p className="text-gray-600 mb-6">Please select your role to continue:</p>
          
          <div className="space-y-4 mb-6">
            <button
              onClick={() => selectUserRole('patient')}
              className="w-full p-4 border border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="flex items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                  <span className="text-2xl">👤</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Patient</p>
                  <p className="text-sm text-gray-600">Book consultations with verified doctors</p>
                  <p className="text-xs text-gray-500">Get diagnoses as permanent NFTs</p>
                </div>
              </div>
            </button>
            
            <button
              onClick={() => selectUserRole('doctor')}
              className="w-full p-4 border border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-left"
            >
              <div className="flex items-center">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                  <span className="text-2xl">👨‍⚕️</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Doctor</p>
                  <p className="text-sm text-gray-600">Provide consultations & earn Bitcoin</p>
                  <p className="text-xs text-gray-500">Requires verification & staking</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => selectUserRole('verifier')}
              className="w-full p-4 border border-gray-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-colors text-left"
            >
              <div className="flex items-center">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
                  <Shield className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Verifier</p>
                  <p className="text-sm text-gray-600">Verify doctor credentials</p>
                  <p className="text-xs text-gray-500">Earn fees for accurate verification</p>
                </div>
              </div>
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bitcoin Address (Optional)
            </label>
            <input
              type="text"
              value={btcAddress}
              onChange={(e) => setBtcAddress(e.target.value)}
              placeholder="tb1q... (testnet address for rewards)"
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to auto-generate. Used for receiving Bitcoin rewards.
            </p>
          </div>

          <button
            onClick={() => setShowRoleModal(false)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!window.ethereum && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
            <div>
              <p className="text-sm font-medium text-yellow-800">MetaMask Required</p>
              <p className="text-sm text-yellow-700">
                Please install MetaMask to use DiagnoChain.{' '}
                <a 
                  href="https://metamask.io/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-yellow-900 inline-flex items-center"
                >
                  Download here <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {chainId && !supportedNetworks[chainId] && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
              <div>
                <p className="text-sm font-medium text-red-800">Unsupported Network</p>
                <p className="text-sm text-red-700">Switch to a test network to continue</p>
              </div>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => switchNetwork(11155111)}
                className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-md hover:bg-red-200 transition-colors"
              >
                Sepolia
              </button>
              <button
                onClick={() => switchNetwork(5)}
                className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-md hover:bg-red-200 transition-colors"
              >
                Goerli
              </button>
            </div>
          </div>
        </div>
      )}

      {walletError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-sm text-red-700">{walletError}</p>
          </div>
        </div>
      )}

      <button
        onClick={connectMetaMask}
        disabled={isConnecting || !window.ethereum}
        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
            Connecting...
          </>
        ) : (
          <>
            <Wallet className="h-5 w-5 mr-2" />
            Connect MetaMask
          </>
        )}
      </button>

      {chainId && supportedNetworks[chainId] && connectedAccount && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            <div className="flex-1">
              <p className="font-medium text-green-800">
                Connected to {supportedNetworks[chainId].name}
              </p>
              <p className="text-sm text-green-700">
                {connectedAccount.slice(0, 6)}...{connectedAccount.slice(-4)}
              </p>
            </div>
          </div>
          <div className="flex justify-between text-sm text-green-700">
            <span>Balance: {balance} {supportedNetworks[chainId].currency}</span>
            <a 
              href={`${supportedNetworks[chainId].explorer}/address/${connectedAccount}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center hover:text-green-900"
            >
              View on Explorer <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </div>
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-3 flex items-center">
          <Shield className="h-4 w-4 mr-2" />
          Security Features
        </h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Smart contract escrow protects your payments</li>
          <li>• All doctors are blockchain-verified with staked tokens</li>
          <li>• Medical records encrypted and stored on IPFS</li>
          <li>• Bitcoin rewards distributed via Lightning Network</li>
          <li>• Non-custodial - you always control your keys</li>
        </ul>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <div className="flex items-center mb-2">
          <Bitcoin className="h-4 w-4 text-orange-600 mr-2" />
          <h4 className="font-medium text-gray-900">Bitcoin Integration</h4>
        </div>
        <div className="text-sm text-gray-600 space-y-1">
          <p>• Consultations paid in ETH, doctors receive BTC rewards</p>
          <p>• High-rated doctors earn daily Bitcoin bonuses</p>
          <p>• Lightning Network enables instant micropayments</p>
          <p>• Testnet BTC used for development (no real value)</p>
        </div>
      </div>

      {!window.ethereum && (
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-2">
            New to Web3? MetaMask is a secure wallet for Ethereum.
          </p>
          <div className="flex justify-center space-x-4 text-xs">
            <a 
              href="https://metamask.io/download/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 inline-flex items-center"
            >
              Install MetaMask <ExternalLink className="h-3 w-3 ml-1" />
            </a>
            <a 
              href="https://ethereum.org/en/wallets/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 inline-flex items-center"
            >
              Learn about wallets <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletConnection;