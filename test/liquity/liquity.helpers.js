const hre = require("hardhat");
const hardhatConfig = require("../../hardhat.config");

// Instadapp deployment and testing helpers
const deployAndEnableConnector = require("../../scripts/deployAndEnableConnector.js");
const encodeSpells = require("../../scripts/encodeSpells.js");
const getMasterSigner = require("../../scripts/getMasterSigner");
const buildDSAv2 = require("../../scripts/buildDSAv2");

// Instadapp instadappAddresses/ABIs
const instadappAddresses = require("../../scripts/constant/addresses");
const instadappAbi = require("../../scripts/constant/abis");

// Instadapp Liquity Connector artifacts
const connectV2LiquityArtifacts = require("../../artifacts/contracts/mainnet/connectors/liquity/main.sol/ConnectV2Liquity.json");
const connectV2BasicV1Artifacts = require("../../artifacts/contracts/mainnet/connectors/basic/main.sol/ConnectV2Basic.json");
const { ethers } = require("hardhat");

// Instadapp uses a fake address to represent native ETH
const { eth_addr: ETH_ADDRESS } = require("../../scripts/constant/constant");

const LIQUITY_CONNECTOR = "LIQUITY-v1-TEST";
const LUSD_GAS_COMPENSATION = hre.ethers.utils.parseUnits("200", 18); // 200 LUSD gas compensation repaid after loan repayment
const LIQUIDATABLE_TROVES_BLOCK_NUMBER = 12723709; // Deterministic block number for tests to run against, if you change this, tests will break.
const JUSTIN_SUN_ADDRESS = "0x903d12bf2c57a29f32365917c706ce0e1a84cce3"; // LQTY whale address
const LIQUIDATABLE_TROVE_ADDRESS = "0xafbeb4cb97f3b08ec2fe07ef0dac15d37013a347"; // Trove which is liquidatable at blockNumber: LIQUIDATABLE_TROVES_BLOCK_NUMBER
const MAX_GAS = hardhatConfig.networks.hardhat.blockGasLimit; // Maximum gas limit (12000000)
const INSTADAPP_BASIC_V1_CONNECTOR = "Basic-v1";
const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";

const openTroveSpell = async (
  dsa,
  signer,
  depositAmount,
  borrowAmount,
  upperHint,
  lowerHint,
  maxFeePercentage
) => {
  let address = signer.address;
  if (signer.address === undefined) {
    address = await signer.getAddress();
  }

  const openTroveSpell = {
    connector: LIQUITY_CONNECTOR,
    method: "open",
    args: [
      depositAmount,
      maxFeePercentage,
      borrowAmount,
      upperHint,
      lowerHint,
      [0, 0],
      [0, 0],
    ],
  };

  return await dsa
    .connect(signer)
    .cast(...encodeSpells([openTroveSpell]), address, {
      value: depositAmount,
    });
};

const createDsaTrove = async (
  dsa,
  signer,
  liquity,
  depositAmount = hre.ethers.utils.parseEther("5"),
  borrowAmount = hre.ethers.utils.parseUnits("2000", 18)
) => {
  const maxFeePercentage = hre.ethers.utils.parseUnits("0.5", 18); // 0.5% max fee
  const { upperHint, lowerHint } = await getTroveInsertionHints(
    depositAmount,
    borrowAmount,
    liquity
  );
  return await openTroveSpell(
    dsa,
    signer,
    depositAmount,
    borrowAmount,
    upperHint,
    lowerHint,
    maxFeePercentage
  );
};

const sendToken = async (token, amount, from, to) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [from],
  });
  const signer = await hre.ethers.provider.getSigner(from);

  return await token.connect(signer).transfer(to, amount, {
    gasPrice: 0,
  });
};

const resetInitialState = async (
  walletAddress,
  contracts,
  blockNumber = LIQUIDATABLE_TROVES_BLOCK_NUMBER
) => {
  const liquity = await deployAndConnect(contracts, false, blockNumber);
  const dsa = await buildDSAv2(walletAddress);

  return [liquity, dsa];
};

const resetHardhatBlockNumber = async (blockNumber) => {
  return await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: hardhatConfig.networks.hardhat.forking.url,
          blockNumber,
        },
      },
    ],
  });
};

