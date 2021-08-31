module.exports = {
  core: {
    connectorsV2: require("./abi/core/connectorsV2.json"),
    instaIndex: require("./abi/core/instaIndex.json"),
  },
  connectors: {
    "Basic-v1": require("./abi/connectors/basic.json"),
    basic: require("./abi/connectors/basic.json"),
    auth: require("./abi/connectors/auth.json"),
    "INSTAPOOL-A": require("./abi/connectors/instapool.json"),
    "1INCH-A": require("./abi/connectors/one-inch.json"),
    "1INCH-B": require("./abi/connectors/one-proto.json"),
    "MAKERDAO-A": require("./abi/connectors/maker.json"),
  },
  basic: {
    erc20: require("./abi/basics/erc20.json"),
  },
};
