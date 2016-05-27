'use strict';

function hashKey(value) {
	var type = typeof value;

	var uid;
	if (type === 'function' || (type === 'object' && value !== null)) {
		uid = value.$$hashKey;
		if (uid === undefined) {
			uid = value.$$hashKey = _.uniqueId();
		}
	} else {
		uid = value;
	}


	return type + ':' + uid;
}
module.exports = {
	hashKey: hashKey
};