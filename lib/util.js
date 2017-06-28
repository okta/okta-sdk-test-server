const path = require('path');
const program = require('commander');
const packageJson = require('../package.json');

const util = module.exports;

util.formatPath = p => {
  if (!p) return;
  if (path.isAbsolute(p)) return p;
  return path.normalize(path.join(process.cwd(), p));
};

util.parseCommandLineArgs = defaults => {
  program
    .version(packageJson.version)
    .option('-p, --port [port number]',
      `Port the proxy is started on. defaults to ${defaults.port}`,
      util.formatPath, defaults.port)
    .option('-x, --proxyTarget [url]', 'The domain all requests are proxied to')
    .option('-t, --tapeDir [dir]',
      `Directory with the tapes in HAR format. defaults to ${defaults.tapeDir}`,
      util.formatPath, defaults.tapeDir)
    .option('-r, --record', 'Erase all files in tapeDir and record new tapes')
    .option('-v, --verbose', 'Outputs verbose log information', defaults.verbose)
    .parse(process.argv);

  if (!program.tapeDir) {
    throw new Error('You must provide a directory to read/write tapes with -t or --tapeDir');
  }

  if (program.record && !program.proxyTarget) {
    throw new Error('You must provide a domain to proxy requests with -x or --proxyTarget');
  }

  return program;
};
