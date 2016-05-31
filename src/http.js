'use strict';

var _ = require('lodash');

function $HttpProvider() {

	var defaults = this.defaults = {
		headers: {
			common: {
				Accept: 'application/json, text/plain, */*'
			},
			post: {
				'Content-Type': 'application/json;charset=utf-8'
			},
			put: {
				'Content-Type': 'application/json;charset=utf-8'
			},
			patch: {
				'Content-Type': 'application/json;charset=utf-8'
			}
		},
		transformRequest: [function(data) {
			if (_.isObject(data) && !isBlob(data) && !isFile(data) && !isFormData(data)) {
				return JSON.stringify(data);
			} else {
				return data;
			}
		}],
	};

	function isBlob(object) {
		return object.toString() === '[object Blob]';
	}

	function isFile(object) {
		return object.toString() === '[object File]';
	}

	function isFormData(object) {
		return object.toString() === '[object FormData]';
	}

	function isSuccess(status) {
		return status >= 200 && status < 300;
	}

	this.$get = ['$httpBackend', '$q', '$rootScope',
		function($httpBackend, $q, $rootScope) {
			// To merge default config into request configuration data
			function mergeHeaders(config) {
				// aggreate requestconfig into reqHeaders object
				var reqHeaders = _.extend({}, config.headers);
				// set default config to defHeader
				var defHeaders = _.extend({},
					defaults.headers.common,
					defaults.headers[(config.method || 'get').toLowerCase()],
					defaults.withCredentials
				);
				// Check by each default header
				_.forEach(defHeaders, function(value, key) {
					// If there is request header exist do nothing
					var headerExists = _.some(reqHeaders, function(v, k) {
						return k.toLowerCase() === key.toLowerCase();
					});
					// if it's not set default header to request header.
					if (!headerExists) {
						reqHeaders[key] = value;
					}
				});
				return executeHeaderFns(reqHeaders, config);
			}

			function executeHeaderFns(headers, config) {
				return _.transform(headers, function(result, v, k) {
					if (_.isFunction(v)) {
						v = v(config);
						if (_.isNull(v) || _.isUndefined(v)) {
							delete result[k];
						} else {
							result[k] = v;
						}
					}
				}, headers);
			}

			function headersGetter(headers) {
				var headersObj;
				return function(name) {
					headersObj = headersObj || parseHeaders(headers);
					if (name) {
						return headersObj[name.toLowerCase()];
					} else {
						return headersObj;
					}
				};
			}

			function parseHeaders(headers) {
				if (_.isObject(headers)) {
					return _.transform(headers, function(result, v, k) {
						result[_.trim(k.toLowerCase())] = _.trim(v);
					}, {});
				} else {
					var lines = headers.split('\n');
					return _.transform(lines, function(result, line) {
						var separatorAt = line.indexOf(':');
						var name = _.trim(line.substr(0, separatorAt)).toLowerCase();
						var value = _.trim(line.substr(separatorAt + 1));
						if (name) {
							result[name] = value;
						}
					}, {});
				}
			}

			function transformData(data, headers, status, transform) {
				if (_.isFunction(transform)) {
					return transform(data, headers, status);
				} else {
					return _.reduce(transform, function(data, fn) {
						return fn(data, headers, status);
					}, data);
				}
			}

			function sendReq(config, reqData) {
				var deferred = $q.defer();

				function done(status, response, headersString, statusText) {
					status = Math.max(status, 0);
					deferred[isSuccess(status) ? 'resolve' : 'reject']({
						status: status,
						data: response,
						statusText: statusText,
						headers: headersGetter(headersString),
						config: config
					});
					if (!$rootScope.$$phase) {
						$rootScope.$apply();
					}
				}
				$httpBackend(config.method, config.url,
					reqData, done, config.headers,
					config.withCredentials);
				return deferred.promise;
			}

			function $http(requestConfig) {
				var config = _.extend({
					method: 'GET',
					transformRequest: defaults.transformRequest,
					transformResponse: defaults.transformResponse
				}, requestConfig);
				config.headers = mergeHeaders(requestConfig);
				if (_.isUndefined(config.withCredentials) &&
					!_.isUndefined(defaults.withCredentials)) {
					config.withCredentials = defaults.withCredentials;
				}
				var reqData = transformData(config.data,
					headersGetter(config.headers),
					undefined,
					config.transformRequest
				);

				if (_.isUndefined(reqData)) {
					_.forEach(config.headers, function(v, k) {
						if (k.toLowerCase() === 'content-type') {
							delete config.headers[k];
						}
					});
				}

				function transformResponse(response) {
					if (response.data) {
						response.data = transformData(
							response.data, response.headers,
							config.transformResponse
						);
					}
					if (isSuccess(response.status)) {
						return response;
					} else {
						return $q.reject(response);
					}
				}

				return sendReq(config, reqData)
					.then(transformResponse, transformResponse);
			}


			$http.defaults = defaults;
			return $http;
		}
	];

}

module.exports = $HttpProvider;