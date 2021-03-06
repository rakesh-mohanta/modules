// MIT License
// Copyright Peter Širka <petersirka@gmail.com>
// Version 1.01

var fs = require('fs');
var events = require('events');
var COOKIE = '__po';
var REG_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows.?Phone/i;
var REG_ROBOT = /bot|crawler/i;

// http://freegeoip.net/json/77.247.227.34

function Online() {
	this.stats = { day: 0, month: 0, year: 0, hits: 0, unique: 0, count: 0, search: 0, direct: 0, social: 0, unknown: 0, advert: 0, mobile: 0, desktop: 0 };
	this.online = 0;
	this.arr = [0, 0];
	this.interval = 0;
	this.current = 0;
	this.last = 0;
	this.lastvisit = null;

	this.social = ['plus.url.google', 'plus.google', 'twitter', 'facebook', 'linkedin', 'tumblr', 'flickr', 'instagram'];
	this.search = ['google', 'bing', 'yahoo'];
	this.ip = [];
	this.url = [];

	this.allowXHR = true;
	this.allowIP = false;

	this.onValid = null;

	this._onValid = function(req) {

		var self = this;
		var agent = req.headers['user-agent'] || '';

		if (agent.length === 0)
			return false;

		if (req.headers['x-moz'] === 'prefetch')
			return false;

		if (self.onValid !== null && !self.onValid(req))
			return false;

		return agent.match(REG_ROBOT) === null;
	};

	this.isAdvert = function(req) {
		return (req.data.get['utm_medium'] || '').length > 0 || (req.data.get['utm_source'] || '').length > 0;
	};

	this.load();

	// every 30 seconds
	setInterval(this.clean.bind(this), 1000 * 30);
}

Online.prototype = {
	get online() {
		var arr = this.arr;
		return arr[0] + arr[1];
	},
	get today() {
		var stats = utils.copy({ hits: 0, unique: 0, count: 0, search: 0, direct: 0, social: 0, advert: 0, unknown: 0, mobile: 0, desktop: 0 }, this.stats);
		stats.last = this.lastvisit;
		return stats;
	}
};

Online.prototype.__proto__ = new events.EventEmitter();

Online.prototype.clean = function() {

	var self = this;

	self.interval++;

	if (self.interval % 2 === 0)
		self.save();

	var now = new Date();
	var stats = self.stats;

	self.current = now.getTime();

	var day = now.getDate();
	var month = now.getMonth() + 1;
	var year = now.getFullYear();
	var length = 0;

	if (stats.day !== day || stats.month !== month || stats.year !== year) {

		if (stats.day !== 0 || stats.month !== 0 || stats.year !== 0) {
			self.append();

			var keys = Object.keys(stats);
			length = keys.length;

			for (var i = 0; i < length; i++)
				stats[keys[i]] = 0;
		}

		stats.day = day;
		stats.month = month;
		stats.year = year;
		self.save();
	}

	var arr = self.arr;

	var tmp1 = arr[1];
	var tmp0 = arr[0];

	arr[1] = 0;
	arr[0] = tmp1;

	if (tmp0 !== arr[0] || tmp1 !== arr[1]) {
		var online = arr[0] + arr[1];
		if (online != self.last) {

			if (self.allowIP)
				self.ip = self.ip.slice(tmp0);

			self.emit('change', online, self.ip);
			self.last = online;
		}
	}

	framework.helpers.online = self.online;
	return self;
};

Online.prototype.add = function(req, res) {

	var self = this;

	if (!self._onValid(req))
		return false;

	if (req.xhr && !self.allowXHR)
		return false;

	if (req.method !== 'GET')
		return false;

	if ((req.headers['accept'] || '').length === 0 || (req.headers['accept-language'] || '').length === 0)
		return false;

	var arr = self.arr;
	var user = req.cookie(COOKIE).parseInt();
	var now = new Date();
	var ticks = now.getTime();
	var sum = user === 0 ? 1000 : (ticks - user) / 1000;
	var exists = sum < 31;
	var stats = self.stats;
	var referer = req.headers['referer'] || '';

	stats.hits++;

	self.refreshURL(referer, req);

 	if (exists)
		return true;

	var isUnique = false;

	if (user > 0) {

		sum = Math.abs(self.current - user) / 1000;
		if (sum < 41)
			return true;

		var date = new Date(user);
		if (date.getDate() !== now.getDate() || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear())
			isUnique = true;

	} else
		isUnique = true;

	if (isUnique) {
		stats.unique++;
		var agent = req.headers['user-agent'] || '';
		if (agent.match(REG_MOBILE) === null)
			stats.desktop++;
		else
			stats.mobile++;
	}

	arr[1]++;
	self.lastvisit = new Date();
	res.cookie(COOKIE, ticks, now.add('d', 5));

	if (self.allowIP)
		self.ip.push({ ip: req.ip, url: req.uri.href });

	var online = self.online;

	self.emit('online', req);

	if (self.last !== online) {
		self.last = online;
		self.emit('change', online, self.ip);
	}

	stats.count++;

	framework.helpers.online = online;

	if (self.isAdvert(req)) {
		stats.advert++;
		return true;
	}

	referer = getReferer(referer);

	if (referer === null) {
		stats.direct++;
		return true;
	}

	var length = self.social.length;

	for (var i = 0; i < length; i++) {
		if (referer.indexOf(self.social[i]) !== -1) {
			stats.social++;
			return true;
		}
	}

	var length = self.search.length;

	for (var i = 0; i < length; i++) {
		if (referer.indexOf(self.search[i]) !== -1) {
			stats.search++;
			return true;
		}
	}

	stats.unknown++;
	return true;
};

