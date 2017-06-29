#! /usr/bin/env node
const path = require('path');
const util = require('./util');
const server = require('./server');

const config = util.parseCommandLineArgs({
  port: 8080,
  tapeDir: util.packageScenarioDir(),
  verbose: false
});

const app = server.start(config);

process.on('SIGINT', app.cleanup);
process.on('SIGTERM', app.cleanup);
