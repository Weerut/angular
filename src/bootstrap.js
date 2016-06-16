'use strict';

var $ = require('jquery');
var _ = require('lodash');

var publishExternalAPI = require('./angular_public');

publishExternalAPI();
var createInjector = require('./injector');

window.angular.bootstrap = function(element, modules, config) {
	var $element = $(element);
	modules = modules || [];
	config = config || {};
	modules.unshift(['$provide', function($provide) {
		$provide.value('$rootElement', $element);
	}]);
	modules.unshift('ng');
	var injector = createInjector(modules, config.strictDi);
	injector.invoke(['$compile', '$rootScope', function($compile, $rootScope) {
		$rootScope.$apply(function() {
			$compile($element)($rootScope);
		});
	}]);
	$element.data('$injector', injector);
	return injector;
};

var ngAttrPrefixes = ['ng-', 'data-ng-', 'ng:', 'x-ng-'];
$(document).ready(function() {
	var foundAppElement, foundModule, config = {};
	_.forEach(ngAttrPrefixes, function(prefix) {
		var attrName = prefix + 'app';
		var selector = '[' + attrName.replace(':', '\\:') + ']';
		var element;
		if (!foundAppElement && (element = document.querySelector(selector))) {
			foundAppElement = element;
			foundModule = element.getAttribute(attrName);
		}
	});
	if (foundAppElement) {
		config.strictDi = _.some(ngAttrPrefixes, function(prefix) {
			var attrName = prefix + 'strict-di';
			return foundAppElement.hasAttribute(attrName);
		});
		window.angular.bootstrap(
			foundAppElement,
			foundModule ? [foundModule] : [],
			config
		);
	}
});