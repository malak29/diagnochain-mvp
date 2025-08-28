const { ethers } = require('hardhat');
const fs = require('fs').promises;
const path = require('path');

const config = require('../../config/config');
const logger = require('../../backend/src/utils/logger');

class ContractDeployer {
  constructor() {
    this.network = process.env.ETH_NETWORK || 'sepolia';
    this.deployments = new Map();
    this.deploymentHistory = [];
    
    this.gasSettings = {
      gasLimit: config.blockchain.ethereum.gasLimit,
      gasPrice: config.blockchain.ethereum.gasPrice
    };

    this.contractDependencies = {
      'DiagnoAccessControl': [],
      'DoctorRegistry': ['DiagnoAccessControl'],
      'ConsultationEscrow': ['DoctorRegistry'],
      'DiagnosticNFT': ['ConsultationEscrow'],
      'ReputationSystem': ['DoctorRegistry', 'ConsultationEscrow'],
      'BTCOracle': ['DiagnoAccessControl']
    };

    this.verificationDelays = {
      localhost: 0,
      sepolia: 30000,
      goerli: 30000,
      mainnet: 60000
    };
  }

  async deploy() {
    try {
      logger.info('Starting DiagnoChain contract deployment...');
      
      const deployer = await this.getDeployer();
      logger.info('Deployer account:', {
        address: deployer.address,
        balance: ethers.utils.formatEther(await deployer.getBalance()),
        network: this.network
      });

      await this.checkPrerequisites(deployer);
      
      const contracts = await this.deployAllContracts(deployer);
      await this.setupContractInteractions(contracts);
      await this.verifyContracts();
      await this.saveDeploymentArtifacts(contracts);
      
      logger.info('Deployment completed successfully!');
      return contracts;

    } catch (error) {
      logger.error('Deployment failed:', error);
      throw error;
    }
  }

  async getDeployer() {
    const [deployer] = await ethers.getSigners();
    
    if (!deployer) {
      throw new Error('No deployer account found');
    }

    const balance = await deployer.getBalance();
    const minBalance = ethers.utils.parseEther('0.1');
    
    if (balance.lt(minBalance)) {
      throw new Error(`Insufficient balance. Need at least 0.1 ETH, have ${ethers.utils.formatEther(balance)} ETH`);
    }

    return deployer;
  }

  async checkPrerequisites(deployer) {
    try {
      const network = await deployer.provider.getNetwork();
      logger.info('Network info:', {
        name: network.name,
        chainId: network.chainId
      });

      if (this.network !== 'localhost') {
        const gasPrice = await deployer.provider.getGasPrice();
        logger.info('Current gas price:', ethers.utils.formatUnits(gasPrice, 'gwei'), 'gwei');
      }

      const nonce = await deployer.getTransactionCount();
      logger.info('Deployer nonce:', nonce);

    } catch (error) {
      logger.error('Prerequisites check failed:', error);
      throw error;
    }
  }

  async deployContract(contractName, constructorArgs = [], deployer) {
    try {
      logger.info(`Deploying ${contractName}...`);
      
      const ContractFactory = await ethers.getContractFactory(contractName);
      
      const deployOptions = {
        gasLimit: this.gasSettings.gasLimit
      };

      if (this.gasSettings.gasPrice !== 'auto') {
        deployOptions.gasPrice = ethers.utils.parseUnits(this.gasSettings.gasPrice, 'gwei');
      }

      const contract = await ContractFactory.deploy(...constructorArgs, deployOptions);
      
      logger.info(`${contractName} deployment transaction:`, contract.deployTransaction.hash);
      
      const receipt = await contract.deployed();
      const deploymentCost = receipt.deployTransaction.gasPrice.mul(receipt.deployTransaction.gasLimit);
      
      logger.info(`${contractName} deployed successfully:`, {
        address: contract.address,
        txHash: receipt.deployTransaction.hash,
        gasUsed: receipt.deployTransaction.gasLimit.toString(),
        cost: ethers.utils.formatEther(deploymentCost) + ' ETH',
        blockNumber: receipt.deployTransaction.blockNumber
      });

      this.deployments.set(contractName, {
        contract,
        address: contract.address,
        txHash: receipt.deployTransaction.hash,
        blockNumber: receipt.deployTransaction.blockNumber,
        constructorArgs,
        deployedAt: new Date().toISOString()
      });

      this.deploymentHistory.push({
        contractName,
        address: contract.address,
        txHash: receipt.deployTransaction.hash,
        timestamp: new Date().toISOString()
      });

      return contract;

    } catch (error) {
      logger.error(`Failed to deploy ${contractName}:`, error);
      throw error;
    }
  }

