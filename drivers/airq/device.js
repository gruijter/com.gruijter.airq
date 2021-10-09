/*
Copyright 2021, Robin de Gruijter (gruijter@hotmail.com)

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

const { Device } = require('homey');
const util = require('util');
const AirQ = require('../../airq');

const setTimeoutPromise = util.promisify(setTimeout);

const capabilityMap = {
	measure_health: 'health', // 805, Calculated health index. Range 0 to 1000: normal rating. -200 for gas alarm. -800 for fire alarm.,
	measure_perf: 'performance', // 470.3317
	measure_temperature: 'temperature', // [ 19.596, 0.54 ]
	measure_humidity: 'humidity', // [ 72.74601, 4.34 ]
	measure_humidity_abs: 'humidity_abs', // [ 12.327, 0.58 ]
	measure_dewpt: 'dewpt', // [ 14.227, 0.8 ]
	measure_pressure: 'pressure', // [ 1003.23, 1 ]
	measure_noise: 'sound', // [ 41.5, 4.9 ]
	measure_voc: 'tvoc', // [ 114, 17.1 ]
	measure_so2: 'so2', // [ 70.29, 136 ]
	measure_co: 'co', // [ 1.409, 0.1 ]
	measure_no2: 'no2', // [ -727.27, 42.3 ]
	measure_o3: 'o3', // [ -501.53, 28.8 ]
	measure_o2: 'oxygen', // [ 20.334, 0.92 ]
	measure_co2: 'co2', // [ 913, 77.39 ]
	measure_pm1: 'pm1', // [ 4, 10 ]
	measure_pm25: 'pm2_5', // [ 4, 10 ]
	measure_pm10: 'pm10', // [ 6, 11 ]
	alarm_fire: 'alarm_fire', // false
	alarm_gas: 'alarm_gas', // false
	alarm_health: 'alarm_health', // false
	alarm_perf: 'alarm_perf', // false
};

// helper to to get data from array, and to exclude missing sensors or in warm up mode
const getValue = (dataCopy, dataKey) => {
	if (!Object.prototype.hasOwnProperty.call(dataCopy, dataKey)) return undefined; // data is not included in result
	const value = dataCopy[dataKey];
	if (dataCopy.Status[dataKey]) return undefined; // 'co sensor still in warm up phase; waiting time = 46 s'
	if (Array.isArray(value)) return dataCopy[dataKey][0];
	return dataCopy[dataKey];
};

class MyDevice extends Device {

	async onInit() {
		this.log(`Initializing ${this.getName()}`);
		try {
			const options = {
				address: this.getSettings().address,
				port: 80,
				timeout: (this.getSettings().pollInterval * 950) || 10000,
				password: this.getSettings().password,
			};
			this.airQ = new AirQ(options);
			this.startPolling(this.getSettings().pollInterval || 10);
			this.log(JSON.stringify(await this.airQ.getConfig()));
			this.setAvailable();
		} catch (error) {
			this.error(error);
			this.setUnavailable(error.message);
		}
	}

	startPolling(interval) {
		this.log(`Start polling ${this.getName()} @ ${interval} seconds interval`);
		this.stopPolling();
		this.doPoll(); // get first results immediately
		this.intervalIdDevicePoll = this.homey.setInterval(() => {
			this.doPoll();
		}, 1000 * interval);
	}

	stopPolling() {
		clearInterval(this.intervalIdDevicePoll);
	}

	async restartDevice(delay) {
		// this.destroyListeners();
		if (this.restarting) return;
		this.restarting = true;
		this.stopPolling();
		const dly = delay || 2000;
		this.log(`Device will restart in ${dly / 1000} seconds`);
		await setTimeoutPromise(dly).then(() => this.onInit());
	}

	async onAdded() {
		this.log(`${this.getName()} has been added`);
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings() {
		this.log(`${this.getName()} settings where changed`);
		this.restartDevice();
	}

	/**
	 * @param {string} name The new name
	 */
	async onRenamed(name) {
		this.log(`${name} was renamed`);
	}

	async onDeleted() {
		this.log(`${this.getName()} has been deleted`);
		this.stopPolling();
	}

	async doPoll() {
		try {
			if (this.busy) {
				this.log('skipping a poll');
				return;
			}
			this.busy = true;
			const data = await this.airQ.getData();
			this.handleData(data);
			this.busy = false;
			this.setAvailable();
		} catch (error) {
			this.error(error);
			this.busy = false;
			this.setUnavailable(error.message);
		}
	}

	async setCapability(capability, value) {
		if (value === undefined) return;
		if (this.hasCapability(capability)) {
			this.setCapabilityValue(capability, value)
				.catch((error) => {
					this.error(error, capability, value);
				});
		} else {	// add capability if needed
			this.log(`${this.getName()} adding capability ${capability}`);
			await this.addCapability(capability)
				.catch((error) => {
					this.error(error, capability, value);
				});
			this.setCapability(capability, value);
		}
	}

	handleData(info) {
		try {
			const data = info;
			// calculate some values
			data.alarm_gas = data.health === -200;
			data.alarm_fire = data.health === -800;
			data.alarm_health = data.health <= this.getSettings('alarm_health_threshold');
			data.alarm_perf = data.performance <= this.getSettings('alarm_performance_threshold');

			data.health = Math.round(data.health / 10);
			data.performance = Math.round(data.performance / 10);

			if (data.door_event) console.log('door event:', data.door_event);

			// update capabilities
			// console.log(data);
			Object.keys(capabilityMap).forEach((capability) => {
				const dataKey = capabilityMap[capability];
				const dataValue = getValue(data, dataKey);	// undefined if missing or warm up
				this.setCapability(capability, dataValue);
			});

		} catch (error) {
			this.error(error);
		}
	}

}

