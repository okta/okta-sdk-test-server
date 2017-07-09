const _ = require('lodash');

function buildPathFinder(openapiSpec) {
  const regexToPath = [];

  // Loop through each path
  for (let [pathName, path] of Object.entries(openapiSpec.paths)) {
    // Change the pathName to a regex
    const pathRegex = pathName.replace(/{.*?}/g, '[^/]*?') + '$';
    regexToPath.push({
      regex: new RegExp(pathRegex),
      path
    });
  }

  // Return a function that finds the match
  return url => {
    // Remove the query params from url
    const sanitizedUrl = url.split('?')[0];

    for (let regexPathPair of regexToPath) {
      if (regexPathPair.regex.test(sanitizedUrl)) {
        return regexPathPair.path;
      }
    }
  };
}

function buildOperationFinder(spec) {
  const pathFinder = buildPathFinder(spec);
  return (req) => {
    const path = pathFinder(req.url);
    if (path && req.method) {
      return path[req.method.toLowerCase()];
    }
  };
}

class SpecUtil {
  constructor(openapiSpec) {
    this.spec = openapiSpec;
    this.operationFinder = buildOperationFinder(this.spec);
  }

  getModelForReq(req) {
    const specUtil = this;
    const operation = specUtil.operationFinder(req);

    const bodyParam = _.find(operation.parameters, {in: 'body'});
    const modelName = _.last(bodyParam.schema['$ref'].split('/'));
    return specUtil.spec.definitions[modelName];
  }

  removeReadOnlyProps({req, model, body}) {
    const specUtil = this;

    if (!body) {
      return;
    }

    if (!_.isObject(body)) {
      return body;
    }

    // Get a model if it doesn't exist
    if (!model) {
      model = specUtil.getModelForReq(req);
    }

    // Remove readOnly props for each item in an array
    if (_.isArray(body)) {
      return body.map(item => specUtil.removeReadOnlyProps({model, body: item}));
    }

    const newBody = {};

    // For each property in the body
    for (let propName in Object.keys(body)) {

      // If it's not readOnly
      const prop = model.properties[propName];
      if (!prop) {
        newBody[propName] = body[propName];

      } else if (!prop.readOnly) {

        // If it has a $ref, removeReadOnlyProps
        if (prop['$ref']) {
          const propModelName = _.last(prop['$ref'].split('/'));
          const propModel = specUtil.spec.definitions[propModelName];
          newBody[propName] = specUtil.removeReadOnlyProps({
            model: propModel,
            body: body[propName]
          });

        // If it's an array of items
        } else if (prop.items) {
          if (prop.items['$ref']) {
            const propModelName = _.last(prop.items['$ref'].split('/'));
            const propModel = specUtil.spec.definitions[propModelName];
            newBody[propName] = body[propName].map(item => specUtil.removeReadOnlyProps({
              model: propModel,
              body: item
            }));
          } else {
            newBody[propName] = body[propName];
          }
        } else { // add it to our newBody
          newBody[propName] = body[propName];
        }
      }
    }

    return newBody;
  }
}

module.exports = SpecUtil;
