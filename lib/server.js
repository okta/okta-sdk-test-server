const fs = require('fs');
const http = require('http');
const path = require('path');
const request = require('request');
const textParser = require('body-parser').text({type: '*/*'});

const proxyTarget = 'https://lboyette.trexcloud.com';
const harDirectory = path.join(__dirname, './scenarios');

const scenarioRegex = new RegExp('^/([^/]*)?/');

function recordProxy(scenario, req, res) {
  request({
    method: req.method,
    uri: proxyTarget + req.url,
    headers: req.headers,
    body: req.body
  }, (err, httpResponse, body) => {
    if (err) {
      console.log('Error:', err);
      return;
    }

    // Read existing har

    // Add new entry


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
