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

const Homey = require('homey');

class MyApp extends Homey.App {

	async onInit() {
		this.registerFlowListeners();
		this.log('airQ App has been initialized');
	}

	registerFlowListeners() {

		// action cards
		const reboot = this.homey.flow.getActionCard('reboot');
		reboot.registerRunListener((args) => args.device.reboot('flow'));

		const blink = this.homey.flow.getActionCard('blink');
		blink.registerRunListener((args) => args.device.blink('flow'));

		const playsound = this.homey.flow.getActionCard('playsound');
		playsound.registerRunListener((args) => args.device.playsound('flow', args));

		// condition cards
		const alarmGas = this.homey.flow.getConditionCard('alarm_gas_is_on');
		alarmGas.registerRunListener((args) => args.device.getCapabilityValue('alarm_gas'));

		const alarmHealth = this.homey.flow.getConditionCard('alarm_health_is_on');
		alarmHealth.registerRunListener((args) => args.device.getCapabilityValue('alarm_health'));

		const alarmPerf = this.homey.flow.getConditionCard('alarm_perf_is_on');
		alarmPerf.registerRunListener((args) => args.device.getCapabilityValue('alarm_perf'));

		const statusOK = this.homey.flow.getConditionCard('status_ok');
		statusOK.registerRunListener((args) => args.device.statusOK);

	}

}

module.exports = MyApp;
