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
		const devices = [];
		
		var promiseMongo = initDBConnection();

		promiseMongo.then(function(dbo){
			console.log("Connected to mongo database. " + dbo.domain);
			findDevices(userEmail, dbo).then(function(devicex){
				findSubDevices(devicex, dbo).then(function(subDevice){
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
								"manufacturer": "Marswave SmartHome",
								"model": data.model,
								"hwVersion": data.hwVersion,
								"swVersion": data.swVersion
							}
						};
						devices.push(deviceData);
					});
					resolve(devices);
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
	var devices = await prepareDeviceData(userEmail);
	var data = {
		requestId: body.requestId,
		payload: {
			  agentUserId: userEmail,
			  devices
		}
	};
	//console.log(JSON.stringify(data, null, 4));
	return data;
});


app.onQuery(async (body, headers) => {
	// TODO Get device state
	try{
		const userId = await getEmail(headers);
		const { devices } = body.inputs[0].payload;
		const deviceStates = {};
		var dbo = await initDBConnection();

		const start = async () => {
			await asyncForEach(devices, async (device) => {
			  const state = await checkDevice(userId, device.id, dbo);
			  if(state.length > 0){
				deviceStates[device.id] = {
						on: state[0].running,
						online: true
				};
			  }else{
				deviceStates[device.id] = {};
			  }
			});
		} 
		await start();
		const myObject = {
			  requestId: body.requestId,
			  payload: {
				devices: deviceStates,
			  },
			};
		console.log(JSON.stringify(myObject, null, 4));
		return myObject;
	}catch(e){
	  console.log(e.getmessage);
	}
});

function checkDevice(userEmail, deviceID, dbo){
	return new Promise(function(resolve, reject) {
		// Query database
		var query = { _id: deviceID };
		dbo.collection("status").find(query).toArray(function(err, result) {
			if (err){
				reject(err);
			}else{
				var filtered = result.filter(function (el) {
					return el != null;
				});
				resolve(filtered);
			}
		})
    })
}
  
app.onDisconnect((body, headers) => {
  // TODO Disconnect user account from Google Assistant
  // You can return an empty body
  return {};
});

app.onExecute(async (body, headers) => {
	const userId = await getEmail(headers);
	
	const commands = [{
		ids: [],
		status: 'SUCCESS',
		states: {},
	}];

	const { devices, execution } = body.inputs[0].payload.commands[0];
	var dbo = await initDBConnection();

	var fineDevices = await devices.filter(function (el) {
		return el != null;
	});

	await asyncForEach(fineDevices, async (device) => {
		try{
			var states = await doExecute(userId, device.id, execution, dbo);
			commands[0].ids.push(device.id);
			commands[0].states = states;
			// Report state back to Homegraph
			app.reportState({
				agentUserId: userId,
				requestId: body.requestId,
				payload: {
					devices: {
						states: {
							[device.id]: states,
						},
					},
				},
			});
		}catch (e) {
			commands.push({
				ids: [device.id],
				status: 'ERROR',
				errorCode: e.message,
			});
		}
	});
	return {
			requestId: body.requestId,
			payload: {
				commands,
			},
  		};
});

function doExecute(userId, deviceId, execution, dbo){
	return new Promise(function(resolve, reject) {
		// Query database
		var query = { _id: deviceId };
		dbo.collection("status").find(query).count(function(err, result) {
			if (err){
				reject(err);
			}else{
				var newvalues = { $set: {lastonline: new Date().getTime(), running: false } };
				dbo.collection("status").findOneAndUpdate(query, newvalues, {upsert:true,strict: false});
				resolve(dbo.collection("status").find(query).toArray());
			}
		})
    })
}

express().use(bodyParser.json(), app).listen(port);
