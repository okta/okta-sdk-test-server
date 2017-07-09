#! /usr/bin/env node
const util = require('./util');
const server = require('./server');
const SpecUtil = require('./SpecUtil');
const spec = require('@okta/openapi');

const config = util.parseCommandLineArgs({
  port: 8080,
  tapeDir: util.packageScenarioDir(),
  verbose: false
});

config.specUtil = new SpecUtil(spec);

const app = server.start(config);

process.on('SIGINT', app.cleanup);
process.on('SIGTERM', app.cleanup);
