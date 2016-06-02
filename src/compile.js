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
		
		function directiveIsMultiElement(name) {
			if (hasDirectives.hasOwnProperty(name)) {
				var directives = $injector.get(name + 'Directive');
				return _.some(directives, {
					multiElement: true
				});
			}
			return false;
		}

		function groupScan(node, startAttr, endAttr) {
			var nodes = [];
			if (startAttr && node && node.hasAttribute(startAttr)) {
				var depth = 0;
				do {
					if (node.nodeType === Node.ELEMENT_NODE) {
						if (node.hasAttribute(startAttr)) {
							depth++;
						} else if (node.hasAttribute(endAttr)) {
							depth--;
						}
					}
					nodes.push(node);
					node = node.nextSibling;
				} while (depth > 0);
			} else {
				nodes.push(node);
			}
			return $(nodes);
		}

		function directiveIsMultiElement(name) {
			if (hasDirectives.hasOwnProperty(name)) {
				var directives = $injector.get(name + 'Directive');
				return _.some(directives, {
					multiElement: true
				});
			}
			return false;
		}

		function groupScan(node, startAttr, endAttr) {
			var nodes = [];
			if (startAttr && node && node.hasAttribute(startAttr)) {
				var depth = 0;
				do {
					if (node.nodeType === Node.ELEMENT_NODE) {
						if (node.hasAttribute(startAttr)) {
							depth++;
						} else if (node.hasAttribute(endAttr)) {
							depth--;
						}
					}
					nodes.push(node);
					node = node.nextSibling;
				} while (depth > 0);
			} else {
				nodes.push(node);
			}
			return $(nodes);
		}

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
				var terminal = applyDirectivesToNode(directives, node);
				if (!terminal && node.childNodes && node.childNodes.length) {
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
					var attrStartName, attrEndName;
					var name = attr.name;
					var normalizedAttrName = directiveNormalize(name.toLowerCase());
					if (/^ngAttr[A-Z]/.test(normalizedAttrName)) {
						name = _.kebabCase(normalizedAttrName[6].toLowerCase() + normalizedAttrName.substring(7));
					}
					var directiveNName = normalizedAttrName.replace(/(Start|End)$/, '');
					if (directiveIsMultiElement(directiveNName)) {
						if (/Start$/.test(normalizedAttrName)) {
							attrStartName = name;
							attrEndName = name.substring(0, name.length - 5) + 'end';
							name = name.substring(0, name.length - 6);
						}
					}
					normalizedAttrName = directiveNormalize(name.toLowerCase());
					addDirective(directives, normalizedAttrName, 'A', attrStartName, attrEndName);
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

		function addDirective(directives, name, mode, attrStartName, attrEndName) {
			if (hasDirectives.hasOwnProperty(name)) {
				var foundDirectives = $injector.get(name + 'Directive');
				var applicableDirectives = _.filter(foundDirectives, function(dir) {
					return dir.restrict.indexOf(mode) !== -1;
				});
				_.forEach(applicableDirectives, function(directive) {
					if (attrStartName) {
						directive = _.create(directive, {
							$$start: attrStartName,
							$$end: attrEndName
						});
					}
					directives.push(directive);
				});
			}
		}


		function applyDirectivesToNode(directives, compileNode) {
			var $compileNode = $(compileNode);
			var terminalPriority = -Number.MAX_VALUE;
			var terminal = false;
			_.forEach(directives, function(directive) {
				if (directive.$$start) {
					$compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
				}
				if (directive.priority < terminalPriority) {
					return false;
				}
				if (directive.compile) {
					directive.compile($compileNode);
				}
				if (directive.terminal) {
					terminal = true;
					terminalPriority = directive.priority;
				}
			});
			return terminal;
		}


		return compile;
	}];
}

$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;