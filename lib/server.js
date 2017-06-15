const fs = require('fs');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const yaml = require('js-yaml');
const zlib = require('zlib');

const org = 'https://dev-823303.oktapreview.com';

var argv = require('yargs')
    .usage('Usage: $0 [options]')
    .alias('t', 'tapeDir')
    .describe('t', 'Location of tape files (the tapedeck)')
    .help('h')
    .alias('h', 'help')
    .argv;

const cwd = process.cwd();

var proxy = httpProxy.createProxyServer({secure:false}); // See (†)

const tapePath = argv.t || path.join(cwd, 'tapes');


const scenarios = {
  get: function () {
    // Get document, or throw exception on error
    try {
      var doc = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'scenarios', 'get-users.yaml'), 'utf8'));
    } catch (e) {
      console.log(e);
    }
  }
};

scenarios.get();

class Transaction {
  constructor(clientReq, proxyRes) {
    const buffer = [];
    const gzipped = /gzip/.test(proxyRes.headers['content-encoding']);
    let resPipe = proxyRes;
    if (gzipped) {
      const gunzip = zlib.createGunzip();
      proxyRes.pipe(gunzip);
      resPipe = gunzip;
    }

    const reqData = [];

    clientReq.on('data', data => {
      debugger
      reqData.push(data)
    });
    clientReq.on('end', () => {
      debugger
    });

    resPipe
      .on('data', (data) => buffer.push(data.toString()))
      .on('end', () => {
        this.request = {
          headers: clientReq.headers,
          url: clientReq.url,
          method: clientReq.method
        };
        this.response = {
          headers: proxyRes.headers,
          statusCode: proxyRes.statusCode,
          content: buffer.join('')
        };

        // console.log(output);
      })
      .on('error', (e) => console.error(e));
  }
}

class Scenario {

  constructor(scenarioName) {
    this.scenarioName = scenarioName;
    this.transactions = [];
    Object.defineProperty(this, 'transactionIndex', { enumerable: false, writable: true });
    Object.defineProperty(this, 'dirty', { enumerable: false, writable: true });
    this.dirty = false;
    this.transactionIndex = 0;
  }

  handleRequest(req, res) {

    const transaction = this.transactions[this.transactionIndex];
    if (!transaction) {
      res.statusCode = 400;
      res.write(`No transaction found at transaction index ${this.transactionIndex} in secnario ${this.scenarioName}`);
      return res.end();
    }

    var expectedRequestHead = `${transaction.request.method} ${req.url}`;

    var actualRequestHead = `${req.method} ${req.url}`;

    if (expectedRequestHead === actualRequestHead) {
      res.statusCode = transaction.response.statusCode;
      res.headers = transaction.response.headers;
      res.write(transaction.response.content);
      res.end();
      this.transactionIndex++;
    } else {
      res.statusCode = 400;
      res.write(`Expected: \n\t${expectedRequestHead}\nActual:\n\t${actualRequestHead}`);
      return res.end();
    }


  }

  recordTransaction(req, res) {
    this.transactions.push(new Transaction(req, res));
  }

  deleteTransactions() {
    this.transactions.splice(0, this.transactions.length);
  }
}


class ScenarioManager {

  constructor() {
    this.scenarioMap = {};
  }

  getForUrl(url) {
    var match = url.match(/\/([^\/]+)/);
    if (match.length === 2) {
      return this.getScenario(match[1]);
    }
  }

  getScenario(scenarioName) {
    return this.scenarioMap[scenarioName];
  }

  addScenario(scenario) {
    this.scenarioMap[scenario.scenarioName] = scenario;
  }

  createScenaerio(scenarioName) {
    const scenario = new Scenario(scenarioName);
    this.scenarioMap[scenarioName] = scenario;
    return this.scenarioMap[scenarioName];
  }

  recordTransactionForScenario(scenarioName, req, res) {
    let scenario = this.getScenario();
    if (!scenario) {
      scenario = this.createScenaerio(scenarioName);
    }
    if (!scenario.dirty) {
      scenario.dirty = true;
      scenario.deleteTransactions();
    }
    scenario.recordTransaction(req, res);
  }

  loadFromTapePath(tapePath) {
    fs.readdirSync(tapePath).forEach(filename => {
      var scenarioData = yaml.safeLoad(fs.readFileSync(path.join(tapePath, filename)));
      const scenario = new Scenario(scenarioData.scenarioName);
      scenarioData.transactions.forEach(transaction => scenario.transactions.push(transaction));
      this.addScenario(scenario);
    });
  }

