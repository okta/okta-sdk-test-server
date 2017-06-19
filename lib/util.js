const path = require('path');

const util = module.exports;

util.formatPath = p => {
  if (!p) return;
  if (path.isAbsolute(p)) return p;
  return path.normalize(path.join(process.cwd(), p));
};
