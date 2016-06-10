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

function parseIsolateBindings(scope) {
	var bindings = {};
	_.forEach(scope, function(definition, scopeName) {
		var match = definition.match(/\s*([@<&]|=(\*?))(\??)\s*(\w*)\s*/);
		bindings[scopeName] = {
			mode: match[1][0],
			collection: match[2] === '*',
			optional: match[3],
			attrName: match[4] || scopeName
		};
	});
	return bindings;
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
						directive.$$bindings = parseDirectiveBindings(directive); 
						// if (_.isObject(directive.scope)) {
						// 	directive.$$isolateBindings = parseIsolateBindings(directive.scope);
						// }
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

	this.$get = ['$injector', '$parse', '$controller', '$rootScope',
		function($injector, $parse, $controller, $rootScope) {

			/* Constrctor fpr Attribute class
			This class wil have member as following
			:- property
				- $$element :element whose attribute attached to
				- $attr : table object map between element key and actual name.
				- attributeName:value  (attribute found in node)
				- className:value  (attribute found in node)
			:- Method
				- $set : to set value of the attribute.
				- $observe : to set callback with new value parameter 
				then there is a change in attribute value.*/
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

			/* ---------------------------------------*/
			/*                                        */
			/*       		Helper Class 			  */
			/*                                        */
			/* ---------------------------------------*/

			/* return jquery element for node inside group attribute */
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

			/* Check directive whether it's multi element directive or not.*/
			/* reture true:multielement, false:it's not */
			function directiveIsMultiElement(name) {
				if (hasDirectives.hasOwnProperty(name)) {
					var directives = $injector.get(name + 'Directive');
					return _.some(directives, {
						multiElement: true
					});
				}
				return false;
			}

			/* Get all directives of particular :node which has :attrs attributes.*/
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
							addDirective(directives, normalizedAttrName, 'A',
								attrStartName, attrEndName);
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
				// Sort directive by its priority.
				directives.sort(byPriority);
				return directives;
			}

			// add directive with :name and :mode into :directives 
			// If there is directive applicable at least one, return true.
			function addDirective(directives, name, mode, attrStartName, attrEndName) {
				var match;
				if (hasDirectives.hasOwnProperty(name)) {
					var foundDirectives = $injector.get(name + 'Directive');
					//当該Directive だけをApplicableDirectives として扱う。
					var applicableDirectives = _.filter(foundDirectives, function(dir) {
						return dir.restrict.indexOf(mode) !== -1;
					});
					_.forEach(applicableDirectives, function(directive) {
						// Add $$start or $$end property if it's multi element directive.
						if (attrStartName) {
							directive = _.create(directive, {
								$$start: attrStartName,
								$$end: attrEndName
							});
						}
						// store get directive into directives array.
						directives.push(directive);
						match = directive;
					});
				}
				return match;
			}

			/*------------------------------------------------------*/
			/*                                                      */
			/* Class chain for Compiling to execute complie service */
			/*                                                      */
			/*------------------------------------------------------*/

			// MAIN method to make compilation.
			function compile($compileNodes) {
				var compositeLinkFn = compileNodes($compileNodes);

				//*Return function*/
				// This function will run chain of link function.
				function publicLinkFn(scope) {
					$compileNodes.data('$scope', scope);
					compositeLinkFn(scope, $compileNodes);
				}
				return publicLinkFn;
			}

			// Actual compile process
			function compileNodes($compileNodes) {
				// Array to keep link function which is result of compiling node.
				var linkFns = [];
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
						// Apply same function to ChildNode in recursive fashion.
						childLinkFn = compileNodes(node.childNodes);
					}
					if (nodeLinkFn && nodeLinkFn.scope) {
						attrs.$$element.addClass('ng-scope');
					}
					if (nodeLinkFn || childLinkFn) {
						linkFns.push({
							nodeLinkFn: nodeLinkFn,
							childLinkFn: childLinkFn,
							idx: i
						});
					}
				});

				/* Return function. */
				// This function wil run invoke method for each node to run link function
				function compositeLinkFn(scope, linkNodes) {
					var stableNodeList = [];
					_.forEach(linkFns, function(linkFn) {
						var nodeIdx = linkFn.idx;
						stableNodeList[nodeIdx] = linkNodes[nodeIdx];
					});
					_.forEach(linkFns, function(linkFn) {
						var node = stableNodeList[linkFn.idx];
						if (linkFn.nodeLinkFn) {
							if (linkFn.nodeLinkFn.scope) {
								scope = scope.$new();
								$(node).data('$scope', scope);
							}
							linkFn.nodeLinkFn(linkFn.childLinkFn, scope, node);
						} else {
							linkFn.childLinkFn(scope, node.childNodes);
						}
					});
				}
				return compositeLinkFn;
			}



			function applyDirectivesToNode(directives, compileNode, attrs) {
				var $compileNode = $(compileNode);
				var terminalPriority = -Number.MAX_VALUE;
				var terminal = false;
				var preLinkFns = [],
					postLinkFns = [],
					controllers = {};
				var newScopeDirective, newIsolateScopeDirective;
				var controllerDirectives;

				function addLinkFns(preLinkFn, postLinkFn, attrStart, attrEnd, isolateScope) {
					if (preLinkFn) {
						// If multi-element subtitue l[inkFn with multi-element linkFns by 
						// groupElementsLinkFnWrapper.
						if (attrStart) {
							preLinkFn =
								groupElementsLinkFnWrapper(preLinkFn, attrStart, attrEnd);
						}
						preLinkFn.isolateScope = isolateScope;
						preLinkFns.push(preLinkFn);
					}
					if (postLinkFn) {
						// If multi-element subtitue l[inkFn with multi-element linkFns by 
						// groupElementsLinkFnWrapper.
						if (attrStart) {
							postLinkFn =
								groupElementsLinkFnWrapper(postLinkFn, attrStart, attrEnd);
						}
						postLinkFn.isolateScope = isolateScope;
						postLinkFns.push(postLinkFn);
					}
				}
				// return function that wil execute :linkFn with group of element based on 
				// :attrStart and :attrEnd paramter provide here.
				function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
					return function(scope, element, attrs) {
						var group = groupScan(element[0], attrStart, attrEnd);
						return linkFn(scope, group, attrs);
					};
				}

				_.forEach(directives, function(directive) {
					if (directive.$$start) {
						$compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
					}
					if (directive.priority < terminalPriority) {
						return false;
					}
					if (directive.scope) {
						if (_.isObject(directive.scope)) {
							if (newIsolateScopeDirective || newScopeDirective) {
								throw 'Multiple directives asking for new/inherited scope';
							}
							newIsolateScopeDirective = directive;
						} else {
							if (newIsolateScopeDirective) {
								throw 'Multiple directives asking for new/inherited scope';
							}
							newScopeDirective = newScopeDirective || directive;
						}
					}
					if (directive.compile) {
						var linkFn = directive.compile($compileNode, attrs);
						var isolateScope = (directive === newIsolateScopeDirective);
						var attrStart = directive.$$start;
						var attrEnd = directive.$$end;
						if (_.isFunction(linkFn)) {
							addLinkFns(null, linkFn, attrStart, attrEnd, isolateScope);
						} else if (linkFn) {
							addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd, isolateScope);
						}
					}
					if (directive.terminal) {
						terminal = true;
						terminalPriority = directive.priority;
					}
					if (directive.controller) {
						controllerDirectives = controllerDirectives || {};
						controllerDirectives[directive.name] = directive;
					}
				});

				/* Return function. */
				// This method will run link function for each node.
				function nodeLinkFn(childLinkFn, scope, linkNode) {
					var $element = $(linkNode);

					var isolateScope;
					if (newIsolateScopeDirective) {
						isolateScope = scope.$new(true);
						$element.addClass('ng-isolate-scope');
						$element.data('$isolateScope', isolateScope);
					}

					// Register controller for each directive in node
					if (controllerDirectives) {
						_.forEach(controllerDirectives, function(directive) {
							var locals = {
								$scope: directive === newIsolateScopeDirective ? isolateScope : scope,
								$element: $element,
								$attrs: attrs
							};
							var controllerName = directive.controller;
							if (controllerName === '@') {
								controllerName = attrs[directive.name];
							}
							controllers[directive.name] =
								$controller(controllerName, locals, true, directive.controllerAs);
						});
					}

					if (newIsolateScopeDirective) {
						_.forEach(newIsolateScopeDirective.$$isolateBindings, function(definition, scopeName) {
							var attrName = definition.attrName;
							switch (definition.mode) {
								case '@':
									attrs.$observe(attrName, function(newAttrValue) {
										isolateScope[scopeName] = newAttrValue;
									});
									if (attrs[attrName]) {
										isolateScope[scopeName] = attrs[attrName];
									}
									break;
								case '<':
									if (definition.optional && !attrs[attrName]) {
										break;
									}
									var parentGet = $parse(attrs[attrName]);
									isolateScope[scopeName] = parentGet(scope);
									var unwatch = scope.$watch(parentGet, function(newValue) {
										isolateScope[scopeName] = newValue;
									});
									isolateScope.$on('$destroy', unwatch);
									break;
								case '=':
									if (definition.optional && !attrs[attrName]) {
										break;
									}
									parentGet = $parse(attrs[attrName]);
									var lastValue = isolateScope[scopeName] = parentGet(scope);

									var parentValueWatch = function() {
										var parentValue = parentGet(scope);
										if (isolateScope[scopeName] !== parentValue) {
											if (parentValue !== lastValue) {
												isolateScope[scopeName] = parentValue;
											} else {
												parentValue = isolateScope[scopeName];
												parentGet.assign(scope, parentValue);
											}
										}
										lastValue = parentValue;
										return lastValue;
									};
									if (definition.collection) {
										unwatch = scope.$watchCollection(attrs[attrName], parentValueWatch);
									} else {
										unwatch = scope.$watch(parentValueWatch);
									}
									break;
								case '&':
									var parentExpr = $parse(attrs[attrName]);
									if (parentExpr === _.noop && definition.optional) {
										break;
									}
									isolateScope[scopeName] = function(locals) {
										return parentExpr(scope, locals);
									};
									break;
							}
						});
					}

					_.forEach(controllers, function(controller) {
						controller();
					});

					_.forEach(preLinkFns, function(linkFn) {
						linkFn(linkFn.isolateScope ? isolateScope : scope, $element, attrs);
					});
					if (childLinkFn) {
						childLinkFn(scope, linkNode.childNodes);
					}
					_.forEachRight(postLinkFns, function(linkFn) {
						linkFn(linkFn.isolateScope ? isolateScope : scope, $element, attrs);
					});
				}
				nodeLinkFn.terminal = terminal;
				nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope;
				return nodeLinkFn;
			}


			return compile;
		}
	];
}

$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;