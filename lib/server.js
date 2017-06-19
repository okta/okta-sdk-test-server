#! /usr/bin/env node
const fs = require('fs-extra');
const http = require('http');
const path = require('path');
const request = require('request');
const program = require('commander');
const packageJson = require('../package.json');
const harUtil = require('./harUtil');
const util = require('./util');
const textParser = require('body-parser').text({type: '*/*'});

const defaultPort = 8080;

program
  .version(packageJson.version)
  .option('-p, --port [port number]',  `Port the proxy is started on. defaults to ${defaultPort}`,
    util.formatPath, defaultPort)
  .option('-x, --proxyTarget [url]', 'The domain all requests are proxied to')
  .option('-t, --tapeDir [dir]','Directory with the tapes in HAR format. defaults to ./scenarios',
    util.formatPath, path.join(process.cwd(), 'scenarios'))
  .option('-r, --record', 'Erase all files in tapeDir and record new tapes')
  .parse(process.argv);

if (!program.tapeDir) {
  throw new Error('You must provide a directory to read/write tapes with -t or --tapeDir');
}

if (program.record && !program.proxyTarget) {
  throw new Error('You must provide a domain to proxy requests with -x or --proxyTarget');
}

const record = !!program.record;
const proxyTarget = program.proxyTarget;
const harDirectory = program.tapeDir;
const scenarioEntriesMap = {};

if (record) {
  fs.removeSync(harDirectory);
} else {
  // Load existing scenarios
  fs.readdirSync(harDirectory)
    .map(scenarioFileName => {
      const scenarioName = path.basename(scenarioFileName, '.har');
      const scenarioFileLoc = path.join(harDirectory, scenarioFileName);
      const scenario = fs.readJsonSync(scenarioFileLoc);
      scenarioEntriesMap[scenarioName] = scenario.log.entries;
    });
}

const scenarioRegex = new RegExp('^/([^/]*)?/');

function recordProxy({scenarioName, req, res}) {
  request({
    method: req.method,
    uri: proxyTarget + req.url,
    headers: req.headers,
    body: req.body
  }, (err, httpResponse, responseBody) => {
    if (err) {
      console.log('Error:', err);
      res.responseCode = 500;
      return res.send(err);
    }

    // Write this request/response pair to a har file
    const harFilePath = path.join(harDirectory, `${scenarioName}.har`);
    const har = harUtil.readHarFile(harFilePath);
    const harEntry = harUtil.createHarEntry({proxyTarget, responseBody, req, res});
    har.log.entries.push(harEntry);
    fs.ensureDirSync(harDirectory);
    fs.writeFileSync(harFilePath, JSON.stringify(har, null, 2));
  })
  .pipe(res);
}

function playbackProxy({scenarioName, req, res}) {
  const scenarioEntries = scenarioEntriesMap[scenarioName];
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
}

const server = http.createServer((req, res) => {
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
    console.log(`
      ${req.method} ${req.url}
      ${req.body}
    `);

    if (record) {
      recordProxy({scenarioName, req, res});
    } else {
      playbackProxy({scenarioName, req, res});
    }
  });
});

server.listen(program.port, () => {
  console.log(`Started proxy server on http://localhost:${program.port}`);
});

function cleanup() {
  if ('no responses in any scenario') {
    process.exit(0);
  } else {
    console.log('responses left');
    process.exit(1);
  }
}

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
