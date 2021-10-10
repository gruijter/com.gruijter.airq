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

const { Driver } = require('homey');

class MyDriver extends Driver {

	async onInit() {
		this.log('Air-Q driver has been initialized');
	}

	async onPair(session) {
		// let username = '';
		let password = 'airqsetup';

		session.setHandler('login', async (data) => {
			this.log('pairing of new device started');
			// username = data.username;
			password = data.password;
			if (password === '') password = 'airqsetup';
			const credentialsAreValid = true;
			return credentialsAreValid;
		});

		session.setHandler('list_devices', async () => {
			const discoveryStrategy = this.getDiscoveryStrategy();
			const discoveryResults = discoveryStrategy.getDiscoveryResults();
			console.log(discoveryResults);
			const devices = Object.values(discoveryResults).map((discoveryResult) => ({
				name: discoveryResult.txt.devicename,
				data: {
					id: discoveryResult.id,
				},
				settings: {
					password,
					id: discoveryResult.id,
					address: discoveryResult.address,
					pollInterval: 10,
				},
				// capabilities: ['measure_health', 'measure_perf', 'measure_temperature', 'measure_humidity', 'measure_humidity_abs',
				// 	'measure_dew_point', 'measure_pressure',	'measure_noise', 'measure_voc',	'measure_so2', 'measure_co', 'measure_no2',
				// 	'measure_o3', 'measure_o2', 'measure_co2', 'measure_pm1', 'measure_pm25', 'measure_pm10', 'alarm_fire', 'alarm_gas',
				// 	'alarm_health', 'alarm_perf'],
			}));
			return devices;
		});
	}

}

module.exports = MyDriver;