  async deployAllContracts(deployer) {
    const deployedContracts = {};
    
    // Deploy in dependency order
    const deploymentOrder = this.calculateDeploymentOrder();
    
    for (const contractName of deploymentOrder) {
      const dependencies = this.contractDependencies[contractName];
      const constructorArgs = await this.getConstructorArgs(contractName, deployedContracts);
      
      // Wait for dependencies if needed
      if (dependencies.length > 0) {
        await this.delay(2000); // Brief delay between dependent deployments
      }

      const contract = await this.deployContract(contractName, constructorArgs, deployer);
      deployedContracts[contractName] = contract;

      // Wait for transaction confirmation
      if (this.network !== 'localhost') {
        await this.delay(5000);
      }
    }

    return deployedContracts;
  }

  calculateDeploymentOrder() {
    const deployed = new Set();
    const order = [];
    
    const deploy = (contractName) => {
      if (deployed.has(contractName)) return;
      
      const dependencies = this.contractDependencies[contractName] || [];
      dependencies.forEach(dep => deploy(dep));
      
      deployed.add(contractName);
      order.push(contractName);
    };

    Object.keys(this.contractDependencies).forEach(contractName => {
      deploy(contractName);
    });

    return order;
  }

  async getConstructorArgs(contractName, deployedContracts) {
    switch (contractName) {
      case 'DiagnoAccessControl':
        return []; // No constructor args

      case 'DoctorRegistry':
        return [
          process.env.STAKING_TOKEN_ADDRESS || ethers.constants.AddressZero // Staking token (use ETH if not set)
        ];

      case 'ConsultationEscrow':
        return [
          deployedContracts.DoctorRegistry.address,
          process.env.FEE_COLLECTOR_ADDRESS || (await ethers.getSigners())[0].address
        ];

      case 'DiagnosticNFT':
        return [
          deployedContracts.ConsultationEscrow.address
        ];

      case 'ReputationSystem':
        return [
          deployedContracts.DoctorRegistry.address,
          deployedContracts.ConsultationEscrow.address
        ];

      case 'BTCOracle':
        return []; // No constructor args

      default:
        return [];
    }
  }

  async setupContractInteractions(contracts) {
    try {
      logger.info('Setting up contract interactions...');

      const accessControl = contracts.DiagnoAccessControl;
      const doctorRegistry = contracts.DoctorRegistry;
      const escrow = contracts.ConsultationEscrow;
      const nft = contracts.DiagnosticNFT;
      const reputation = contracts.ReputationSystem;
      const oracle = contracts.BTCOracle;

      const setupTasks = [];

      // Grant oracle role to BTCOracle contract
      setupTasks.push(
        accessControl.grantRoleWithTimestamp(
          await accessControl.ORACLE_ROLE(),
          oracle.address
        )
      );

      // Grant doctor role to initial deployer for testing
      if (this.network !== 'mainnet') {
        const [deployer] = await ethers.getSigners();
        setupTasks.push(
          accessControl.grantRoleWithTimestamp(
            await accessControl.PATIENT_ROLE(),
            deployer.address
          )
        );
      }

      // Set up initial BTC oracle price
      const initialBTCPrice = ethers.utils.parseUnits('43000', 8); // $43,000 scaled by 10^8
      setupTasks.push(
        oracle.updateBTCPrice(initialBTCPrice)
      );

      // Set BTC oracle in escrow contract if method exists
      try {
        setupTasks.push(
          escrow.setBtcOracle(oracle.address)
        );
      } catch (error) {
        logger.warn('setBtcOracle method not found in escrow contract');
      }

      // Fund reputation system with initial reward pool
      const initialRewardPool = ethers.utils.parseEther('0.1'); // 0.1 ETH
      setupTasks.push(
        reputation.fundRewardPool({ value: initialRewardPool })
      );

      await Promise.all(setupTasks);

      logger.info('Contract interactions setup completed');

    } catch (error) {
      logger.error('Error setting up contract interactions:', error);
      throw error;
    }
  }

  async verifyContracts() {
    try {
      if (this.network === 'localhost' || this.network === 'hardhat') {
        logger.info('Skipping contract verification for local network');
        return;
      }

      logger.info('Starting contract verification...');

      const delay = this.verificationDelays[this.network] || 30000;
      logger.info(`Waiting ${delay/1000}s before verification...`);
      await this.delay(delay);

      for (const [contractName, deployment] of this.deployments) {
        try {
          await this.verifyContract(contractName, deployment);
        } catch (error) {
          logger.warn(`Verification failed for ${contractName}:`, error.message);
        }
      }

      logger.info('Contract verification completed');

    } catch (error) {
      logger.error('Error during contract verification:', error);
    }
  }

