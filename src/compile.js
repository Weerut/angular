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
var BOOLEAN_ATTRS = {
	multiple: true,
	selected: true,
	checked: true,
	disabled: true,
	readOnly: true,
	required: true,
	open: true
};
var BOOLEAN_ELEMENTS = {
	INPUT: true,
	SELECT: true,
	OPTION: true,
	TEXTAREA: true,
	BUTTON: true,
	FORM: true,
	DETAILS: true
};

function isBooleanAttribute(node, attrName) {
	return BOOLEAN_ATTRS[attrName] && BOOLEAN_ELEMENTS[node.nodeName];
}

function $CompileProvider($provide) {

	var hasDirectives = {};

	// Function to Add directive into injector.
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
						if (directive.link && !directive.compile) {
							directive.compile = _.constant(directive.link);
						}
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

	this.$get = ['$injector', '$rootScope', function($injector, $rootScope) {

		/* Constrctor fpr Attribute class
		This class wil have member as following
		:- property
			- $$element :element whose attribute attached to
			- $attr : table object map between element key and actual name.
			- attributeName:value  (attribute found in node)
			- className:value  (attribute found in node)
		:- Method
			- $set : to set value of the attribute.
			- $observe : to set callback with new value parameter then there is a change in attribute value.*/
		function Attributes(element) {
			this.$$element = element;
			// this is mapping for normalized attribute name and atribute name
			this.$attr = {};
		}
		Attributes.prototype.$set = function(key, value, writeAttr, attrName) {
			this[key] = value;
			if (isBooleanAttribute(this.$$element[0], key)) {
				this.$$element.prop(key, value);
			}
			if (!attrName) {
				if (this.$attr[key]) {
					attrName = this.$attr[key];
				} else {
					attrName = this.$attr[key] = _.kebabCase(key, '-');
				}
			} else {
				this.$attr[key] = attrName;
			}
			if (writeAttr !== false) {
				this.$$element.attr(attrName, value);
			}

			if (this.$$observers) {
				_.forEach(this.$$observers[key], function(observer) {
					try {
						observer(value);
					} catch (e) {
						console.log(e);
					}
				});
			}
		};
		Attributes.prototype.$observe = function(key, fn) {
			var self = this;
			this.$$observers = this.$$observers || Object.create(null);
			this.$$observers[key] = this.$$observers[key] || [];
			this.$$observers[key].push(fn);
			$rootScope.$evalAsync(function() {
				fn(self[key]);
			});
			return function() {
				var index = self.$$observers[key].indexOf(fn);
				if (index >= 0)
					self.$$observers[key].splice(index, 1);
			};
		};
		Attributes.prototype.$addClass = function(classVal) {
			this.$$element.addClass(classVal);
		};
		Attributes.prototype.$removeClass = function(classVal) {
			this.$$element.removeClass(classVal);
		};
		Attributes.prototype.$updateClass = function(newClassVal, oldClassVal) {
			var newClasses = newClassVal.split(/\s+/);
			var oldClasses = oldClassVal.split(/\s+/);
			var addedClasses = _.difference(newClasses, oldClasses);
			var removedClasses = _.difference(oldClasses, newClasses);
			if (addedClasses.length) {
				this.$addClass(addedClasses.join(' '));
			}
			if (removedClasses.length) {
				this.$removeClass(removedClasses.join(' '));
			}
		};

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

		// MAIN method to make compilation.
		function compile($compileNodes) {
			var compositeLinkFn = compileNodes($compileNodes);
			return function publicLinkFn(scope) {
				$compileNodes.data('$scope', scope);
				compositeLinkFn(scope, $compileNodes);
			};
		}

		// Actual compile process
		function compileNodes($compileNodes) {
			// Array to keep link function which is result of compiling node.
			var linkFns = []
				// in case there are more than 1 topmost level node 
			_.forEach($compileNodes, function(node, i) {
				// Prepare object of attributes each node.
				var attrs = new Attributes($(node));
				// Get directive of that node from registered directives in inject.
				var directives = collectDirectives(node, attrs);
				// Link function of each node.
				var nodeLinkFn;
				if (directives.length) {
					// Apply directive to node
					nodeLinkFn = applyDirectivesToNode(directives, node, attrs);
				}
				var childLinkFn;
				if ((!nodeLinkFn || !nodeLinkFn.terminal) &&
					node.childNodes && node.childNodes.length) {
					childLinkFn = compileNodes(node.childNodes);
				}
				if (nodeLinkFn || childLinkFn) {
					linkFns.push({
						nodeLinkFn: nodeLinkFn,
						childLinkFn: childLinkFn,
						idx: i
					});
				}
			});

			function compositeLinkFn(scope, linkNodes) {
				_.forEach(linkFns, function(linkFn) {
					linkFn.nodeLinkFn(linkFn.childLinkFn, scope, linkNodes[linkFn.idx]);
				});
			}
			return compositeLinkFn;
		}



		function collectDirectives(node, attrs) {
			var directives = [];
			var match;
			if (node.nodeType === Node.ELEMENT_NODE) {
				/*-----------------------------------------*/
				/*  Collecting directive which is ELEMENT  */
				// get camel case name.
				var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
				// use get camelCase name check with directive list to get directives.
				addDirective(directives, normalizedNodeName, 'E');
				/*-----------------------------------------*/
				/* Collecting directive which is ATTRIBUTE */
				_.forEach(node.attributes, function(attr) {
					var attrStartName, attrEndName;
					var name = attr.name;
					var normalizedAttrName = directiveNormalize(name.toLowerCase());
					var isNgAttr = /^ngAttr[A-Z]/.test(normalizedAttrName);
					if (isNgAttr) {
						name = _.kebabCase(
							normalizedAttrName[6].toLowerCase() +
							normalizedAttrName.substring(7)
						);
						normalizedAttrName = directiveNormalize(name.toLowerCase());
					}
					attrs.$attr[normalizedAttrName] = name;
					var directiveName = normalizedAttrName.replace(/(Start|End)$/, '');
					if (directiveIsMultiElement(directiveName)) {
						if (/Start$/.test(normalizedAttrName)) {
							attrStartName = name;
							attrEndName = name.substring(0, name.length - 5) + 'end';
							name = name.substring(0, name.length - 6);
						}
					}
					if (isNgAttr || !attrs.hasOwnProperty(normalizedAttrName)) {
						normalizedAttrName = directiveNormalize(name.toLowerCase());
						addDirective(directives, normalizedAttrName, 'A', attrStartName, attrEndName);
						attrs[normalizedAttrName] = attr.value.trim();
						if (isBooleanAttribute(node, normalizedAttrName)) {
							attrs[normalizedAttrName] = true;
						}
					}
				});
				/*-----------------------------------------*/
				/*   Collecting directive which is CLASS   */
				_.forEach(node.classList, function(cls) {
					var normalizedClassName = directiveNormalize(cls);
					if (addDirective(directives, normalizedClassName, 'C')) {
						attrs[normalizedClassName] = undefined;
					}
				});
				var className = node.className;
				if (_.isString(className) && !_.isEmpty(className)) {}
				while ((match = /([\d\w\-_]+)(?:\:([^;]+))?;?/.exec(className))) {
					var normalizedClassName = directiveNormalize(match[1]);
					if (addDirective(directives, normalizedClassName, 'C')) {
						attrs[normalizedClassName] = match[2] ? match[2].trim() : undefined;
					}
					className = className.substr(match.index + match[0].length);
				}

			} else
			/*-----------------------------------------*/
			/*  Collecting directive which is COMMENT  */
			if (node.nodeType === Node.COMMENT_NODE) {
				match = /^\s*directive\:\s*([\d\w\-_]+)\s*(.*)$/.exec(node.nodeValue);
				if (match) {
					var normalizedName = directiveNormalize(match[1]);
					if (addDirective(directives, normalizedName, 'M')) {
						attrs[normalizedName] = match[2] ? match[2].trim() : undefined;
					}
				}
			}
			directives.sort(byPriority);
			return directives;
		}

		function addDirective(directives, name, mode, attrStartName, attrEndName) {
			var match;
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
					match = directive;
				});
			}
			return match;
		}


		function applyDirectivesToNode(directives, compileNode, attrs) {
			var $compileNode = $(compileNode);
			var terminalPriority = -Number.MAX_VALUE;
			var terminal = false;
			var linkFns = [];
			_.forEach(directives, function(directive) {
				if (directive.$$start) {
					$compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
				}
				if (directive.priority < terminalPriority) {
					return false;
				}
				if (directive.compile) {
					var linkFn = directive.compile($compileNode, attrs);
					if (linkFn) {
						linkFns.push(linkFn);
					}
				}
				if (directive.terminal) {
					terminal = true;
					terminalPriority = directive.priority;
				}
			});

			function nodeLinkFn(childLinkFn, scope, linkNode) {
				if (childLinkFn) {
					childLinkFn(scope, linkNode.childNodes);
				}
				_.forEach(linkFns, function(linkFn) {
					var $element = $(linkNode);
					linkFn(scope, $element, attrs);
				});
			}
			nodeLinkFn.terminal = terminal;
			return nodeLinkFn;
		}


		return compile;
	}];
}

$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;