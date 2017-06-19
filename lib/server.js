const fs = require('fs-extra');
const http = require('http');
const path = require('path');
const request = require('request');
const harUtil = require('./harUtil');
const textParser = require('body-parser').text({type: '*/*'});

const record = true;
const proxyTarget = 'https://lboyette.trexcloud.com';
const harDirectory = path.normalize(path.join(__dirname, '../scenarios'));
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
  //harUtil.doesRequestEqualEntry(req, entry)

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
    if (record) {
      recordProxy({scenarioName, req, res});
    } else {
      playbackProxy({scenarioName, req, res});
    }
  });
});

server.listen(1234);

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
