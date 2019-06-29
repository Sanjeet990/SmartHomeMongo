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

const getEmail = async (headers) => {
  const accessToken = headers.authorization.substr(7);
  const {email} = await auth0.getProfile(accessToken);
  return email;
}

db.settings({timestampsInSnapshots: true});

var port = process.env.PORT || 3000;

function initDBConnection(){
	return new Promise(function(resolve, reject) {
		// Connect to database
		MongoClient.connect(url, { useNewUrlParser: true }, function(err, db) {
			if (err) {
                reject(err);
            } else {
				var dbo = db.db("smarthome");
                resolve(dbo);
            }
		})
    })
}

function findDevices(userEmail, dbo){
	return new Promise(function(resolve, reject) {
		// Query database
		var query = { _id: userEmail };
		dbo.collection("users").find(query).toArray(function(err, result) {
			if (err){
				reject(err);
			}else{
				var filtered = result[0].devices.filter(function (el) {
					return el != null;
				});
				resolve(filtered);
			}
		})
    })
}

function findSubDevices(devices, dbo){
	return new Promise(function(resolve, reject) {
		// Query database by iterating over
		var subDevices = [];
		devices.forEach(device => {
			var query = { _id: device };
			dbo.collection("devices").find(query).toArray(function(err, result) {
				result.forEach(subDevice => {
					if (err){
						reject(err);
					}else{
						var filtered = result[0].subDevices.filter(function (el) {
							return el != null;
						});
						resolve(filtered);
					}
				});
			})
		});
    })
}

function prepareDeviceData(userEmail){
	return new Promise(function(resolve, reject) {
		const userDevices = [];
		
		var promiseMongo = initDBConnection();

		promiseMongo.then(function(dbo){
			console.log("Connected to mongo database. " + dbo.domain);
			findDevices(userEmail, dbo).then(function(devices){
				findSubDevices(devices, dbo).then(function(subDevice){
					subDevice.forEach(data => {	
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
						userDevices.push(deviceData);
					});
					resolve(userDevices);
				}, function(error){
					reject("Error: " + error);
				})
			}, function(error){
				reject("Error: " + error);
			})
		}, function(error){
			reject("Can not connect to database.");
		})	
	})
}

app.onSync(async (body, headers) => {
	const userEmail = await getEmail(headers);
	//const userEmail = "sanjeet.pathak990@gmail.com";
	var promisePrepare = prepareDeviceData(userEmail);
	promisePrepare.then(function(deviceData){
		var data = {
			requestId: body.requestId,
			payload: {
			  agentUserId: userEmail,
			  deviceData
			}
		  };
		  console.log(JSON.stringify(data, null, 4));
		  return data;
	}, function(error){
		return {
			requestId: body.requestId,
			payload: {
			  agentUserId: userEmail,
			  devices: []
			}
		  };
	});
});


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
