'use strict';

var _ = require('lodash');

function $HttpParamSerializerProvider() {
	this.$get = function() {
		return function serializeParams(params) {
			var parts = [];
			_.forEach(params, function(value, key) {
				if (_.isNull(value) || _.isUndefined(value)) {
					return;
				}
				if (!_.isArray(value)) {
					value = [value];
				}
				_.forEach(value, function(v) {
					if (_.isObject(v)) {
						v = JSON.stringify(v);
					}
					parts.push(encodeURIComponent(key) + '=' +
						encodeURIComponent(v));
				});
			});
			return parts.join('&');
		};
	};
}

function $HttpParamSerializerJQLikeProvider() {
	this.$get = function() {
		return function(params) {
			var parts = [];

			function serialize(value, prefix, topLevel) {
				if (_.isNull(value) || _.isUndefined(value)) {
					return;
				}
				if (_.isArray(value)) {
					_.forEach(value, function(v, i) {
						serialize(v, prefix + '[' + (_.isObject(v) ? i : '') + ']');
					});
				} else if (_.isObject(value)) {
					_.forEach(value, function(v, k) {
						serialize(v, prefix + (topLevel ? '' : '[') + k +
							(topLevel ? '' : ']'));
					});
				} else {
					parts.push(encodeURIComponent(prefix) +
						'=' + encodeURIComponent(value));
				}
			}
			serialize(params, '', true);
			return parts.join('&');
		};
	};
}

