// Lets the app import the shared, unit-tested battle rules from packages/core.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../../packages/core")];
module.exports = config;
