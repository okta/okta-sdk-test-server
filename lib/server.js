const fs = require('fs-extra');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const request = require('request');
const packageJson = require('../package.json');
const textParser = require('body-parser').text({type: '*/*'});

const record = true;
const proxyTarget = 'https://lboyette.trexcloud.com';
const harDirectory = path.join(__dirname, './scenarios');

const scenarioRegex = new RegExp('^/([^/]*)?/');

// Fetch the har for a scenario
function readHarFile(harFilePath) {
  // Return the har if we have one
  if (fs.existsSync(harFilePath)) {
    return fs.readJsonSync(harFilePath);
  }

  // Return a default har
  return {
    log: {
      version: 1.2,
      creator: {
        name: 'okta-sdk-test-server',
        version: packageJson.version
      },
      pages: [],
      entries: []
    }
  };
}

function createHarEntry(req, res) {
  const request = {
    method: req.method.toUpperCase(),
    url: proxyTarget + req.url,
    headers: Object.entries(req.headers).map(([headerName, header]) => {
      return {
        name: headerName,
        value: header
      };
    }),
    queryString: function() {
      const aggregate = [];
      const parsedUrl = new URL(proxyTarget + req.url);
      for (const [queryName, query] of parsedUrl.searchParams.entries()) {
        aggregate.push({
          name: queryName,
          value: query
        });
      }
      return aggregate;
    }(),
    postData: {
      text: req.body
    }
  };

  const response = {};

  return {
    request,
    response
  };
}

function recordProxy(scenario, req, res) {
  request({
    method: req.method,
    uri: proxyTarget + req.url,
    headers: req.headers,
    body: req.body
  }, (err, httpResponse, body) => {
    if (err) {
      console.log('Error:', err);
      res.responseCode = 500;
      return res.send(err);
    }

    const harFilePath = path.join(harDirectory, `${scenario}.har`);
    const har = readHarFile(harFilePath);
    har.log.entries.push(createHarEntry(req, res));
    fs.ensureDirSync(harDirectory);
    fs.writeFileSync(harFilePath, JSON.stringify(har, null, 2));
  })
  .pipe(res);
}

const server = http.createServer((req, res) => {
  if (!scenarioRegex.test(req.url)) {
    res.statusCode = 400;
    return res.end('must prefix request with a scenario');
  }

  const scenario = scenarioRegex.exec(req.url)[1];
  req.url = req.url.replace(scenarioRegex, '/');

  // Allow us to call without validating the host
  delete req.headers.host;

  // Parse the body
  textParser(req, res, () => {
    recordProxy(scenario, req, res);
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