module.exports = MyDevice;

/*
data:
{
  tvoc: [ 114, 17.1 ],
  pm2_5: [ 4, 10 ],
  DeviceID: 'xxxxxxxxb33faa8exxxxxxxxxxxxxxxx',
  Status: 'OK',
  humidity: [ 72.74601, 4.34 ],
  cnt0_3: [ 756, 84 ],
  measuretime: 1931,
  sound: [ 41.5, 4.9 ],
  temperature: [ 19.596, 0.54 ],
  cnt0_5: [ 221, 31 ],
  performance: 470.3317,
  co: [ 1.409, 0.1 ],
  humidity_abs: [ 12.327, 0.58 ],
  co2: [ 913, 77.39 ],
  uptime: 3968,
  so2: [ 70.29, 136 ],
  cnt2_5: [ 2, 10 ],
  o3: [ -501.53, 28.8 ],
  cnt10: [ 0, 10 ],
  no2: [ -727.27, 42.3 ],
  cnt5: [ 2, 10 ],
  timestamp: 1633187830000,
  pressure: [ 1003.23, 1 ],
  TypPS: 4,
  cnt1: [ 18, 12 ],
  door_event: 0,
  pm1: [ 4, 10 ],
  oxygen: [ 20.334, 0.92 ],
  dewpt: [ 14.227, 0.8 ],
  pm10: [ 6, 11 ],
  health: 805,
  bat: [ 0, 0 ],
  dHdt: 0.45,
  dCO2dt: 255.62
}

{
  performance: 474.6968,
  co2: [ 914, 77.42 ],
  dCO2dt: 0,
  humidity_abs: [ 12.192, 0.57 ],
  humidity: [ 71.825, 4.28 ],
  TypPS: 10,
  bat: [ 0, 0 ],
  measuretime: 1812,
  timestamp: 1633203796000,
  sound: [ 39.4, 5.6 ],
  health: 988,
  oxygen: [ 20.327, 0.93 ],
  dHdt: 0,
  cnt10: [ 2, 10 ],
  pm2_5: [ 0, 10 ],
  cnt5: [ 2, 10 ],
  Status: {
    co: 'co sensor still in warm up phase; waiting time = 146 s',
    tvoc: 'tvoc sensor still in warm up phase; waiting time = 145 s',
    so2: 'so2 sensor still in warm up phase; waiting time = 145 s',
    no2: 'no2 sensor still in warm up phase; waiting time = 145 s',
    o3: 'o3 sensor still in warm up phase; waiting time = 145 s'
  },
  pressure: [ 995.06, 1 ],
  pm1: [ 0, 10 ],
  uptime: 44,
  door_event: 0,
  DeviceID: 'xxxxxxxxb33faa8exxxxxxxxxxxxxxxx',
  temperature: [ 19.626, 0.54 ],
  cnt1: [ 10, 11 ],
  cnt0_3: [ 276, 37 ],
  dewpt: [ 14.062, 0.8 ],
  cnt2_5: [ 2, 10 ],
  pm10: [ 1, 10 ],
  cnt0_5: [ 62, 16 ]
}

*/
