// Lets the app import the shared SDK from ../../sdk.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../sdk')];
// files in ../../sdk resolve their imports from this app's node_modules
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
