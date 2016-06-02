'use strict';

var _ = require('lodash');
var $ = require('jquery');

function nodeName(element) {
	return element.nodeName ? element.nodeName : element[0].nodeName;
}

var PREFIX_REGEXP = /(x[\:\-_]|data[\:\-_])/i;

function directiveNormalize(name) {
	return _.camelCase(name.replace(PREFIX_REGEXP, ''));
}

function byPriority(a, b) {
	var diff = b.priority - a.priority;
	if (diff !== 0) {
		return diff;
	} else {
		if (a.name !== b.name) {
			return (a.name < b.name ? -1 : 1);
		} else {
			return a.index - b.index;
		}
	}
}

function $CompileProvider($provide) {

	var hasDirectives = {};

	this.directive = function(name, directiveFactory) {
		if (_.isString(name)) {
			if (name === 'hasOwnProperty') {
				throw 'hasOwnProperty is not a valid directive name';
			}
			if (!hasDirectives.hasOwnProperty(name)) {
				hasDirectives[name] = [];
				$provide.factory(name + 'Directive', ['$injector', function($injector) {
					var factories = hasDirectives[name];
					return _.map(factories, function(factory, i) {
						var directive = $injector.invoke(factory);
						directive.restrict = directive.restrict || 'EA';
						directive.priority = directive.priority || 0;
						directive.name = directive.name || name;
						directive.index = i;
						return directive;
					});
				}]);
			}
			hasDirectives[name].push(directiveFactory);
		} else {
			_.forEach(name, _.bind(function(directiveFactory, name) {
				this.directive(name, directiveFactory);
			}, this));
		}
	};

	this.$get = ['$injector', function($injector) {

		function compile($compileNodes) {
			return compileNodes($compileNodes);
		}

		// Actual compile process
		function compileNodes($compileNodes) {
			// in case there are more than 1 topmost level node 
			_.forEach($compileNodes, function(node) {
				// Get directive of that node from registered directives in inject.
				var directives = collectDirectives(node);
				// Apply directive to node
				applyDirectivesToNode(directives, node);
				if (node.childNodes && node.childNodes.length) {
					compileNodes(node.childNodes);
				}
			});
		}

		function collectDirectives(node) {
			var directives = [];
			if (node.nodeType === Node.ELEMENT_NODE) {
				// get camel case name.
				var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
				// use get camelCase name check with directive list to get directives.
				addDirective(directives, normalizedNodeName, 'E');
				_.forEach(node.attributes, function(attr) {
					var normalizedAttrName = directiveNormalize(attr.name.toLowerCase());
					if (/^ngAttr[A-Z]/.test(normalizedAttrName)) {
						normalizedAttrName = normalizedAttrName[6].toLowerCase() + normalizedAttrName.substring(7);
					}
					addDirective(directives, normalizedAttrName, 'A');
				});
				_.forEach(node.classList, function(cls) {
					var normalizedClassName = directiveNormalize(cls);
					addDirective(directives, normalizedClassName, 'C');
				});
			} else if (node.nodeType === Node.COMMENT_NODE) {
				var match = /^\s*directive\:\s*([\d\w\-_]+)/.exec(node.nodeValue);
				if (match) {
					addDirective(directives, directiveNormalize(match[1]), 'M');
				}
			}
			directives.sort(byPriority);
			return directives;
		}

		function addDirective(directives, name, mode) {
			if (hasDirectives.hasOwnProperty(name)) {
				var foundDirectives = $injector.get(name + 'Directive');
				var applicableDirectives = _.filter(foundDirectives, function(dir) {
					return dir.restrict.indexOf(mode) !== -1;
				});
				directives.push.apply(directives, applicableDirectives);
			}
		}


		function applyDirectivesToNode(directives, compileNode) {
			var $compileNode = $(compileNode);
			_.forEach(directives, function(directive) {
				if (directive.compile) {
					directive.compile($compileNode);
				}
			});
		}

		return compile;
	}];
}

$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;