const deployAndConnect = async (
  contracts,
  isDebug = false,
  blockNumber = LIQUIDATABLE_TROVES_BLOCK_NUMBER
) => {
  // Pin Liquity tests to a particular block number to create deterministic state (Ether price etc.)
  await resetHardhatBlockNumber(blockNumber);
  const liquity = {
    troveManager: null,
    borrowerOperations: null,
    stabilityPool: null,
    lusdToken: null,
    lqtyToken: null,
    activePool: null,
    priceFeed: null,
    hintHelpers: null,
    sortedTroves: null,
    staking: null,
    collSurplus: null,
  };

  const masterSigner = await getMasterSigner();
  const instaConnectorsV2 = await ethers.getContractAt(
    instadappAbi.core.connectorsV2,
    instadappAddresses.core.connectorsV2
  );
  const connector = await deployAndEnableConnector({
    connectorName: LIQUITY_CONNECTOR,
    contractArtifact: connectV2LiquityArtifacts,
    signer: masterSigner,
    connectors: instaConnectorsV2,
  });
  isDebug &&
    console.log(`${LIQUITY_CONNECTOR} Connector address`, connector.address);

  const basicConnector = await deployAndEnableConnector({
    connectorName: "Basic-v1",
    contractArtifact: connectV2BasicV1Artifacts,
    signer: masterSigner,
    connectors: instaConnectorsV2,
  });
  isDebug && console.log("Basic-v1 Connector address", basicConnector.address);

  liquity.troveManager = new ethers.Contract(
    contracts.TROVE_MANAGER_ADDRESS,
    contracts.TROVE_MANAGER_ABI,
    ethers.provider
  );

  liquity.borrowerOperations = new ethers.Contract(
    contracts.BORROWER_OPERATIONS_ADDRESS,
    contracts.BORROWER_OPERATIONS_ABI,
    ethers.provider
  );

  liquity.stabilityPool = new ethers.Contract(
    contracts.STABILITY_POOL_ADDRESS,
    contracts.STABILITY_POOL_ABI,
    ethers.provider
  );

  liquity.lusdToken = new ethers.Contract(
    contracts.LUSD_TOKEN_ADDRESS,
    contracts.LUSD_TOKEN_ABI,
    ethers.provider
  );

  liquity.lqtyToken = new ethers.Contract(
    contracts.LQTY_TOKEN_ADDRESS,
    contracts.LQTY_TOKEN_ABI,
    ethers.provider
  );

  liquity.activePool = new ethers.Contract(
    contracts.ACTIVE_POOL_ADDRESS,
    contracts.ACTIVE_POOL_ABI,
    ethers.provider
  );

  liquity.priceFeed = new ethers.Contract(
    contracts.PRICE_FEED_ADDRESS,
    contracts.PRICE_FEED_ABI,
    ethers.provider
  );

  liquity.hintHelpers = new ethers.Contract(
    contracts.HINT_HELPERS_ADDRESS,
    contracts.HINT_HELPERS_ABI,
    ethers.provider
  );

  liquity.sortedTroves = new ethers.Contract(
    contracts.SORTED_TROVES_ADDRESS,
    contracts.SORTED_TROVES_ABI,
    ethers.provider
  );

  liquity.staking = new ethers.Contract(
    contracts.STAKING_ADDRESS,
    contracts.STAKING_ABI,
    ethers.provider
  );
  liquity.collSurplus = new ethers.Contract(
    contracts.COLL_SURPLUS_ADDRESS,
    contracts.COLL_SURPLUS_ABI,
    ethers.provider
  );

  return liquity;
};

const getTroveInsertionHints = async (depositAmount, borrowAmount, liquity) => {
  const nominalCR = await liquity.hintHelpers.computeNominalCR(
    depositAmount,
    borrowAmount
  );

  const {
    hintAddress,
    latestRandomSeed,
  } = await liquity.hintHelpers.getApproxHint(nominalCR, 50, 1298379, {
    gasLimit: MAX_GAS,
  });
  randomSeed = latestRandomSeed;

  const {
    0: upperHint,
    1: lowerHint,
  } = await liquity.sortedTroves.findInsertPosition(
    nominalCR,
    hintAddress,
    hintAddress,
    {
      gasLimit: MAX_GAS,
    }
  );

  return {
    upperHint,
    lowerHint,
  };
};

let randomSeed = 4223;

const getRedemptionHints = async (amount, liquity) => {
  const ethPrice = await liquity.priceFeed.callStatic.fetchPrice();
  const [
    firstRedemptionHint,
    partialRedemptionHintNicr,
  ] = await liquity.hintHelpers.getRedemptionHints(amount, ethPrice, 0);

  const {
    hintAddress,
    latestRandomSeed,
  } = await liquity.hintHelpers.getApproxHint(
    partialRedemptionHintNicr,
    50,
    randomSeed,
    {
      gasLimit: MAX_GAS,
    }
  );
  randomSeed = latestRandomSeed;

  const {
    0: upperHint,
    1: lowerHint,
  } = await liquity.sortedTroves.findInsertPosition(
    partialRedemptionHintNicr,
    hintAddress,
    hintAddress,
    {
      gasLimit: MAX_GAS,
    }
  );

  return {
    partialRedemptionHintNicr,
    firstRedemptionHint,
    upperHint,
    lowerHint,
  };
};

const redeem = async (amount, from, wallet, liquity) => {
  await sendToken(liquity.lusdToken, amount, from, wallet.address);
  const {
    partialRedemptionHintNicr,
    firstRedemptionHint,
    upperHint,
    lowerHint,
  } = await getRedemptionHints(amount, liquity);
  const maxFeePercentage = ethers.utils.parseUnits("0.5", 18); // 0.5% max fee

  return await liquity.troveManager
    .connect(wallet)
    .redeemCollateral(
      amount,
      firstRedemptionHint,
      upperHint,
      lowerHint,
      partialRedemptionHintNicr,
      0,
      maxFeePercentage,
      {
        gasLimit: MAX_GAS, // permit max gas
      }
    );
};

module.exports = {
  deployAndConnect,
  resetInitialState,
  createDsaTrove,
  sendToken,
  getTroveInsertionHints,
  getRedemptionHints,
  redeem,
  LIQUITY_CONNECTOR,
  LUSD_GAS_COMPENSATION,
  JUSTIN_SUN_ADDRESS,
  LIQUIDATABLE_TROVE_ADDRESS,
  MAX_GAS,
  INSTADAPP_BASIC_V1_CONNECTOR,
  ETH_ADDRESS,
  DAI_ADDRESS,
};