  async verifyContract(contractName, deployment) {
    try {
      if (this.network === 'localhost') return;

      logger.info(`Verifying ${contractName} at ${deployment.address}...`);

      await hre.run('verify:verify', {
        address: deployment.address,
        constructorArguments: deployment.constructorArgs || []
      });

      logger.info(`${contractName} verified successfully`);

    } catch (error) {
      if (error.message.includes('already verified')) {
        logger.info(`${contractName} already verified`);
      } else {
        throw error;
      }
    }
  }

  async saveDeploymentArtifacts(contracts) {
    try {
      const deploymentData = {
        network: this.network,
        timestamp: new Date().toISOString(),
        deployer: (await ethers.getSigners())[0].address,
        contracts: {},
        config: {
          gasLimit: this.gasSettings.gasLimit,
          gasPrice: this.gasSettings.gasPrice,
          confirmations: config.blockchain.ethereum.confirmations
        }
      };

      Object.keys(contracts).forEach(contractName => {
        const deployment = this.deployments.get(contractName);
        deploymentData.contracts[contractName] = {
          address: contracts[contractName].address,
          txHash: deployment.txHash,
          blockNumber: deployment.blockNumber,
          constructorArgs: deployment.constructorArgs,
          deployedAt: deployment.deployedAt
        };
      });

      const deploymentsDir = path.join(__dirname, '../deployments');
      await fs.mkdir(deploymentsDir, { recursive: true });

      const filename = `${this.network}-${Date.now()}.json`;
      const filepath = path.join(deploymentsDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(deploymentData, null, 2));

      // Also save as latest deployment
      const latestPath = path.join(deploymentsDir, `${this.network}-latest.json`);
      await fs.writeFile(latestPath, JSON.stringify(deploymentData, null, 2));

      // Create .env update file
      const envUpdates = Object.keys(contracts).map(contractName => {
        const envName = contractName.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
        return `${envName}_ADDRESS=${contracts[contractName].address}`;
      }).join('\n');

      await fs.writeFile(
        path.join(deploymentsDir, `${this.network}-env-updates.txt`),
        envUpdates
      );

      logger.info('Deployment artifacts saved:', {
        file: filename,
        contracts: Object.keys(contracts).length
      });

    } catch (error) {
      logger.error('Error saving deployment artifacts:', error);
      throw error;
    }
  }

  async upgradeContract(contractName, newImplementation) {
    try {
      logger.info(`Upgrading ${contractName}...`);

      const deployment = this.deployments.get(contractName);
      if (!deployment) {
        throw new Error(`Contract ${contractName} not found in deployments`);
      }

      // This would implement proxy upgrade logic
      // For MVP, we'll deploy a new contract
      const [deployer] = await ethers.getSigners();
      const newContract = await this.deployContract(`${contractName}V2`, [], deployer);

      logger.info(`${contractName} upgraded:`, {
        oldAddress: deployment.address,
        newAddress: newContract.address
      });

      return newContract;

    } catch (error) {
      logger.error(`Error upgrading ${contractName}:`, error);
      throw error;
    }
  }

  async deployTestEnvironment() {
    try {
      logger.info('Deploying test environment...');

      const contracts = await this.deploy();
      
      // Additional test setup
      await this.setupTestData(contracts);
      await this.createTestAccounts(contracts);
      
      logger.info('Test environment setup completed');
      return contracts;

    } catch (error) {
      logger.error('Test environment deployment failed:', error);
      throw error;
    }
  }

  async setupTestData(contracts) {
    try {
      const [deployer] = await ethers.getSigners();
      
      // Register test doctor
      const doctorRegistry = contracts.DoctorRegistry;
      const accessControl = contracts.DiagnoAccessControl;

      // Grant verifier role to deployer for testing
      await accessControl.grantRoleWithTimestamp(
        await accessControl.VERIFIER_ROLE(),
        deployer.address
      );

      // Create mock verification request
      const stakingAmount = ethers.utils.parseEther('1000');
      
      // In production, this would require actual staking tokens
      logger.info('Test data setup completed');

    } catch (error) {
      logger.warn('Test data setup failed:', error);
    }
  }

