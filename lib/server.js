const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const request = require('request');
const _ = require('lodash');
const textParser = require('body-parser').text({type: '*/*'});
const harUtil = require('./harUtil');


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
      console.log('Error:', err);
      res.responseCode = 500;
      return res.send(err);
    }

    // Write this request/response pair to a har file
    const harFilePath = path.join(app.tapeDir, `${scenarioName}.har`);
    const har = harUtil.readHarFile(harFilePath);
    const harEntry = harUtil.createHarEntry({proxyTarget, responseBody, req, res});
    har.log.entries.push(harEntry);
    fs.ensureDirSync(app.tapeDir);
    fs.writeFileSync(harFilePath, JSON.stringify(har, null, 2));
  })
  .pipe(res);
}

server.playbackProxy = ({app, scenarioName, req, res}) => {
  const scenarioEntries = app.scenarioEntriesMap[scenarioName];
  if (!scenarioEntries) {
    res.statusCode = 404;
    return res.end(`no record for a scenario named ${scenarioName}`);
  }

  // Pull the next response out of the scenario collection
  const nextEntry = scenarioEntries.shift();

  if (!nextEntry) {
    res.statusCode = 400;
    return res.end(`
      Making more requests than we have a record for '${scenarioName}':
      ${req.method} ${proxyTarget + req.url}
      ${req.body}
    `);
  }

  harUtil.normalizeRequest(req);

  // Validate our next request
  const nextRequest = nextEntry.request;

  if (proxyTarget + req.url != nextRequest.url ||
      req.method != nextRequest.method ||
      req.body != nextRequest.postData.text) {
      res.statusCode = 400;
      return res.end(`
        Error retrieving response for '${scenarioName}'.
        
        Expected:
        ${nextRequest.method} ${nextRequest.url}
        ${nextRequest.postData.text}

        Received:
        ${req.method} ${proxyTarget + req.url}
        ${req.body}
      `);
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
    res.statusCode = 400;
    return res.end('must prefix request with a scenario');
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

    console.log(`
      ${req.method} ${req.url}
      ${req.body}
    `);

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
    verbose: config.verbose,
    scenarioEntriesMap: {}
  };

  app.cleanup = server.cleanup.bind(null, app);

  // Populate map
  if (app.record) {
    fs.removeSync(app.tapeDir);
  } else {
    // Load existing scenarios
    fs.readdirSync(app.tapeDir)
      .map(scenarioFileName => {
        const scenarioName = path.basename(scenarioFileName, '.har');
        const scenarioFileLoc = path.join(app.tapeDir, scenarioFileName);
        const scenario = fs.readJsonSync(scenarioFileLoc);
        app.scenarioEntriesMap[scenarioName] = scenario.log.entries;
      });
  }

  const handler = server.requestHandler.bind(null, app);
  const httpServer = http.createServer(handler);
  httpServer.listen(config.port, () => console.log(`
    Started proxy server: http://localhost:${config.port}
    tapeDir: ${app.tapeDir},
    recording: ${app.record}
  `));

  return app;
};

server.cleanup = app => {

  app.stopped = true;
  const incompleteScenarios = Object.entries(app.scenarioEntriesMap).filter(([scenario, entries]) => !!entries.length);

  if (!incompleteScenarios.length) {
    process.exit(0);
  } else {
    console.log('\nThere are still some scenarios that you need to handle.');
    for (const [scenario, entries] of incompleteScenarios) {
      console.log(`Scenario: ${scenario}`);
      if (app.verbose) {
          console.log('Entries:');
          console.log(JSON.stringify(entries, null, 2));
      }
    }
    process.exit(1);
  }
};
