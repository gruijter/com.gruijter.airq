# airQ

airQ provides advanced indoor air quality data

Supported sensor data:
* Temperature
* Humidity %
* Humidity absolute
* Air pressure
* Noise
* tVOC
* SO2
* CO
* NO2
* O3
* O2
* CO2
* PM1
* PM2.5
* PM10

Furthermore the following information is supported:
* Health index
* Performance index
* Dew point
* Health alarm
* Performance alarm
* Fire alarm
* Gas alarm

The following controls are possible from Homey:
* sound beeper with duration, frequency and volume control
* blink LED's
* Reboot

## setup in Homey
You need to have a fixed IP address for your airQ. When adding a device, enter the password. If you left the password on factory default (airqsetup) you can skip this step and go to the next screen. All airQ devices in your network will be shown. After adding one or more airQ devices they will be added as a Homey device. Note that you will only receive data if the password is correct. If needed you can change the password in the advanced device settings.

