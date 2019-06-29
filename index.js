const express = require('express');
const bodyParser = require('body-parser');
var Promise = require('promise');

var MongoClient = require('mongodb').MongoClient;

var url = "mongodb://marswavehome.tk:27017/smarthome";

const admin = require('firebase-admin');

let serviceAccount = require('./secrets.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};

let db = admin.firestore();

const {AuthenticationClient} = require('auth0');
const auth0 = new AuthenticationClient({
  'clientId': 'v12WpZgnb7rdCH8opzT0I03Zirux4Lm2',
  'domain': 'marswave.auth0.com'
});

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const functions = require('firebase-functions');

const {smarthome} = require('actions-on-google');
const app = smarthome({
  jwt: require('./secrets.json')
});

function getEmail(headers){
	return __awaiter(this, void 0, void 0, function* () {
		const accessToken = headers.authorization.substr(7);
		const email = yield auth0.getProfile(accessToken);
		return email;
	});
}

db.settings({timestampsInSnapshots: true});

var port = process.env.PORT || 3000;

function initDBConnection() {
		// Connect to database
	return __awaiter(this, void 0, void 0, function* () {
		yield MongoClient.connect(url, { useNewUrlParser: true }, function(err, db) {
			if (err) {
				return "";
			} else {
				return db.db("smarthome");
			}
		})
	})
}

function findDevices(userEmail, dbo){
	return __awaiter(this, void 0, void 0, function* () {
		var query = { _id: userEmail };
		var filteredx = [];
		yield dbo.collection("users").find(query).toArray(function(err, result) {
			if (err){
				return "";
			}else{
				var filtered = result[0].devices.filter(function (el) {
					return el != null;
				});
				filteredx = filtered;
			}
		})
		return filteredx;
	})
}

function findSubDevices(devices){
	// Query database by iterating over
	return __awaiter(this, void 0, void 0, function* () {
		var subDevices = [];
		yield devices.forEach(async (device) => {
			var query = { _id: device };
			yield dbo.collection("devices").find(query).toArray(function(err, result) {
				yield result.forEach(subDevice => {
					if (err){
						return "";
					}else{
						var filtered = result[0].subDevices.filter(function (el) {
							return el != null;
						});
						return filtered;
					}
				});
			})
		});
	});
}

function prepareDeviceData(userEmail){
	return __awaiter(this, void 0, void 0, function* () {
		var devices = [];
		const devicex = yield findDevices(userEmail, dbo);
		const subDevice = yield	findSubDevices(devicex, dbo);
		yield subDevice.forEach(data => {	
					const deviceData = {
						"id": data.id,
						"type": data.type,
						"traits": [data.traits],
						"name": {
						"defaultNames": [data.defaultNames],
						"name": data.name,
						"nicknames": [data.nicknames]
						},
						"willReportState": false,
						"deviceInfo": {
						"manufacturer": data.manufacturer,
						"model": data.model,
						"hwVersion": data.hwVersion,
						"swVersion": data.swVersion
						},
						"customData": {
						"fooValue": 74,
						"barValue": true,
						"bazValue": "foo"
						}
					};
					devices.push(deviceData);
		});
		return devices;
	});
}

app.onSync((body, headers) => __awaiter(this, void 0, void 0, function* () {
    const userId = yield getEmail(headers);
    yield MongoClient.connect(url, { useNewUrlParser: true }, function(err, db) {
		if (err) {
			return "";
		} else {
			dbo = db.db("smarthome");
			const devicex = yield findDevices(userEmail, dbo);
			console.log(JSON.stringify(devicex, null, 4));
		}
	})
}));

app.onQuery(async (body, headers) => {
  // TODO Get device state
  try{
	  const userId = await getEmail(headers);
	  const { devices } = body.inputs[0].payload;
	  const deviceStates = {};
	  
	  const start = async () => {
		  await asyncForEach(devices, async (device) => {
			const state = await doCheck(userId, device.id);
			deviceStates[device.id] = state;
			});
		  
	  } 
	  await start();
	  const myObject = {
			requestId: body.requestId,
			payload: {
			  devices: deviceStates,
			},
		  };
	  //console.log(JSON.stringify(myObject, null, 4));
	  return myObject;
  }catch(e){
	console.log(e.getmessage);
  }
});

app.onDisconnect((body, headers) => {
  // TODO Disconnect user account from Google Assistant
  // You can return an empty body
  return {};
});

const doCheck = async (userId, deviceId) => {
	  const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
	  if (!doc.exists) {
        throw new Error('deviceNotFound' + deviceId);
      }else{
		return doc.data().states;
	  }
}

const doExecute = async (userId, deviceId, execution) => {
        const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
        if (!doc.exists) {
            throw new Error('deviceNotFound' + deviceId);
        }
        const states = {
            online: true,
        };
        const data = doc.data();
        if (!data.states.online) {
            throw new Error('deviceOffline');
        }
        switch (execution.command) {
            // action.devices.traits.ArmDisarm
            case 'action.devices.commands.OnOff':
                await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
                    'states.on': execution.params.on,
                });
                states['on'] = execution.params.on;
                break;
            // action.devices.traits.OpenClose
            default:
                throw new Error('actionNotAvailable');
        }
        return states;
}

express().use(bodyParser.json(), app).listen(port);
