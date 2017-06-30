const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const http = require('http');
const request = require('request');
const _ = require('lodash');
const JsDiff = require('diff');
const { stripIndent } = require('common-tags');
const textParser = require('body-parser').text({type: '*/*'});
const harUtil = require('./harUtil');
const util = require('./util');

const server = module.exports;

server.recordProxy = ({app, scenarioName, req, res}) => {
  request({
    method: req.method,
    uri: app.proxyTarget + req.url,
    headers: req.headers,
    body: req.body,
    gzip: true
  }, (err, httpResponse, responseBody) => {
    if (err) {
      console.error('Error making request:', err);
      res.responseCode = 500;
      return res.send(err);
    }

    // Write this request/response pair to a har file
    const harFilePath = path.join(app.tapeDir, `${scenarioName}.har`);
    const har = harUtil.readHarFile(harFilePath);
    const harEntry = harUtil.createHarEntry({responseBody, req, res});
    har.log.entries.push(harEntry);
    fs.ensureDirSync(app.tapeDir);
    fs.writeFileSync(harFilePath, JSON.stringify(har, null, 2));
  })
  .pipe(res);
};

server.playbackProxy = ({app, scenarioName, req, res}) => {
  const scenarioEntries = app.scenarioEntriesMap[scenarioName];
  if (!scenarioEntries) {
    return util.sendError(res, `no record for a scenario named ${scenarioName}`, 404);
  }

  // Pull the next response out of the scenario collection
  const nextEntry = scenarioEntries.shift();

  if (!nextEntry) {
    return util.sendError(res, stripIndent`
      Making more requests than we have a record for '${scenarioName}':
      ${req.method.padEnd(7)} ${app.proxyTarget + req.url}
      ${req.body || 'no body'}
    `);
  }

  // Validate our next request
  const nextRequest = nextEntry.request;

  harUtil.normalizeRequest(req);
  harUtil.normalizeHarRequest(nextRequest);

  // Validate the path
  const nextParsedUrl = new URL(nextRequest.url);
  const urlPath = nextParsedUrl.pathname + nextParsedUrl.search.replace(/%20/g, '+') + nextParsedUrl.hash;

  const errors = [];

  if (req.url !== urlPath) {
    errors.push(`Expected a url does not match:\n\tExpected: ${(urlPath)}\n\tActual:   ${(req.url)}`);
  }

  if (req.method !== nextRequest.method) {
    errors.push(`expected a method of ${nextRequest.method}, but received ${req.method}`);
  }

  if (req.body !== nextRequest.postData.text) {
    if (!req.body) {
      errors.push(`expected body of ${nextRequest.postData.text}, but no body was received`);

    } else if (!nextRequest.postData.text) {
      errors.push(`no body was expected, but received ${req.body}`);

    } else {
      // Build a string to easily show the differences
      const diffs = JsDiff.diffJson(JSON.parse(nextRequest.postData.text), JSON.parse(req.body));
      if (diffs.length > 1) {
        const diffStr = diffs.reduce((prev, curr) => {
          let prefix = '';
          if (curr.added) {
            prefix = '+';
          } else if (curr.removed) {
            prefix = '-';
          }
          return prev + prefix + curr.value;
        }, '');

        errors.push("Received different body than expected ('-' -> expected, '+' -> actual):");
        errors.push(diffStr);
      }
    }
  }

  if (errors.length) {
    errors.unshift(`Error retrieving response for ${scenarioName}.`);
    return util.sendError(res, errors.join('\n'));
  }

  // Send the response
  const nextResponse = nextEntry.response;
  res.statusCode = nextResponse.status;
  res.statusMessage = nextResponse.statusText;

  // Set headers
  nextResponse.headers.map(header => res.setHeader(header.name, header.value));

  const body = nextResponse.content && nextResponse.content.text;
  res.end(body);
};

const scenarioRegex = new RegExp('^/([^/]*)?/');
server.requestHandler = (app, req, res) => {
  if (!scenarioRegex.test(req.url)) {
    return util.sendError(res, 'must prefix request with a scenario');
  }

  const scenarioName = scenarioRegex.exec(req.url)[1];
  req.url = req.url.replace(scenarioRegex, '/');

  // Allow us to call without validating the host
  delete req.headers.host;

  // Parse the body to req.body
  textParser(req, res, () => {
    if (!_.isString(req.body)) {
      delete req.body;
    }

    console.log(`${req.method.padEnd(7)} ${req.url}\n${req.body || 'no body'}\n`);

    if (app.record) {
      server.recordProxy({app, scenarioName, req, res});
    } else {
      server.playbackProxy({app, scenarioName, req, res});
    }
  });
};

server.start = config => {
  const app = {
    record: !!config.record,
    proxyTarget: config.proxyTarget,
    tapeDir: config.tapeDir,
    scenarios: config.scenarios,
    verbose: config.verbose,
    scenarioEntriesMap: {}
  };

  app.cleanup = server.cleanup.bind(null, app);

  // Populate map
  if (app.record) {
    fs.removeSync(app.tapeDir);
  } else if (app.scenarios && app.scenarios.length > 0) {
    // Load scenarios from arg list
    app.scenarios
        .map(scenario => {
          const [scenarioName, scenarioEntries] = harUtil.loadHarFromFile(path.join(app.tapeDir, `${scenario}.har`));
          app.scenarioEntriesMap[scenarioName] = scenarioEntries;
        });
  } else {
    // Load all scenarios
    fs.readdirSync(app.tapeDir)
      .map(scenarioFileName => {
        const [scenarioName, scenarioEntries] = harUtil.loadHarFromFile(path.join(app.tapeDir, scenarioFileName));
        app.scenarioEntriesMap[scenarioName] = scenarioEntries;
      });
  }

  const handler = server.requestHandler.bind(null, app);
  const httpServer = http.createServer(handler);
  httpServer.listen(config.port, () => console.log(stripIndent`
    Started proxy server: http://localhost:${config.port}
    tapeDir: ${app.tapeDir}
    recording: ${app.record}
    scenarios: ${app.scenarios || 'all'}
  `));

  return app;
};

server.cleanup = app => {

  app.stopped = true;
  const incompleteScenarios = Object.entries(app.scenarioEntriesMap).filter(([scenario, entries]) => !!entries.length); // eslint-disable-line no-unused-vars

  if (!incompleteScenarios.length) {
    process.exit(0);
  } else {
    console.log('\nThere are still some scenarios that you need to handle.');
    for (const [scenario, entries] of incompleteScenarios) {
      console.log(`Scenario: ${scenario}`);
      if (app.verbose) {
        console.log('Entries:');
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log('Entries:');
        entries.map(entry => {
          const tempUrl = new URL(entry.request.url);
          const urlPath = tempUrl.pathname + decodeURI(tempUrl.search) + tempUrl.hash;
          console.log(`\t${entry.request.method.padEnd(7)} ${urlPath}`);
        });
      }
    }
    process.exit(1);
  }
};
