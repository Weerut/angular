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

// Parse isolate scope object to format which explicitly contain
// 'mode', 'colloetion', 'optional' and 'attrName' property.
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

function parseDirectiveBindings(directive) {
	var bindings = {};
	if (_.isObject(directive.scope)) {
		if (directive.bindToController) {
			bindings.bindToController = parseIsolateBindings(directive.scope);
		} else {
			bindings.isolateScope = parseIsolateBindings(directive.scope);
		}
	}
	if (_.isObject(directive.bindToController)) {
		bindings.bindToController = parseIsolateBindings(directive.bindToController);
	}

	return bindings;
}

var REQUIRE_PREFIX_REGEXP = /^(\^\^?)?(\?)?(\^\^?)?/;

function getDirectiveRequire(directive, name) {
	var require = directive.require || (directive.controller && name);
	if (!_.isArray(require) && _.isObject(require)) {
		_.forEach(require, function(value, key) {
			var prefix = value.match(REQUIRE_PREFIX_REGEXP);
			var name = value.substring(prefix[0].length);
			if (!name) {
				require[key] = prefix[0] + key;
			}
		});
	}
	return require;
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
						directive.name = directive.name || name;
						directive.require = getDirectiveRequire(directive, name);
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

	this.$get = ['$injector', '$parse', '$controller', '$rootScope', '$http', '$interpolate',
		function($injector, $parse, $controller, $rootScope, $http, $interpolate) {

			var startSymbol = $interpolate.startSymbol();
			var endSymbol = $interpolate.endSymbol();
			var denormalizeTemplate = (startSymbol === '{{' && endSymbol === '}}') ?
				_.identity :
				function(template) {
					return template.replace(/\{\{/g, startSymbol).replace(/\}\}/g, endSymbol);
				};
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
					if (!self.$$observers[key].$$inter) {
						fn(self[key]);
					}
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
			function collectDirectives(node, attrs, maxPriority) {
				var directives = [];
				var match;
				if (node.nodeType === Node.ELEMENT_NODE) {
					/*-----------------------------------------*/
					/*  Collecting directive which is ELEMENT  */
					// get camel case name.
					var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
					// use get camelCase name check with directive list to get directives.
					addDirective(directives, normalizedNodeName, 'E', maxPriority);
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
							addAttrInterpolateDirective(directives, attr.value, normalizedAttrName);
							addDirective(directives, normalizedAttrName, 'A', maxPriority,
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
						if (addDirective(directives, normalizedClassName, 'C', maxPriority)) {
							attrs[normalizedClassName] = undefined;
						}
					});
					var className = node.className;
					if (_.isString(className) && !_.isEmpty(className)) {}
					while ((match = /([\d\w\-_]+)(?:\:([^;]+))?;?/.exec(className))) {
						var normalizedClassName = directiveNormalize(match[1]);
						if (addDirective(directives, normalizedClassName, 'C', maxPriority)) {
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
						if (addDirective(directives, normalizedName, 'M', maxPriority)) {
							attrs[normalizedName] = match[2] ? match[2].trim() : undefined;
						}
					}
				} else
				/*-----------------------------------------*/
				/*  Collecting directive which is TEXT  */
				if (node.nodeType === Node.TEXT_NODE) {
					addTextInterpolateDirective(directives, node.nodeValue);
				}
				// Sort directive by its priority.
				directives.sort(byPriority);
				return directives;
			}

			// This function is to add text from node into directives object.
			function addTextInterpolateDirective(directives, text) {
				var interpolateFn = $interpolate(text, true);
				if (interpolateFn) {
					directives.push({
						priority: 0,
						compile: function() {
							return function link(scope, element) {
								var bindings = element.parent().data('$binding') || [];
								bindings = bindings.concat(interpolateFn.expressions);
								element.parent().data('$binding', bindings);
								element.parent().addClass('ng-binding');
								scope.$watch(interpolateFn, function(newValue) {
									element[0].nodeValue = newValue;
								});
							};
						}
					});
				}
			}

			function addAttrInterpolateDirective(directives, value, name) {
				var interpolateFn = $interpolate(value, true);
				if (interpolateFn) {
					directives.push({
						priority: 100,
						compile: function() {
							return {
								pre: function link(scope, element, attrs) {
									if (/^(on[a-z]+|formaction)$/.test(name)) {
										throw 'Interpolations for HTML DOM event attributes not allowed';
									}
									var newValue = attrs[name];
									if (newValue !== value) {
										interpolateFn = newValue && $interpolate(newValue, true);
									}
									if (!interpolateFn) {
										return;
									}
									attrs.$$observers = attrs.$$observers || {};
									attrs.$$observers[name] = attrs.$$observers[name] || [];
									attrs.$$observers[name].$$inter = true;
									attrs[name] = interpolateFn(scope);
									scope.$watch(interpolateFn, function(newValue) {
										attrs.$set(name, newValue);
									});
								}
							};
						}
					});
				}
			}

			// add directive with :name and :mode into :directives 
			// If there is directive applicable at least one, return true.
			function addDirective(directives, name, mode, maxPriority, attrStartName, attrEndName) {
				var match;
				if (hasDirectives.hasOwnProperty(name)) {
					var foundDirectives = $injector.get(name + 'Directive');
					//当該Directive だけをApplicableDirectives として扱う。
					var applicableDirectives = _.filter(foundDirectives, function(dir) {
						return (maxPriority === undefined || maxPriority > dir.priority) && dir.restrict.indexOf(mode) !== -1;
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

			function compileTemplateUrl(directives, $compileNode, attrs, previousCompileContext) {
				var origAsyncDirective = directives.shift();
				var derivedSyncDirective = _.extend({}, origAsyncDirective, {
					templateUrl: null,
					transclude: null
				});
				var templateUrl = _.isFunction(origAsyncDirective.templateUrl) ?
					origAsyncDirective.templateUrl($compileNode, attrs) : origAsyncDirective.templateUrl;
				var afterTemplateNodeLinkFn, afterTemplateChildLinkFn;
				var linkQueue = [];
				$compileNode.empty();
				$http.get(templateUrl).success(function(template) {
					template = denormalizeTemplate(template);
					directives.unshift(derivedSyncDirective);
					$compileNode.html(template);
					afterTemplateNodeLinkFn = applyDirectivesToNode(directives, $compileNode, attrs, previousCompileContext);
					afterTemplateChildLinkFn = compileNodes($compileNode[0].childNodes);
					_.forEach(linkQueue, function(linkCall) {
						afterTemplateNodeLinkFn(afterTemplateChildLinkFn, linkCall.scope, linkCall.linkNode, linkCall.boundTranscludeFn);
					});
					linkQueue = null;
				});
				return function delayedNodeLinkFn(_ignoreChildLinkFn, scope, linkNode, boundTranscludeFn) {
					if (linkQueue) {
						linkQueue.push({
							scope: scope,
							linkNode: linkNode,
							boundTranscludeFn: boundTranscludeFn
						});
					} else {
						afterTemplateNodeLinkFn(afterTemplateChildLinkFn, scope, linkNode, boundTranscludeFn);
					}
				};
			}

			/*------------------------------------------------------*/
			/*                                                      */
			/* Class chain for Compiling to execute complie service */
			/*                                                      */
			/*------------------------------------------------------*/

			// MAIN method to make compilation.
			function compile($compileNodes, maxPriority) {
				var compositeLinkFn = compileNodes($compileNodes, maxPriority);

				//*Return function*/
				// This function will run chain of link function.
				function publicLinkFn(scope, cloneAttachFn, options) {
					options = options || {};
					var parentBoundTranscludeFn = options.parentBoundTranscludeFn;
					var transcludeControllers = options.transcludeControllers;
					if (parentBoundTranscludeFn && parentBoundTranscludeFn.$$boundTransclude) {
						parentBoundTranscludeFn = parentBoundTranscludeFn.$$boundTransclude;
					}
					var $linkNodes;
					if (cloneAttachFn) {
						$linkNodes = $compileNodes.clone();
						cloneAttachFn($linkNodes, scope);
					} else {
						$linkNodes = $compileNodes;
					}
					_.forEach(transcludeControllers, function(controller, name) {
						$linkNodes.data('$' + name + 'Controller', controller.instance);
					});
					$linkNodes.data('$scope', scope);
					compositeLinkFn(scope, $linkNodes, parentBoundTranscludeFn);
					return $linkNodes;
				}
				return publicLinkFn;
			}

			// Actual compile process
			function compileNodes($compileNodes, maxPriority) {
				// Array to keep link function which is result of compiling node.
				var linkFns = [];
				// in case there are more than 1 topmost level node 
				_.times($compileNodes.length, function(i) {
					// Prepare object of attributes each node.
					var attrs = new Attributes($($compileNodes[i]));
					// Get directive of that node from registered directives in inject.
					var directives = collectDirectives($compileNodes[i], attrs, maxPriority);
					// Link function of each node.
					var nodeLinkFn;
					if (directives.length) {
						// Apply directive to node
						nodeLinkFn = applyDirectivesToNode(directives, $compileNodes[i], attrs);
					}
					var childLinkFn;
					if ((!nodeLinkFn || !nodeLinkFn.terminal) &&
						$compileNodes[i].childNodes && $compileNodes[i].childNodes.length) {
						// Apply same function to ChildNode in recursive fashion.
						childLinkFn = compileNodes($compileNodes[i].childNodes);
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
				function compositeLinkFn(scope, linkNodes, parentBoundTranscludeFn) {
					var stableNodeList = [];
					// To keep copy of element with correct index here.
					_.forEach(linkFns, function(linkFn) {
						var nodeIdx = linkFn.idx;
						stableNodeList[nodeIdx] = linkNodes[nodeIdx];
					});
					// To invoke nodeLinkFn and its childLinkFn.
					// If new scope specified, then create new scope for the node.
					_.forEach(linkFns, function(linkFn) {
						var node = stableNodeList[linkFn.idx];
						if (linkFn.nodeLinkFn) {
							var childScope; // child scope of each node.
							// to be new scope
							if (linkFn.nodeLinkFn.scope) {
								childScope = scope.$new();
								$(node).data('$scope', childScope);
							} else { // or the parent scope.
								childScope = scope;
							}

							// Check if there is directive which contain 
							// transclude inside each specific node.
							// If yes, wrap transclude function to use scope appear here.
							var boundTranscludeFn;
							if (linkFn.nodeLinkFn.transcludeOnThisElement) {
								boundTranscludeFn = function(transcludedScope, cloneAttachFn, transcludeControllers, containingScope) {
									if (!transcludedScope) {
										transcludedScope = scope.$new(false, containingScope);
									}
									return linkFn.nodeLinkFn.transclude(transcludedScope, cloneAttachFn, {
										transcludeControllers: transcludeControllers
									});
								};
							} else if (parentBoundTranscludeFn) {
								boundTranscludeFn = parentBoundTranscludeFn;
							}
							linkFn.nodeLinkFn(linkFn.childLinkFn, childScope, node, boundTranscludeFn);
						} else {
							linkFn.childLinkFn(scope, node.childNodes, parentBoundTranscludeFn);
						}
					});
				}
				return compositeLinkFn;
			}



			function applyDirectivesToNode(directives, compileNode, attrs, previousCompileContext) {
				previousCompileContext = previousCompileContext || {};
				var $compileNode = $(compileNode);
				var terminalPriority = -Number.MAX_VALUE;
				var terminal = false;
				var preLinkFns = previousCompileContext.preLinkFns || [];
				var postLinkFns = previousCompileContext.postLinkFns || [];
				var controllers = {};
				var newScopeDirective;
				var newIsolateScopeDirective = previousCompileContext.newIsolateScopeDirective;
				var templateDirective = previousCompileContext.templateDirective;
				var controllerDirectives = previousCompileContext.controllerDirectives;
				var childTranscludeFn; // This function behave like link function. 
				//So when eval it, it will return $element.
				var hasTranscludeDirective = previousCompileContext.hasTranscludeDirective;
				var hasElementTranscludeDirective;

				function addLinkFns(preLinkFn, postLinkFn, attrStart,
					attrEnd, isolateScope, require) {
					if (preLinkFn) {
						// If multi-element subtitue l[inkFn with multi-element linkFns by 
						// groupElementsLinkFnWrapper.
						if (attrStart) {
							preLinkFn =
								groupElementsLinkFnWrapper(preLinkFn, attrStart, attrEnd);
						}
						preLinkFn.isolateScope = isolateScope;
						preLinkFn.require = require;
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
						postLinkFn.require = require;
						postLinkFns.push(postLinkFn);
					}
				}
				// return function that wil execute :linkFn with group of element based on 
				// :attrStart and :attrEnd paramter provide here.
				function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
					return function(scope, element, attrs, ctrl, transclude) {
						var group = groupScan(element[0], attrStart, attrEnd);
						return linkFn(scope, group, attrs, ctrl, transclude);
					};
				}


				_.forEach(directives, function(directive, i) {
					if (directive.$$start) {
						$compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
					}
					if (directive.priority < terminalPriority) {
						return false;
					}
					if (directive.scope && !directive.templateUrl) {
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
					if (directive.controller) {
						controllerDirectives = controllerDirectives || {};
						controllerDirectives[directive.name] = directive;
					}
					if (directive.transclude) {
						if (hasTranscludeDirective) {
							throw 'Multiple directives asking for transclude';
						}
						hasTranscludeDirective = true;
						if (directive.transclude === 'element') {
							hasElementTranscludeDirective = true;
							var $originalCompileNode = $compileNode;
							$compileNode = attrs.$$element =
								$(document.createComment(
									' ' + directive.name + ': ' + attrs[directive.name] + ' '
								));
							$originalCompileNode.replaceWith($compileNode);
							terminalPriority = directive.priority;
							childTranscludeFn = compile($originalCompileNode, terminalPriority);
						} else {
							var $transcludedNodes = $compileNode.clone().contents();
							childTranscludeFn = compile($transcludedNodes);
							$compileNode.empty();
						}
					}
					if (directive.template) {
						if (templateDirective) {
							throw 'Multiple directives asking for template';
						}
						templateDirective = directive;
						var template = _.isFunction(directive.template) ?
							directive.template($compileNode, attrs) :
							directive.template;
						template = denormalizeTemplate(template);
						$compileNode.html(template);
					}
					if (directive.templateUrl) {
						if (templateDirective) {
							throw 'Multiple directives asking for template';
						}
						templateDirective = directive;
						nodeLinkFn = compileTemplateUrl(
							_.drop(directives, i), $compileNode, attrs, {
								templateDirective: templateDirective,
								newIsolateScopeDirective: newIsolateScopeDirective,
								controllerDirectives: controllerDirectives,
								hasTranscludeDirective: hasTranscludeDirective,
								preLinkFns: preLinkFns,
								postLinkFns: postLinkFns
							});
						return false;
					} else if (directive.compile) {
						var linkFn = directive.compile($compileNode, attrs);
						var isolateScope = (directive === newIsolateScopeDirective);
						var attrStart = directive.$$start;
						var attrEnd = directive.$$end;
						var require = directive.require;
						if (_.isFunction(linkFn)) {
							addLinkFns(null, linkFn, attrStart, attrEnd, isolateScope, require);
						} else if (linkFn) {
							addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd, isolateScope, require);
						}
					}
					if (directive.terminal) {
						terminal = true;
						terminalPriority = directive.priority;
					}

				});

				/*------------------------------*/
				/*  Return groups of function . */
				/*------------------------------*/
				// This function will do binding.
				function initializeDirectiveBindings(scope, attrs, destination, bindings, newScope) {
					_.forEach(bindings, function(definition, scopeName) {
						var attrName = definition.attrName;
						var parentGet, unwatch;
						switch (definition.mode) {
							case '@':
								attrs.$observe(attrName, function(newAttrValue) {
									destination[scopeName] = newAttrValue;
								});
								if (attrs[attrName]) {
									destination[scopeName] = $interpolate(attrs[attrName])(scope);
								}
								break;
							case '<':
								if (definition.optional && !attrs[attrName]) {
									break;
								}
								parentGet = $parse(attrs[attrName]);
								destination[scopeName] = parentGet(scope);
								unwatch = scope.$watch(parentGet, function(newValue) {
									destination[scopeName] = newValue;
								});
								newScope.$on('$destroy', unwatch);
								break;
							case '=':
								if (definition.optional && !attrs[attrName]) {
									break;
								}
								parentGet = $parse(attrs[attrName]);
								var lastValue = destination[scopeName] = parentGet(scope);
								var parentValueWatch = function() {
									var parentValue = parentGet(scope);
									if (destination[scopeName] !== parentValue) {
										if (parentValue !== lastValue) {
											destination[scopeName] = parentValue;
										} else {
											parentValue = destination[scopeName];
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
								newScope.$on('$destroy', unwatch);
								break;
							case '&':
								var parentExpr = $parse(attrs[attrName]);
								if (parentExpr === _.noop && definition.optional) {
									break;
								}
								destination[scopeName] = function(locals) {
									return parentExpr(scope, locals);
								};
								break;
						}
					});
				}
				// 
				function getControllers(require, $element) {
					if (_.isArray(require)) {
						return _.map(require, function(r) {
							return getControllers(r, $element);
						});
					} else if (_.isObject(require)) {
						return _.mapValues(require, function(r) {
							return getControllers(r, $element);
						});
					} else {
						var value;
						var match = require.match(REQUIRE_PREFIX_REGEXP);
						var optional = match[2];
						require = require.substring(match[0].length);
						if (match[1] || match[3]) {
							if (match[3] && !match[1]) {
								match[1] = match[3];
							}
							if (match[1] === '^^') {
								$element = $element.parent();
							}
							while ($element.length) {
								value = $element.data('$' + require + 'Controller');
								if (value) {
									break;
								} else {
									$element = $element.parent();
								}
							}
						} else {
							if (controllers[require]) {
								value = controllers[require].instance;
							}
						}
						if (!value && !optional) {
							throw 'Controller ' + require + ' required by directive, cannot be found!';
						}
						return value || null;
					}
				}

				// This method will run link function for each node.
				function nodeLinkFn(childLinkFn, scope, linkNode, boundTranscludeFn) {
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
								$transclude: scopeBoundTranscludeFn,
								$attrs: attrs
							};
							var controllerName = directive.controller;
							if (controllerName === '@') {
								controllerName = attrs[directive.name];
							}
							var controller =
								$controller(controllerName, locals, true, directive.controllerAs);
							controllers[directive.name] = controller;
							$element.data('$' + directive.name + 'Controller', controller.instance);
						});
					}

					if (newIsolateScopeDirective) {
						initializeDirectiveBindings(
							scope,
							attrs,
							isolateScope,
							newIsolateScopeDirective.$$bindings.isolateScope,
							isolateScope);
					}

					var scopeDirective = newIsolateScopeDirective || newScopeDirective;
					if (scopeDirective && controllers[scopeDirective.name]) {
						initializeDirectiveBindings(
							scope,
							attrs,
							controllers[scopeDirective.name].instance,
							scopeDirective.$$bindings.bindToController,
							isolateScope);
					}

					_.forEach(controllers, function(controller) {
						controller();
					});

					_.forEach(controllerDirectives, function(controllerDirective, name) {
						var require = controllerDirective.require;
						if (_.isObject(require) && !_.isArray(require) && controllerDirective.bindToController) {
							var controller = controllers[controllerDirective.name].instance;
							var requiredControllers = getControllers(require, $element);
							_.assign(controller, requiredControllers);
						}
					});

					function scopeBoundTranscludeFn(transcludedScope, cloneAttachFn) {
						var transcludeControllers;
						if (!transcludedScope || !transcludedScope.$watch || !transcludedScope.$evalAsync) {
							cloneAttachFn = transcludedScope;
							transcludedScope = undefined;
						}
						if (hasElementTranscludeDirective) {
							transcludeControllers = controllers;
						}
						return boundTranscludeFn(
							transcludedScope, cloneAttachFn, transcludeControllers, scope);
					}
					scopeBoundTranscludeFn.$$boundTransclude = boundTranscludeFn;

					_.forEach(preLinkFns, function(linkFn) {
						linkFn(
							linkFn.isolateScope ? isolateScope : scope,
							$element,
							attrs,
							linkFn.require && getControllers(linkFn.require, $element),
							scopeBoundTranscludeFn
						);
					});
					if (childLinkFn) {
						var scopeToChild = scope;
						if (newIsolateScopeDirective &&
							(newIsolateScopeDirective.template ||
								newIsolateScopeDirective.templateUrl === null)) {
							scopeToChild = isolateScope;
						}
						childLinkFn(scopeToChild, linkNode.childNodes, boundTranscludeFn);
					}
					_.forEachRight(postLinkFns, function(linkFn) {
						linkFn(
							linkFn.isolateScope ? isolateScope : scope,
							$element,
							attrs,
							linkFn.require && getControllers(linkFn.require, $element),
							scopeBoundTranscludeFn
						);
					});
				}
				nodeLinkFn.terminal = terminal;
				nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope;
				nodeLinkFn.transcludeOnThisElement = hasTranscludeDirective;
				nodeLinkFn.transclude = childTranscludeFn;
				return nodeLinkFn;
			}


			return compile;
		}
	];
}

$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;