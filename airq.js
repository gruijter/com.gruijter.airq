/*
Copyright 2021 - 2024, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.airq.

com.gruijter.airq is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.airq is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.airq. If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const http = require('http');

const CryptoJS = require('crypto-js');

// AirQ represents a session to a local AirQ device
class AirQ {

	constructor(opts) {
		this.host = opts.address;
		this.port = opts.port || 80;
		this.timeout = opts.timeout || 10000;
		this.lastResponse = undefined;
		this.password = opts.password;
		if (!this.password || this.password === '') this.password = 'airqsetup';
	}

	decrypt(msgb64) {
		try {
			const airqpass = this.password.padEnd(32, '0').substring(0, 32);
			const key = CryptoJS.enc.Utf8.parse(airqpass);
			const ciphertext = CryptoJS.enc.Base64.parse(msgb64);
			const iv = ciphertext.clone();
			iv.sigBytes = 16;
			iv.clamp();
			ciphertext.words.splice(0, 4); // delete 4 words = 16 bytes
			ciphertext.sigBytes -= 16;
			const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, { iv });
			const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
			return Promise.resolve(decryptedString);
		} catch (error) {
			return Promise.reject(Error('Decrypt failed. Wrong password?'));
		}
	}

	encrypt(msg) {
		const airqpass = this.password.padEnd(32, '0').substring(0, 32);
		const key = CryptoJS.enc.Utf8.parse(airqpass);
		const iv = CryptoJS.lib.WordArray.random(16);
		const encrypted = CryptoJS.AES.encrypt(msg, key, { iv });
		return iv.concat(encrypted.ciphertext).toString(CryptoJS.enc.Base64);
	}

	// {
	// 	standardpass: 'true',  // true or false as a string
	// 	version: '1',  // API version number
	// 	id: 'xxxxxxxxb33faa8exxxxxxxxxxxxxxxx'
	// }
	async getInfo() {
		try {
			const info = {};
			let path = '/standardpass';
			info.standardpass = await this._makeRequest(path, 'GET');
			path = '/version';
			info.version = JSON.parse(await this._makeRequest(path, 'GET'));
			path = '/ping';
			info.id = JSON.parse(await this._makeRequest(path, 'GET')).id;
			return Promise.resolve(info);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Returns a fast summary as JSON object
	async getConfig() {
		try {
			const path = '/config';
			const result = await this._makeRequest(path, 'GET');
			const json = JSON.parse(result);
			if (!json.content) throw Error('invalid response');
			const decrypted = await this.decrypt(json.content);
			return Promise.resolve(JSON.parse(decrypted));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Returns a fast summary as JSON object
	async ping() {
		try {
			const path = '/ping';
			const result = await this._makeRequest(path, 'GET');
			const json = JSON.parse(result);
			if (!json.content) throw Error('invalid response');
			const decrypted = await this.decrypt(json.content);
			return Promise.resolve(JSON.parse(decrypted));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Returns the most recently measured data as a JSON object
	async getData() {
		try {
			const path = '/data';
			const result = await this._makeRequest(path, 'GET');
			const json = JSON.parse(result);
			if (!json.content) throw Error('invalid response');
			const decrypted = await this.decrypt(json.content);
			return Promise.resolve(JSON.parse(decrypted));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// sets a configuration
	async config(msg) {
		try {
			const path = '/config';
			const msgEnc = this.encrypt(JSON.stringify(msg));
			const msgUri = `request=${encodeURI(msgEnc)}`;
			const result = await this._makeRequest(path, 'POST', msgUri);
			const json = JSON.parse(result);
			if (!json.content) throw Error('invalid response');
			const decrypted = await this.decrypt(json.content);
			// Success: new setting saved for key 'RoomType': office
			// Error: key 'RoomArea' must be in format of 'float', but received was 'int'
			// Success: new setting saved for key 'RoomHeight': 2.6
			return Promise.resolve(JSON.parse(decrypted));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Plays a sound
	async playsound(freq, vol, length) {
		try {
			const path = '/playsound';
			const msg = {
				sound: {
					freq: freq || 900,
					vol: vol || 100,
					length: length || 1000,
				},
			};
			const msgEnc = this.encrypt(JSON.stringify(msg));
			const msgUri = `request=${encodeURI(msgEnc)}`;
			const result = await this._makeRequest(path, 'POST', msgUri);
			const decrypted = await this.decrypt(result); // playback finished
			return Promise.resolve(decrypted);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Single blink
	async blink() {
		try {
			const path = '/blink';
			const result = await this._makeRequest(path, 'GET');
			return Promise.resolve(JSON.parse(result)); // { id: xxxxxxxxb33faa8exxxxxxxxxxxxxxxx }
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Reboot
	async reboot() {
		try {
			const path = '/config';
			const msg = { reset: true	};
			const msgEnc = this.encrypt(JSON.stringify(msg));
			const msgUri = `request=${encodeURI(msgEnc)}`;
			const result = await this._makeRequest(path, 'POST', msgUri);
			const json = JSON.parse(result);
			if (!json.content) throw Error('invalid response');
			const decrypted = await this.decrypt(json.content);
			// Reset command received: will reset device after all setting changes have been applied.
			return Promise.resolve(JSON.parse(decrypted));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	async _makeRequest(path, method, message) {
		try {
			const postData = message || '';
			const headers = {
				'content-length': Buffer.byteLength(postData),
				'Content-Type': 'application/x-www-form-urlencoded',
			};
			const options = {
				hostname: this.host,
				port: this.port,
				path,
				headers,
				method,
			};
			const result = await this._makeHttpRequest(options, postData);
			if ((result.statusCode !== 200) || !result.body) throw Error(result.body || result.statusCode);
			// console.log(result.body);
			return Promise.resolve(result.body);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	_makeHttpRequest(options, postData, timeout) {
		return new Promise((resolve, reject) => {
			const opts = options;
			opts.timeout = timeout || this.timeout;
			const req = http.request(opts, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					this.lastResponse = resBody;
					if (!res.complete) {
						return reject(Error('The connection was terminated while the message was still being sent'));
					}
					res.body = resBody;
					return resolve(res);
				});
			});
			req.on('error', (e) => {
				req.destroy();
				this.lastResponse = e;
				return reject(e);
			});
			req.on('timeout', () => {
				req.destroy();
			});
			req.end(postData);
		});
	}

}

module.exports = AirQ;

/*
ping response:

{
	'air-Q-Hardware-Version': 'D',
	RoomType: 'living-room',
	'air-Q-Software-Version': '1.20.2.r4_D_1.76',
	health: 586,
	data: {
		tvoc: [ 347, 52.05 ],
		pm2_5: [ 10, 11 ],
		DeviceID: 'xxxxxxxxb33faa8exxxxxxxxxxxxxxxx',
		Status: 'OK',
		cnt0_3: [ 1560, 162 ],
		humidity: [ 72.743, 4.35 ],
		measuretime: 1957,
		sound: [ 52.6, 2.8 ],
		temperature: [ 19.022, 0.54 ],
		performance: 558.9036,
		cnt0_5: [ 456, 54 ],
		co: [ 1.372, 0.1 ],
		humidity_abs: [ 11.918, 0.56 ],
		uptime: 15953,
		cnt2_5: [ 0, 10 ],
		so2: [ 130.51, 139.7 ],
		co2: [ 775, 73.25 ],
		o3: [ 0.81, 29.7 ],
		cnt10: [ 0, 10 ],
		no2: [ -0.35, 43.5 ],
		cnt5: [ 0, 10 ],
		timestamp: 1633627766000,
		pressure: [ 1029.89, 1 ],
		TypPS: 1.15,
		cnt1: [ 41, 14 ],
		door_event: 0,
		pm1: [ 9, 11 ],
		oxygen: [ 20.304, 0.93 ],
		dewpt: [ 13.664, 0.8 ],
		pm10: [ 10, 11 ],
		health: 586,
		bat: [ 0, 0 ],
		dHdt: -0.12,
		dCO2dt: -17.82
	},
	sensors: [
		'co',           'co2',
		'no2',          'o3',
		'oxygen',       'particulates',
		'pressure',     'so2',
		'sound',        'temperature',
		'tvoc',         'humidity',
		'humidity_abs', 'dewpt'
	],
	performance: 558.9036,
	Industry: false,
	devicename: 'Air-Q'
}

data response fw 1.79-rc1:
{
  dCO2dt: 54.15,
  tvoc: [ 1083, 167.92 ],
  pm2_5: [ 0, 10 ],
  DeviceID: 'xxxxxxxxxxx',
  Status: 'OK',
  humidity: [ 50.863, 3.37 ],
  cnt0_3: [ 228, 32 ],
  measuretime: 1888,
  sound: [ 48.3, 3.3 ],
  temperature: [ 19.482, 0.5 ],
  cnt0_5: [ 66, 16 ],
  performance: 534.71,
  co: [ 1.657, 0.2 ],
  humidity_abs: [ 8.563, 0.47 ],
  co2: [ 797, 73.91 ],
  uptime: 5757,
  so2: [ 1615.6, 64 ],
  cnt2_5: [ 2, 10 ],
  o3: [ 19.14, 1.8 ],
  cnt10: [ 2, 10 ],
  no2: [ 16.76, 2.2 ],
  cnt5: [ 2, 10 ],
  timestamp: 1645355755000,
  pressure: [ 1005.06, 1 ],
  TypPS: 10,
  cnt1: [ 23, 12 ],
  sound_max: [ 59.8, 2.3 ],
  pm1: [ 0, 10 ],
  oxygen: [ 20.425, 1.39 ],
  door_event: 0,
  dewpt: [ 9.201, 0.83 ],
  pm10: [ 2, 10 ],
  health: 614,
  bat: [ 0, 0 ],
  dHdt: 0.12
}

config response:

{
	httpPOST: {
		URL: null,
		format: [],
		averages: true,
		delay: 120,
		Headers: { 'Content-Type': 'application/json' }
	},
	NightMode: {
		StartDay: '06:00',
		FanNightOff: false,
		AlarmNightOff: false,
		BrightnessDay: 6,
		StartNight: '21:00',
		WifiNightOff: false,
		BrightnessNight: 3
	},
	TimeServer: 'pool.ntp.org',
	logging: 'Error',
	WLANssid: [ 'ssid' ],
	WLANsignal: -65,
	WLANantenna: 'internal',
	IgnorePMFanError: false,
	daytime: true,
	ledTheme: { left: 'standard', right: 'standard' },
	SoundInfo: {},
	mqtt: {
		delay: 120,
		ssl_params: {},
		retain: false,
		format: [],
		device_id: null,
		user: null,
		averages: true,
		topic: 'Ihr_Topic',
		port: 1883,
		broker_URL: '192.168.x.y',
		password: null,
		ssl: false,
		keepalive: 10000
	},
	usercalib: {
		no2: { offset: 747.4366, timestamp: 1633561663 },
		o3: { offset: 516.0844, timestamp: 1633554406 }
	},
	'air-Q-Hardware-Version': 'D',
	'WLAN config': {
		Gateway: '192.168.0.1',
		MAC: 'aabbccddeeff',
		SSID: 'ssid',
		'IP address': '192.168.0.2',
		'Net Mask': '255.255.255.0',
		BSSID: 'bbccddeeffgg'
	},
	ActiveGasAlarm: false,
	AlarmForwarding: false,
	id: 'xxxxxxxxb33faa8exxxxxxxxxxxxxxxx',
	Sockets: {
		soc2: 'o3',
		soc3: 'so2',
		soc0: 'co',
		soc1: 'no2',
		aux1: null,
		aux2: null,
		soc4: null,
		aux3: null
	},
	SensorInfo: {
		pressure: {
			'Working Principle': 'Capacitive, with temperature compensation',
			'Part Number': '10000',
			Manufacturer: 'Infineon',
			'Calibration Date': 'Not recalibrated since manufacturer calibration',
			Offset: 0,
			'Temperature source': 'MEMS element',
			'Value Name': [Array],
			Description: 'Pressure sensor',
			calibcoef: [Object]
		},
		co: {
			'Manufacturing Date': '2020-11-06',
			'Temp Comp Devision Temp': 20,
			'Temp Comp Cube Upper': 0,
			Gain: 47000000,
			'Temp Comp Pow 5 Lower': 0,
			'Temp Comp Quad Lower': 0,
			'Calibration Date': '2021-07-16',
			'EEPROM Programming Date': '2021-06-10',
			'Temp Comp Lin Upper': 0.00746758,
			'Temp Comp Pow 5 Upper': 0,
			'Temp Comp Cube Lower': 0,
			'Value Name': 'co',
			'Temp Comp Pow 4 Lower': 0,
			'Temp Comp Pow 6 Lower': 0,
			'Warm-up Time': 1800,
			'Auto-Calibration Buffer': '1st: 29; 2nd: 3/140',
			'Gain Temperature Drift': 300,
			'Temp Comp Const Lower': 0.783421,
			'Sensitivity Error': 0,
			Type: 'TGS5141',
			'ppb to ug Factor': 1.15,
			'Gain Error Percent': 5,
			'Temp Comp Const Upper': 0.853903,
			'Molar Mass': 28.01,
			Sensitivity: 2,
			'Part Number': 'None',
			'Serial Number': '20101595963482xxxx',
			Description: 'CO Sensor',
			'EEPROM Table Version': 0,
			'Temp Comp Lin Lower': 0.0109592,
			'Temp Comp Quad Upper': 0,
			'Temp Comp Pow 4 Upper': 0,
			Manufacturer: 'Figaro',
			Offset: 0.9,
			'Usage Time': 2034847,
			'Working Principle': 'electrochemical',
			'Temp Comp Pow 6 Upper': 0
		},
		particulates: {
			'Software Version': 151,
			'Working Principle': 'Laser Scattering',
			Manufacturer: 'Plantower',
			Description: 'Particulates Sensor',
			Type: 'PMSA003',
			'Value Name': [Array],
			'Part Number': 'PMSA003',
			'Usage Time': 2034851,
			Status: 'Good'
		},
		co2: {
			'Software Version': 'V3.11_7B03',
			'Working Principle': 'Dual beam IR absorption',
			Manufacturer: 'CUBIC',
			Description: 'CO2 Sensor',
			Type: 'Dual Beam NDIR CO2 Sensor Module',
			'Value Name': 'co2',
			'Serial Number': '0000054210101041xxxx',
			'Part Number': 'CM1107',
			'Calibration Date': '2021-7-16',
			'Usage Time': 2034856
		},
		tvoc: {
			'Software Version': 34,
			'Working Principle': 'Multi-Pixel MOX',
			Manufacturer: 'Sensirion',
			Description: 'VOC Sensor',
			Type: 'SGP30',
			'Value Name': 'tvoc',
			'Serial Number': '001A4xxxx',
			'Part Number': 'SGP30',
			'Calibration Date': 'Not recalibrated since manufacturer calibration',
			'Warm-up Time': 240
		},
		temperature: {
			Offset: [Object],
			'Part Number': 'HDC1080',
			'Value Name': [Array],
			Description: 'Temperature and Humidity Sensor',
			Manufacturer: 'Texas Instruments',
			Type: '0x1050',
			'Serial Number': '032B29xxxx',
			'Calibration Date': '2021-7-16'
		},
		no2: {
			'EEPROM Programming Date': '2021-2-18',
			Description: 'NO2 Sensor',
			Gain: 47000000,
			'Molar Mass': 46.006,
			'Temp Comp Pow 4 Lower': 0,
			'Gain Error Percent': 5,
			'Bias mV': -200,
			Manufacturer: 'SPEC',
			'Temp Comp Pow 5 Lower': 0,
			'ppb to ug Factor': 1.88,
			'Temp Comp Lin Lower': 0,
			'Sensitivity Error': 0,
			'Temp Comp Quad Lower': 0,
			'Temp Comp Lin Upper': 0.291887,
			'Value Name': 'no2',
			'Temp Comp Const Upper': 91.79641,
			Sensitivity: -35.55,
			'Part Number': '110507',
			'Serial Number': '05082001xxxx',
			'Temp Comp Pow 6 Upper': 0,
			Offset: 40.06,
			'Temp Comp Quad Upper': 0.000660781,
			'Working Principle': 'electrochemical',
			'Usage Time': 2034941,
			'Auto-Calibration Buffer': '1st: 53; 2nd: 4/70',
			'Gain Temperature Drift': 300,
			'Temp Comp Const Lower': 0,
			'Temp Comp Pow 5 Upper': 0,
			'Temp Comp Cube Lower': 0,
			'Manufacturing Date': '2020-05',
			'Temp Comp Cube Upper': 0,
			'Calibration Date': '2021-7-16',
			Type: '3SP_NO2_5F-P',
			'Temp Comp Devision Temp': -273,
			'Temp Comp Pow 6 Lower': 0,
			'EEPROM Table Version': 1,
			'Temp Comp Pow 4 Upper': 0,
			'Warm-up Time': 3600,
			Socket: 'soc1'
		},
		sound: {
			'Serial Number': '27xxxx',
			'Calibration Date': '2021-09-29',
			'Working Principle': 'RMS microphone voltage converter',
			Offset: 245,
			Manufacturer: 'Corant GmbH',
			'Auto-Calibration Buffer': '0/640'
		},
		so2: {
			'EEPROM Programming Date': '2021-2-17',
			Description: 'SO2 Sensor',
			Gain: 47000000,
			'Molar Mass': 64.066,
			'Temp Comp Pow 4 Lower': 0,
			'Gain Error Percent': 5,
			'Bias mV': 200,
			Manufacturer: 'SPEC',
			'Temp Comp Pow 5 Lower': 0,
			'ppb to ug Factor': 2.62,
			'Temp Comp Lin Lower': 0,
			'Sensitivity Error': 0,
			'Temp Comp Quad Lower': 0,
			'Temp Comp Lin Upper': 1.13429,
			'Value Name': 'so2',
			'Temp Comp Const Upper': 76.7168,
			Sensitivity: 36.27,
			'Part Number': '110601',
			'Serial Number': '11251903xxxx',
			'Temp Comp Pow 6 Upper': 0,
			Offset: -2482.73,
			'Temp Comp Quad Upper': -0.00357758,
			'Working Principle': 'electrochemical',
			'Usage Time': 2034943,
			'Auto-Calibration Buffer': '1st: 53; 2nd: 4/70',
			'Gain Temperature Drift': 300,
			'Temp Comp Const Lower': 0,
			'Temp Comp Pow 5 Upper': 0,
			'Temp Comp Cube Lower': 0,
			'Manufacturing Date': '2019-12',
			'Temp Comp Cube Upper': -0.0000387379,
			'Calibration Date': '2021-7-16',
			Type: '3SP_SO2_20-P',
			'Temp Comp Devision Temp': -273,
			'Temp Comp Pow 6 Lower': 0,
			'EEPROM Table Version': 1,
			'Temp Comp Pow 4 Upper': -8.70728e-7,
			'Warm-up Time': 3600,
			Socket: 'soc3'
		},
		o3: {
			'EEPROM Programming Date': '2021-6-3',
			Description: 'O3 Sensor',
			Gain: 47000000,
			'Molar Mass': 47.997,
			'Temp Comp Pow 4 Lower': 0,
			'Gain Error Percent': 5,
			'Bias mV': -100,
			Manufacturer: 'SPEC',
			'Temp Comp Pow 5 Lower': 0,
			'ppb to ug Factor': 1.96,
			'Temp Comp Lin Lower': 0,
			'Sensitivity Error': 0,
			'Temp Comp Quad Lower': 0,
			'Temp Comp Lin Upper': 0.289421,
			'Value Name': 'o3',
			'Temp Comp Const Upper': 91.5952,
			Sensitivity: -55.22,
			'Part Number': '110406',
			'Serial Number': '01142101xxxx',
			'Temp Comp Pow 6 Upper': 0,
			Offset: 12.53,
			'Temp Comp Quad Upper': 0.000672192,
			'Working Principle': 'electrochemical',
			'Usage Time': 2034958,
			'Auto-Calibration Buffer': '1st: 53; 2nd: 4/70',
			'Gain Temperature Drift': 300,
			'Temp Comp Const Lower': 0,
			'Temp Comp Pow 5 Upper': 0,
			'Temp Comp Cube Lower': 0,
			'Manufacturing Date': '2021-01',
			'Temp Comp Cube Upper': 0,
			'Calibration Date': '2021-7-16',
			Type: '3SP_O3_20-P',
			'Temp Comp Devision Temp': -273,
			'Temp Comp Pow 6 Lower': 0,
			'EEPROM Table Version': 1,
			'Temp Comp Pow 4 Upper': 0,
			'Warm-up Time': 3600,
			Socket: 'soc2'
		},
		oxygen: {
			Description: 'Oxygen Sensor',
			'Manufacture Date': '2020-D00217',
			Offset: -0.09,
			'Software Revision': '00021',
			Manufacturer: 'SST Sensing',
			Type: 'LuminOx',
			Status: 'Good',
			'Serial Number': '00285 1xxxx',
			'Part Number': 'LOX-02',
			'Working Principle': 'UV luminescence',
			'Calibration Date': '2021-7-16',
			'Value Name': [Array],
			'Usage Time': 2034950,
			'Auto-Calibration Buffer': '1st: 29/60; 2nd: 20.95 % -> in 715.0 h'
		}
	},
	devicename: 'Air-Q',
	sensors: [
		'co',           'co2',
		'no2',          'o3',
		'oxygen',       'particulates',
		'pressure',     'so2',
		'sound',        'temperature',
		'tvoc',         'humidity',
		'humidity_abs', 'dewpt'
	],
	ActiveFireAlarm: false,
	RoomHeight: 2.4,
	SecondsMeasurementDelay: 120,
	Wifi: true,
	cloudUpload: false,
	HotspotChannel: 11,
	FireAlarm: false,
	Rejection: '50Hz',
	'air-Q-Software-Version': '1.20.2.r4_D_1.76',
	SN: 'xxxxxxx',
	'ppm&ppb': false,
	ErrorBars: true,
	type: 'airQ Science',
	GasAlarm: false,
	sameNetAirQs: {},
	Industry: false,
	geopos: { lat: 0, long: 0 },
	AdvancedDataProcessing: true,
	AutoDriftCompensation: true,
	InitialCalFinished: true,
	SensitivityEnvironmentCompensation: true,
	possibleLedTheme: [
		'standard',
		'co2_covid19',
		'CO2',
		'VOC',
		'CO',
		'PM1',
		'PM2.5',
		'PM10',
		'Noise',
		'Noise Average'
	],
	RoomType: 'living-room',
	WifiInfo: true,
	Averaging: 30,
	AutoUpdate: false,
	possibleRoomType: [
		'living-room', 'bedroom',
		'kitchen',     'bathroom',
		'office',      'workshop',
		'children',    'toilet',
		'hallway',     'cellar',
		'attic',       'outdoor',
		'garage',      'medical',
		'classroom',   'other'
	],
	RoomArea: 20
}

config response fw 1.79-rc1:
{
  IgnorePMFanError: false,
  Industry: false,
  AlarmForwarding: false,
  devicename: 'Air-Q',
  AdvancedDataProcessing: true,
  SN: '070471xxxx',
  NightMode: {
    StartDay: '06:00',
    FanNightOff: false,
    AlarmNightOff: false,
    BrightnessDay: 6,
    StartNight: '21:00',
    WifiNightOff: false,
    BrightnessNight: 3
  },
  AutoUpdate: false,
  geopos: { lat: 0, long: 0 },
  cloudUpload: false,
  ActiveGasAlarm: false,
  sensors: [
    'co',           'co2',
    'no2',          'o3',
    'oxygen',       'particulates',
    'pressure',     'so2',
    'sound',        'temperature',
    'tvoc',         'humidity',
    'humidity_abs', 'dewpt',
    'sound_max'
  ],
  daytime: true,
  WLANssid: [ 'TT11g' ],
  AutoDriftCompensation: true,
  possibleLedTheme: [
    'standard',
    'co2_covid19',
    'CO2',
    'VOC',
    'CO',
    'PM1',
    'PM2.5',
    'PM10',
    'Noise',
    'Noise Average'
  ],
  APIaccess: true,
  Averaging: 30,
  possibleRoomType: [
    'living-room', 'bedroom',
    'kitchen',     'bathroom',
    'office',      'workshop',
    'children',    'toilet',
    'hallway',     'cellar',
    'attic',       'outdoor',
    'garage',      'medical',
    'classroom',   'other'
  ],
  ActiveFireAlarm: false,
  ErrorBars: true,
  GasAlarm: true,
  'air-Q-Hardware-Version': 'D',
  SoundInfo: {},
  HotspotChannel: 11,
  WLANsignal: -55,
  WLANantenna: 'internal',
  'WLAN config': {
    'Net Mask': '255.255.255.0',
    Gateway: 'x.x.x.x',
    SSID: 'xxxx',
    'IP address': 'x.x.x.x',
    MAC: 'f008d1cdxxxx',
    BSSID: 'xxxxxxxxxxxx'
  },
  Sockets: {
    soc2: 'o3',
    soc3: 'so2',
    soc0: 'co',
    soc1: 'no2',
    aux1: null,
    aux2: null,
    soc4: null,
    aux3: null
  },
  sameNetAirQs: {},
  FireAlarm: true,
  Rejection: '50Hz',
  logging: 'Error',
  boots: '0/4/0/4/15',
  WifiInfo: true,
  ledTheme: { right: 'standard', left: 'standard', ledBrightness: 18.5 },
  id: '07047138b33faa8ecb90d377d68exxxx',
  'ppm&ppb': false,
  SecondsMeasurementDelay: 120,
  RoomArea: 40.01,
  type: 'airQ Science',
  Wifi: true,
  usercalib: {
    no2: { offset: 0, timestamp: 1634984496 },
    so2: { offset: 2874.219, timestamp: 1644377935 },
    temperature: { offset: 0.38, timestamp: 1633856753 },
    co2: { offset: -563, timestamp: 1633857566 },
    o3: { offset: 16.81, timestamp: 1639611891 },
    tvoc: { offset: -38677, timestamp: 1633857540 }
  },
  TimeServer: 'pool.ntp.org',
  'air-Q-Software-Version': '1.20.2.r6_D_1.79-rc1',
  SensorInfo: {
    pressure: {
      'Working Principle': 'Capacitive, with temperature compensation',
      'Part Number': '10000',
      Manufacturer: 'Infineon',
      'Calibration Date': 'Not recalibrated since manufacturer calibration',
      Offset: 0,
      'Temperature source': 'MEMS element',
      'Value Name': [Array],
      Description: 'Pressure sensor',
      calibcoef: [Object]
    },
    co: {
      'EEPROM Programming Date': '2021-06-10',
      Description: 'CO Sensor',
      Tcomp5u: 0,
      Gain: 47000000,
      Tcomp3l: 0,
      Tcomp0u: 0.854,
      'Molar Mass': 28.01,
      'Measurement Range': [Object],
      Tcomp4l: 0,
      Tcomp2u: 0,
      'Bias mV': 0,
      'ppb to ug Factor': 1.15,
      Manufacturer: 'Figaro',
      Tcomp6l: 0,
      'Sensitivity Error': 0,
      Tcomp1u: 0.007,
      'Value Name': 'co',
      Offset: 0.9,
      Sensitivity: 2,
      'Serial Number': '20101595963482xxxx',
      'Part Number': 'None',
      Tcomp3u: 0,
      TcompDevTemp: 20,
      GainTempDrift: 300,
      Tcomp5l: 0,
      Tcomp0l: 0.783,
      'Usage Time': 13606794,
      'Working Principle': 'electrochemical',
      'Auto-Calibration Buffer': [Array],
      Tcomp2l: 0,
      Type: 'TGS5141',
      GainErrPercent: 5,
      'Manufacturing Date': '2020-11-06',
      'Calibration Date': '2021-07-16',
      Tcomp4u: 0,
      Tcomp6u: 0,
      'EEPROM Table Version': 2,
      Tcomp1l: 0.011,
      'Warm-up Time': 1800,
      Socket: 'soc0'
    },
    particulates: {
      'Software Version': 151,
      'Working Principle': 'Laser Scattering',
      Running: true,
      Description: 'Particulates Sensor',
      Manufacturer: 'Plantower',
      'Value Name': [Array],
      Type: 'PMSA003',
      'Part Number': 'PMSA003',
      'Usage Time': 13606805,
      Status: 'Good'
    },
    co2: {
      'Software Version': 'V3.11_7B03',
      'Working Principle': 'Dual beam IR absorption',
      Manufacturer: 'CUBIC',
      Description: 'CO2 Sensor',
      Type: 'Dual Beam NDIR CO2 Sensor Module',
      'Value Name': 'co2',
      'Serial Number': '0000054210101041xxxx',
      'Part Number': 'CM1107',
      'Calibration Date': '2021-12-28',
      'Usage Time': 13606832
    },
    tvoc: {
      'Software Version': 34,
      'Working Principle': 'Multi-Pixel MOX',
      Manufacturer: 'Sensirion',
      Description: 'VOC Sensor',
      Type: 'SGP30',
      'Value Name': 'tvoc',
      'Serial Number': '001A4xxxx',
      'Part Number': 'SGP30',
      'Calibration Date': '2021-10-10',
      'Warm-up Time': 240
    },
    temperature: {
      Offset: [Object],
      'Part Number': 'HDC1080',
      'Value Name': [Array],
      Description: 'Temperature and Humidity Sensor',
      Manufacturer: 'Texas Instruments',
      Type: '0x1050',
      'Serial Number': '032B29xxxx',
      'Calibration Date': '2021-7-16'
    },
    no2: {
      'EEPROM Programming Date': '2021-2-18',
      Description: 'NO2 Sensor',
      Tcomp5u: 0,
      Gain: 47000000,
      Tcomp3l: 0,
      Tcomp0u: 91.796,
      'Molar Mass': 46.006,
      'Measurement Range': [Object],
      Tcomp4l: 0,
      'Bias mV': -200,
      Tcomp2u: 0.001,
      'ppb to ug Factor': 1.88,
      Manufacturer: 'SPEC',
      Tcomp6l: 0,
      'Sensitivity Error': 0,
      Tcomp1u: 0.292,
      'Value Name': 'no2',
      Offset: 14.09,
      Sensitivity: -35.55,
      'Serial Number': '05082001xxxx',
      'Part Number': '110507',
      Tcomp3u: 0,
      TcompDevTemp: -273,
      GainTempDrift: 300,
      Tcomp5l: 0,
      'Working Principle': 'electrochemical',
      'Usage Time': 13607607,
      Tcomp0l: 0,
      'Auto-Calibration Buffer': [Array],
      Tcomp2l: 0,
      Type: '3SP_NO2_5F-P',
      GainErrPercent: 5,
      'Manufacturing Date': '2020-05',
      'Calibration Date': '2021-10-23',
      Tcomp4u: 0,
      Tcomp6u: 0,
      'EEPROM Table Version': 1,
      Tcomp1l: 0,
      'Warm-up Time': 3600,
      Socket: 'soc1'
    },
    sound: {
      'Serial Number': '27xxxx',
      'Calibration Date': '2021-09-29',
      'Working Principle': 'RMS microphone voltage converter',
      Offset: 245,
      Manufacturer: 'Corant GmbH',
      'Auto-Calibration Buffer': [Array]
    },
    so2: {
      'EEPROM Programming Date': '2021-2-17',
      Description: 'SO2 Sensor',
      Tcomp5u: 0,
      Gain: 47000000,
      Tcomp3l: 0,
      Tcomp0u: 76.717,
      'Molar Mass': 64.066,
      'Measurement Range': [Object],
      Tcomp4l: 0,
      'Bias mV': 200,
      Tcomp2u: -0.004,
      'ppb to ug Factor': 2.62,
      Manufacturer: 'SPEC',
      Tcomp6l: 0,
      'Sensitivity Error': 0,
      Tcomp1u: 1.134,
      'Value Name': 'so2',
      Offset: -2423.126,
      Sensitivity: 36.27,
      'Serial Number': '11251903xxxx',
      'Part Number': '110601',
      Tcomp3u: -0,
      TcompDevTemp: -273,
      GainTempDrift: 300,
      Tcomp5l: 0,
      'Working Principle': 'electrochemical',
      'Usage Time': 13607647,
      Tcomp0l: 0,
      'Auto-Calibration Buffer': [Array],
      Tcomp2l: 0,
      Type: '3SP_SO2_20-P',
      GainErrPercent: 5,
      'Manufacturing Date': '2019-12',
      'Calibration Date': '2021-10-23',
      Tcomp4u: -0,
      Tcomp6u: 0,
      'EEPROM Table Version': 1,
      Tcomp1l: 0,
      'Warm-up Time': 3600,
      Socket: 'soc3'
    },
    o3: {
      'EEPROM Programming Date': '2021-6-3',
      Description: 'O3 Sensor',
      Tcomp5u: 0,
      Gain: 47000000,
      Tcomp3l: 0,
      Tcomp0u: 91.595,
      'Molar Mass': 47.997,
      'Measurement Range': [Object],
      Tcomp4l: 0,
      'Bias mV': -100,
      Tcomp2u: 0.001,
      'ppb to ug Factor': 1.96,
      Manufacturer: 'SPEC',
      Tcomp6l: 0,
      'Sensitivity Error': 0,
      Tcomp1u: 0.289,
      'Value Name': 'o3',
      Offset: -5.201,
      Sensitivity: -55.22,
      'Serial Number': '01142101xxxx',
      'Part Number': '110406',
      Tcomp3u: 0,
      TcompDevTemp: -273,
      GainTempDrift: 300,
      Tcomp5l: 0,
      'Working Principle': 'electrochemical',
      'Usage Time': 13607766,
      Tcomp0l: 0,
      'Auto-Calibration Buffer': [Array],
      Tcomp2l: 0,
      Type: '3SP_O3_20-P',
      GainErrPercent: 5,
      'Manufacturing Date': '2021-01',
      'Calibration Date': '2021-10-23',
      Tcomp4u: 0,
      Tcomp6u: 0,
      'EEPROM Table Version': 1,
      Tcomp1l: 0,
      'Warm-up Time': 3600,
      Socket: 'soc2'
    },
    oxygen: {
      Description: 'Oxygen Sensor',
      'Manufacture Date': '2020-D00217',
      Offset: -0.09,
      'Software Revision': '00021',
      Manufacturer: 'SST Sensing',
      Type: 'LuminOx',
      Status: 'Good',
      'Serial Number': '00285 1xxxx',
      'Part Number': 'LOX-02',
      'Working Principle': 'UV luminescence',
      'Calibration Date': '2021-7-16',
      'Value Name': [Array],
      'Usage Time': 13607326,
      'Auto-Calibration Buffer': [Array]
    }
  },
  RoomType: 'office',
  InitialCalFinished: true,
  RoomHeight: 2.6
}

*/