function $HttpProvider() {
	var interceptorFactories = this.interceptors = [];
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
		transformRequest: [defaultHttpRequestTransform],
		transformResponse: [defaultHttpResponseTransform],
		paramSerializer: '$httpParamSerializer'
	};
	var useApplyAsync = false;
	this.useApplyAsync = function(value) {
		if (_.isUndefined(value)) {
			return useApplyAsync;
		} else {
			useApplyAsync = !!value;
			return this;
		}
	};

	function defaultHttpRequestTransform(data) {
		if (_.isObject(data) && !isBlob(data) &&
			!isFile(data) && !isFormData(data)) {
			return JSON.stringify(data);
		} else {
			return data;
		}
	}

	function defaultHttpResponseTransform(data, headers) {
		//  If it's string 
		if (_.isString(data)) {
			var contentType = headers('Content-Type');
			// Check if it's json type then pass json.
			if ((contentType &&
					contentType.indexOf('application/json') === 0) ||
				isJsonLike(data)) {
				return JSON.parse(data);
			}
		}
		//  If it's not string, Do not transform.
		return data;
	}

	function isJsonLike(data) {
		if (data.match(/^\{(?!\{)/)) {
			return data.match(/\}$/);
		} else if (data.match(/^\[/)) {
			return data.match(/\]$/);
		}
	}

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

	function buildUrl(url, serializedParams) {
		if (serializedParams.length) {
			url += (url.indexOf('?') === -1) ? '?' : '&';
			url += serializedParams;
		}
		return url;
	}

	this.$get = ['$httpBackend', '$q', '$rootScope', '$injector',
		function($httpBackend, $q, $rootScope, $injector) {
			// To merge request header to default header config
			function mergeHeaders(config) {
				// aggreate requestconfig into reqHeaders object
				var reqHeaders = _.extend({}, config.headers);
				// find default config 
				var defHeaders = _.extend({},
					defaults.headers.common,
					defaults.headers[(config.method || 'get').toLowerCase()]
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
				// In case that header value is function 
				// replace function with value of thatfunction 
				return executeHeaderFns(reqHeaders, config);
			}
			// Replce value function in header by its value.
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
			// function returns function which will return header value 
			// by name stored from this function parameter.
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
			// parseHeader to be object.
			function parseHeaders(headers) {
				// If it's alreayd object, trim key and value, 
				// make key lower case.
				if (_.isObject(headers)) {
					return _.transform(headers, function(result, v, k) {
						result[_.trim(k.toLowerCase())] = _.trim(v);
					}, {});
				} else {
					// If it was string parse it to object
					var lines = headers.split('\n');
					return _.transform(lines, function(result, line) {
						var separatorAt = line.indexOf(':');
						var name = _.trim(line.substr(0, separatorAt))
							.toLowerCase();
						var value = _.trim(line.substr(separatorAt + 1));
						if (name) {
							result[name] = value;
						}
					}, {});
				}
			}

			// Function to transform data.
			function transformData(data, headers, status, transform) {
				// Check transform is Array of functions or just a function.
				if (_.isFunction(transform)) {
					// If it's a function, process it once.
					return transform(data, headers, status);
				} else {
					// if it's arrays of function. then 
					// apply transform function in array in sequence chain. 
					return _.reduce(transform, function(data, fn) {
						return fn(data, headers, status);
					}, data);
				}
			}

			function sendReq(config, reqData) {
				var deferred = $q.defer();
				$http.pendingRequests.push(config);
				deferred.promise.then(function() {
					_.remove($http.pendingRequests, config);
				}, function() {
					_.remove($http.pendingRequests, config);
				});

				function done(status, response, headersString, statusText) {
					status = Math.max(status, 0);

					function resolvePromise() {
						deferred[isSuccess(status) ? 'resolve' : 'reject']({
							status: status,
							data: response,
							statusText: statusText,
							headers: headersGetter(headersString),
							config: config
						});
					}
					if (useApplyAsync) {
						$rootScope.$applyAsync(resolvePromise);
					} else {
						resolvePromise();
						if (!$rootScope.$$phase) {
							$rootScope.$apply();
						}
					}
				}

				var url = buildUrl(config.url,
					config.paramSerializer(config.params));

				$httpBackend(config.method, url,
					reqData, done, config.headers,
					config.timeout,
					config.withCredentials);
				return deferred.promise;
			}

			function $http(requestConfig) {
				//  Add requestConfig necessary parameter:
				//  1.method, 2.transformRequest 3.transformResponse 
				var config = _.extend({
					method: 'GET',
					transformRequest: defaults.transformRequest,
					transformResponse: defaults.transformResponse,
					paramSerializer: defaults.paramSerializer
				}, requestConfig);
				// Merge header with default setting
				config.headers = mergeHeaders(requestConfig);
				// Inject paramSerializer if it's string.
				if (_.isString(config.paramSerializer)) {
					config.paramSerializer = $injector
						.get(config.paramSerializer);
				}

				var promise = $q.when(config);
				_.forEach(interceptors, function(interceptor) {
					promise = promise.then(interceptor.request, interceptor.requestError);
				});
				promise = promise.then(serverRequest);
				_.forEachRight(interceptors, function(interceptor) {
					promise = promise.then(interceptor.response, interceptor.responseError);
				});
				promise.success = function(fn) {
					promise.then(function(response) {
						fn(response.data, response.status, response.headers, config);
					});
					return promise;
				};
				promise.error = function(fn) {
					promise.catch(function(response) {
						fn(response.data, response.status, response.headers, config);
					});
					return promise;
				};
				return promise;
			}

			function serverRequest(config) {
				// set withCredentials parameter based on request config.
				if (_.isUndefined(config.withCredentials) &&
					!_.isUndefined(defaults.withCredentials)) {
					config.withCredentials = defaults.withCredentials;
				}

				// Do tranform of request data before pass data to backend.
				var reqData = transformData(config.data, //DataInConfiguration.
					headersGetter(config.headers), // headerGetter funciton
					undefined, // 
					config.transformRequest // ArrayOfRequestTransformingFunctions
				);
				// Check if transformed requestData is invalid.
				// then delete content
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
							undefined,
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

			var interceptors = _.map(interceptorFactories, function(fn) {
				return _.isString(fn) ? $injector.get(fn) : $injector.invoke(fn);
			});

			$http.defaults = defaults;
			$http.pendingRequests = [];

			_.forEach(['get', 'head', 'delete'], function(method) {
				$http[method] = function(url, config) {
					return $http(_.extend(config || {}, {
						method: method.toUpperCase(),
						url: url
					}));
				};
			});
			_.forEach(['post', 'put', 'patch'], function(method) {
				$http[method] = function(url, data, config) {
					return $http(_.extend(config || {}, {
						method: method.toUpperCase(),
						url: url,
						data: data
					}));
				};
			});
			return $http;
		}
	];

}

module.exports = {
	$HttpProvider: $HttpProvider,
	$HttpParamSerializerProvider: $HttpParamSerializerProvider,
	$HttpParamSerializerJQLikeProvider: $HttpParamSerializerJQLikeProvider
};