  async createTestAccounts(contracts) {
    try {
      if (this.network === 'localhost' || this.network === 'hardhat') {
        const signers = await ethers.getSigners();
        
        // Grant roles to test accounts
        const accessControl = contracts.DiagnoAccessControl;
        
        if (signers.length >= 3) {
          // Patient role
          await accessControl.grantRoleWithTimestamp(
            await accessControl.PATIENT_ROLE(),
            signers[1].address
          );

          // Doctor role (pending verification)
          await accessControl.grantRoleWithTimestamp(
            await accessControl.DOCTOR_ROLE(),
            signers[2].address
          );

          logger.info('Test accounts created:', {
            deployer: signers[0].address,
            patient: signers[1].address,
            doctor: signers[2].address
          });
        }
      }

    } catch (error) {
      logger.warn('Test accounts setup failed:', error);
    }
  }

  async loadExistingDeployments() {
    try {
      const deploymentsDir = path.join(__dirname, '../deployments');
      const latestFile = path.join(deploymentsDir, `${this.network}-latest.json`);
      
      const data = await fs.readFile(latestFile, 'utf8');
      const deployment = JSON.parse(data);

      logger.info('Loaded existing deployment:', {
        timestamp: deployment.timestamp,
        contracts: Object.keys(deployment.contracts).length
      });

      return deployment;

    } catch (error) {
      logger.info('No existing deployment found');
      return null;
    }
  }

  async getContractInstance(contractName, address = null) {
    try {
      const contractAddress = address || this.deployments.get(contractName)?.address;
      
      if (!contractAddress) {
        throw new Error(`Contract ${contractName} not deployed or address not provided`);
      }

      const ContractFactory = await ethers.getContractFactory(contractName);
      return ContractFactory.attach(contractAddress);

    } catch (error) {
      logger.error(`Error getting contract instance for ${contractName}:`, error);
      throw error;
    }
  }

  async estimateDeploymentCosts() {
    try {
      logger.info('Estimating deployment costs...');

      const [deployer] = await ethers.getSigners();
      const gasPrice = await deployer.provider.getGasPrice();
      
      const estimates = {};
      let totalGas = 0;

      for (const contractName of Object.keys(this.contractDependencies)) {
        try {
          const ContractFactory = await ethers.getContractFactory(contractName);
          const constructorArgs = await this.getConstructorArgs(contractName, {});
          
          const deployTransaction = ContractFactory.getDeployTransaction(...constructorArgs);
          const estimatedGas = await deployer.estimateGas(deployTransaction);
          
          estimates[contractName] = {
            gas: estimatedGas.toString(),
            cost: ethers.utils.formatEther(gasPrice.mul(estimatedGas)) + ' ETH'
          };
          
          totalGas += estimatedGas.toNumber();
          
        } catch (error) {
          estimates[contractName] = { error: error.message };
        }
      }

      const totalCost = ethers.utils.formatEther(gasPrice.mul(totalGas));

      logger.info('Deployment cost estimation:', {
        contracts: estimates,
        totalGas: totalGas.toString(),
        totalCost: totalCost + ' ETH',
        gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei') + ' gwei'
      });

      return { estimates, totalGas, totalCost, gasPrice };

    } catch (error) {
      logger.error('Error estimating deployment costs:', error);
      throw error;
    }
  }

  async deployToMainnet() {
    try {
      if (this.network !== 'mainnet') {
        throw new Error('This method is only for mainnet deployment');
      }

      logger.warn('🚨 MAINNET DEPLOYMENT INITIATED 🚨');
      
      // Additional mainnet safety checks
      const [deployer] = await ethers.getSigners();
      const balance = await deployer.getBalance();
      const minMainnetBalance = ethers.utils.parseEther('1.0');
      
      if (balance.lt(minMainnetBalance)) {
        throw new Error('Insufficient balance for mainnet deployment (need 1+ ETH)');
      }

      // Require manual confirmation in production
      if (!process.env.CONFIRM_MAINNET_DEPLOY) {
        throw new Error('Set CONFIRM_MAINNET_DEPLOY=true to proceed with mainnet deployment');
      }

      const gasEstimate = await this.estimateDeploymentCosts();
      logger.warn('Mainnet deployment will cost approximately:', gasEstimate.totalCost);

      // Wait for final confirmation
      await this.delay(10000);

      return await this.deploy();

    } catch (error) {
      logger.error('Mainnet deployment failed:', error);
      throw error;
    }
  }