Online.prototype.save = function() {
	var self = this;

	framework._verify_directory('databases');

	var filename = framework.path.databases('online.cache');
	fs.writeFile(filename, JSON.stringify(self.stats), utils.noop);
	return self;
};

Online.prototype.load = function() {
	var self = this;

	framework._verify_directory('databases');

	var filename = framework.path.databases('online.cache');
	fs.readFile(filename, function(err, data) {

		if (err)
			return;

		try
		{
			self.stats = utils.copy(self.stats, JSON.parse(data.toString('utf8')));
		} catch (ex) {}

	});
	return self;
};

Online.prototype.append = function() {
	var self = this;
	framework._verify_directory('databases');

	var filename = framework.path.databases('online.txt');
	fs.appendFile(filename, JSON.stringify(self.stats) + '\n', utils.noop);
	return self;
};

Online.prototype.daily = function(callback) {
	var self = this;
	self.statistics(function(arr) {

		var length = arr.length;
		var output = [];

		for (var i = 0; i < length; i++) {

			var value = arr[i] || '';

			if (value.length === 0)
				continue;

			try
			{
				output.push(JSON.parse(value));
			} catch (ex) {}
		}

		callback(output);
	});

	return self;
};

Online.prototype.monthly = function(callback) {

	var self = this;
	self.statistics(function(arr) {

		var length = arr.length;
		var stats = {};

		for (var i = 0; i < length; i++) {

			var value = arr[i] || '';

			if (value.length === 0)
				continue;

			try
			{
				var current = JSON.parse(value);
				var key = current.month + '-' + current.year;

				if (!stats[key]) {
					stats[key] = current;
					delete stats[key].day;
					delete stats[key].month;
					delete stats[key].year;
				} else {
					stats[key].hits += current.hits;
					stats[key].count += current.count;
					stats[key].search += current.search;
					stats[key].direct += current.direct;
					stats[key].social += current.social;
					stats[key].unknown += current.unknown;
					stats[key].unique += current.unique;
					stats[key].mobile += current.mobile;
					stats[key].desktop += current.desktop;
					stats[key].advert += current.advert;
				}
			} catch (ex) {}
		}

		callback(stats);
	});

	return self;
};

Online.prototype.yearly = function(callback) {

	var self = this;
	self.statistics(function(arr) {

		var stats = {};
		var length = arr.length;

		for (var i = 0; i < length; i++) {

			var value = arr[i] || '';

			if (value.length === 0)
				continue;

			try
			{
				var current = JSON.parse(value);
				var key = current.year.toString();

				if (!stats[key]) {
					stats[key] = current;
					delete stats[key].day;
					delete stats[key].month;
					delete stats[key].year;
				} else {
					stats[key].hits += current.hits;
					stats[key].count += current.count;
					stats[key].search += current.search;
					stats[key].direct += current.direct;
					stats[key].social += current.social;
					stats[key].unknown += current.unknown;
					stats[key].unique += current.unique;
					stats[key].mobile += current.mobile;
					stats[key].desktop += current.desktop;
					stats[key].advert += current.advert;
				}
			} catch (ex) {}
		}

		callback(stats);
	});

	return self;
};

Online.prototype.statistics = function(callback) {

	var self = this;
	var filename = framework.path.databases('online.txt');

	framework._verify_directory('databases');

	var stream = fs.createReadStream(filename);
	var data = '';
	var stats = {};

	stream.on('error', function() {
		callback([]);
	});

	stream.on('data', function(chunk) {
		data += chunk.toString();
	});

	stream.on('end', function() {
		callback(data.split('\n'));
	});

	stream.resume();

	return self;
};

Online.prototype.refreshURL = function(referer, req) {

	var self = this;

	if (referer.length === 0)
		return;

	if (!self.allowIP)
		return;

	var length = self.ip.length;

	for (var i = 0; i < length; i++) {
		var item = self.ip[i];
		if (item.ip === req.ip && item.url === referer) {
			item.url = req.uri.href;
			return;
		}
	}
}

function getReferer(host) {

	if (host.length === 0)
		return null;

	var index = host.indexOf('/') + 2;
	host = host.substring(index, host.indexOf('/', index));

	return host;
}

var online = new Online();

framework.on('controller', function(controller, name) {
	online.add(controller.req, controller.res);
});

framework.helpers.online = 0;

module.exports = online;

module.exports.usage = function() {
	var builder = [];
	builder.push('Online              : ' + online.online);
	builder.push('Last visit          : ' + (online.lastvisit ? online.lastvisit.format('yyyy-MM-dd HH:mm:ss') : '...'));
	builder.push('Hits                : ' + online.stats.hits);
	builder.push('Unique              : ' + online.stats.unique);
	builder.push('Count               : ' + online.stats.count);
	builder.push('Pages per visit     : ' + (online.stats.hits > 0 && online.stats.count > 0 ? (online.stats.hits / online.stats.count).floor(2) : 0));
	builder.push('');
	builder.push('Acquisition:');
	builder.push('');
	builder.push('Search              : ' + online.stats.search);
	builder.push('Direct              : ' + online.stats.direct);
	builder.push('Social              : ' + online.stats.social);
	builder.push('Unknown             : ' + online.stats.unknown);
	builder.push('Advert              : ' + online.stats.advert);
	builder.push('');
	builder.push('Devices:');
	builder.push('');
	builder.push('Mobile              : ' + online.stats.mobile);
	builder.push('Desktop             : ' + online.stats.desktop);
	return builder.join('\n');
};