  persist() {
    const fnReturn = {};
    if (!fs.existsSync(tapePath)) {
      fs.mkdirSync(tapePath);
    }

    for (let scenarioName in this.scenarioMap) {
      const scenarioYaml = yaml.safeDump(this.scenarioMap[scenarioName]);
      fnReturn[scenarioName] = scenarioYaml;
      fs.writeFileSync(path.join(tapePath, `${scenarioName}.yaml`), scenarioYaml);
    }

    return fnReturn;
  }

}

const scenarioManager = new ScenarioManager();


function getScenarioName(url) {
  var match = url.match(/scenario\/([^\/]+)/);
  if (match && match.length === 2) {
    return match[1];
  }
}

const requestCache = [];

function proxyRequest(scenarioName, req, res) {
  // proxy the request
  // log the response and emit to front-end

  req.url = req.url.replace(`/scenario/${scenarioName}`, '');
  req.scenarioName = scenarioName;
  requestCache.push(req);
  proxy.web(req, res, {
    target: org,
    agent: require('https').globalAgent,
    headers: {
      host: 'dev-823303.oktapreview.com'
    },
    encoding: null
  });
}

proxy.on('error', (e) => console.error(e));

// function recordTransaction(req, res) {
//   const buffer = [];
//   const gzipped = /gzip/.test(res.headers['content-encoding']);
//   let resPipe = res;
//   if (gzipped) {
//     const gunzip = zlib.createGunzip();
//     res.pipe(gunzip);
//     resPipe = gunzip;
//   }

//   resPipe
//     .on('data', (data) => buffer.push(data.toString()))
//     .on('end', () => {
//       const output = yaml.safeDump({
//         request: {
//           headers: req.headers,
//           url: req.url,
//           method: req.method
//         },
//         response: {
//           headers: res.headers,
//           content: buffer.join('')
//         }
//       });
//       console.log(output);
//     })
//     .on('error', (e) => console.error(e));
// }


class ServerState {
  constructor() {
    this.recordMode = false;
  }
}

const serverState = new ServerState();

//
// Listen for the `proxyRes` event on `proxy`.
//
proxy.on('proxyRes', function (proxyRes, req, res) {
  if (serverState.recordMode) {
    requestCache.forEach(cachedRequest => {
      if (cachedRequest === req) {
        // recordTransaction(req, proxyRes);
        scenarioManager.recordTransactionForScenario(req.scenarioName, req, proxyRes);
        requestCache.splice(requestCache.indexOf(req), 1);
      }
    });
  }
});


function handleServerStateRequest(req, res) {
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.write(JSON.stringify(serverState));
    return res.end();
  }
  if (req.method === 'POST') {
    var body = '';
    req.on('data', (data) => body += data);
    req.on('end', function () {
      try {
        const post = JSON.parse(body);
        if (typeof post.recordMode === 'boolean') {
          serverState.recordMode = !!post.recordMode;
        }
      } catch (e) {
        res.statusCode = 400;
        res.write(JSON.stringify(e));
        res.end();
      }
      res.statusCode = 200;
      res.write(JSON.stringify(serverState));
      res.end();
    });
  }
}


/**
 * If scenarioName matches an already defined scenario:
 *    - Replay responses if not in record mode
 *    - If in record mode, proxy the request and record the response
 *
 * If scenarioName does not match a defined scenario:
 *    - If in record mode, create a new scenario, proxy and record the transaction
 *    - If not in record mode, 404
 */

const server = http.createServer((req, res) => {

  if (req.url.match('/serverState$')) {
    return handleServerStateRequest(req, res);
  }

  if (req.url.match('/persist$') && req.method === 'POST') {
    res.statusCode = 200;
    res.write(JSON.stringify(scenarioManager.persist()));
    return res.end();
  }

  if (req.url.match(/scenario/)) {
    const scenarioName = getScenarioName(req.url);

    const matchedScenario = scenarioManager.getScenario(scenarioName);

    if (matchedScenario) {
      if (serverState.recordMode) {
        return proxyRequest(scenarioName, req, res);
      }
      return matchedScenario.handleRequest(req, res);
    }

    if (serverState.recordMode) {
      return proxyRequest(scenarioName, req, res);
    }

  }

  res.statusCode = 404;
  res.write(`Scenario not implemented for ${req.url}`);
  res.end();
});

server.on('clientError', (err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
server.listen(8000);

scenarioManager.loadFromTapePath(tapePath);