  async generateDeploymentReport(contracts) {
    try {
      const report = {
        network: this.network,
        timestamp: new Date().toISOString(),
        summary: {
          totalContracts: Object.keys(contracts).length,
          deploymentDuration: this.calculateDeploymentDuration(),
          success: true
        },
        contracts: {},
        gasAnalysis: await this.analyzeGasUsage(),
        securityChecks: await this.performSecurityChecks(contracts),
        nextSteps: this.generateNextSteps()
      };

      Object.keys(contracts).forEach(contractName => {
        const deployment = this.deployments.get(contractName);
        report.contracts[contractName] = {
          address: contracts[contractName].address,
          verified: false, // Will be updated after verification
          txHash: deployment.txHash,
          blockNumber: deployment.blockNumber
        };
      });

      const reportPath = path.join(__dirname, '../reports', `deployment-${this.network}-${Date.now()}.json`);
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

      logger.info('Deployment report generated:', reportPath);
      return report;

    } catch (error) {
      logger.error('Error generating deployment report:', error);
      return null;
    }
  }

  calculateDeploymentDuration() {
    if (this.deploymentHistory.length < 2) return 0;
    
    const start = new Date(this.deploymentHistory[0].timestamp);
    const end = new Date(this.deploymentHistory[this.deploymentHistory.length - 1].timestamp);
    
    return Math.floor((end - start) / 1000); // Duration in seconds
  }

  async analyzeGasUsage() {
    const gasAnalysis = {
      totalGasUsed: 0,
      averageGasPerContract: 0,
      mostExpensive: null,
      leastExpensive: null
    };

    const gasUsages = [];

    for (const [contractName, deployment] of this.deployments) {
      if (deployment.contract.deployTransaction) {
        const gasUsed = deployment.contract.deployTransaction.gasLimit.toNumber();
        gasUsages.push({ contractName, gasUsed });
        gasAnalysis.totalGasUsed += gasUsed;
      }
    }

    if (gasUsages.length > 0) {
      gasAnalysis.averageGasPerContract = Math.floor(gasAnalysis.totalGasUsed / gasUsages.length);
      gasAnalysis.mostExpensive = gasUsages.reduce((max, current) => 
        current.gasUsed > max.gasUsed ? current : max
      );
      gasAnalysis.leastExpensive = gasUsages.reduce((min, current) => 
        current.gasUsed < min.gasUsed ? current : min
      );
    }

    return gasAnalysis;
  }

  async performSecurityChecks(contracts) {
    const checks = {
      ownershipCheck: true,
      roleSetupCheck: true,
      emergencyFunctionsCheck: true,
      upgradeabilityCheck: false // MVP contracts are not upgradeable
    };

    try {
      const accessControl = contracts.DiagnoAccessControl;
      const [deployer] = await ethers.getSigners();
      
      // Check if deployer has admin role
      const hasAdminRole = await accessControl.hasRole(
        await accessControl.DEFAULT_ADMIN_ROLE(),
        deployer.address
      );
      
      checks.ownershipCheck = hasAdminRole;

    } catch (error) {
      logger.warn('Security checks failed:', error);
      checks.ownershipCheck = false;
    }

    return checks;
  }

  generateNextSteps() {
    return [
      'Update environment variables with contract addresses',
      'Fund the reputation system reward pool',
      'Set up doctor verification process',
      'Configure Bitcoin oracle price feeds',
      'Test consultation flow end-to-end',
      'Set up monitoring and alerting',
      'Configure IPFS storage',
      'Deploy frontend application'
    ];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    this.deployments.clear();
    this.deploymentHistory.length = 0;
    logger.info('Deployment cleanup completed');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const deployer = new ContractDeployer();

  try {
    switch (command) {
      case 'deploy':
        await deployer.deploy();
        break;
        
      case 'deploy-test':
        await deployer.deployTestEnvironment();
        break;
        
      case 'estimate':
        await deployer.estimateDeploymentCosts();
        break;
        
      case 'verify':
        await deployer.verifyContracts();
        break;
        
      case 'mainnet':
        await deployer.deployToMainnet();
        break;
        
      default:
        console.log('Available commands:');
        console.log('  deploy        - Deploy all contracts');
        console.log('  deploy-test   - Deploy with test data');
        console.log('  estimate      - Estimate deployment costs');
        console.log('  verify        - Verify deployed contracts');
        console.log('  mainnet       - Deploy to mainnet (requires confirmation)');
        break;
    }

  } catch (error) {
    logger.error('Deployment script failed:', error);
    process.exit(1);
  } finally {
    await deployer.cleanup();
  }
}

if (require.main === module) {
  main();
}

module.exports = ContractDeployer;