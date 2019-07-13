const express = require('express');
const bodyParser = require('body-parser');
var Promise = require('promise');


var MongoClient = require('mongodb').MongoClient;

var url = "mongodb://marswavehome.tk:27017/smarthome";

const {AuthenticationClient} = require('auth0');
const auth0 = new AuthenticationClient({
  'clientId': 'v12WpZgnb7rdCH8opzT0I03Zirux4Lm2',
  'domain': 'marswave.auth0.com'
});

var mosca = require('mosca');
var settings = {
	port:1883
}

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

var server = new mosca.Server(settings);

server.authenticate = function (client, username, password, callback) {
	if(username=="MarswaveHome" && password == "Marswave@2017"){
		callback(null, true);
	}else{
		callback(null, false);
	}
 }

server.on('ready', function(){
	//console.log("ready");
});

server.on('clientConnected', function(client) {
	//console.log('client connected', client.id);
	clientID = client.id;
});

server.on('published', function(packet, client) {
	//console.log(JSON.stringify(client, null, 4));
	//console.log('message from server: ', packet.payload + ' - ' + client);
});

//create a MQTT client to push status
var mqtt = require('mqtt')
var client  = mqtt.connect('mqtt://127.0.0.1:1883', {username: "MarswaveHome", password: "Marswave@2017"})

client.on('connect', function(){
    //console.log('client connected');
    client.subscribe('/device/status/+');
    //console.log('suscribed to chat')
});


const {smarthome} = require('actions-on-google');
const app = smarthome({
  jwt: require('./secrets.json')
});

const getEmail = async (headers) => {
  const accessToken = headers.authorization.substr(7);
  const {email} = await auth0.getProfile(accessToken);
  return email;
}

var port = process.env.PORT || 3000;

client.on('message', async function(topic, message){
	  //Recieved a message
	  const commands = [{
		ids: [],
		status: 'SUCCESS',
		states: {},
	  }];

	  try{
			var deviceId = topic.replace('/device/status/', '');
			var parts = message.toString().split(":");
			var query = { _id: deviceId };
			//console.log("Device"+ deviceId + " - ");
			var dbo = await initDBConnection(); 
			if(parts[0] == "status"){
				if(parts[1] == "true") var state = true;
				else var state = false;
				var newvalues = { $set: {lastonline: new Date().getTime(), running: state } };
				dbo.collection("status").findOneAndUpdate(query, newvalues, {upsert:true,strict: false});
				//client.publish('/device/status/' + deviceId, "status:" + state);
				commands[0].ids.push(deviceId);
				commands[0].states = {
					on: state,
					online: true
				};
				// Report state back to Homegraph
				app.reportState({
					agentUserId: "sanjeet.pathak990@gmail.com",
					requestId: Math.random().toString(),
					payload: {
						devices: {
							states: {
								[deviceId]: commands[0].states,
							},
						},
					},
				}).then((res) => {
					//console.log("Success reporting: " + res);
				})
				.catch((res) => {
					//console.log("Failed reporting: " + res);
				});
			}
			else if(parts[0] == "fetch"){
				var device = parts[1];
				var query = { _id: device };
				var data = [];
				console.log("fetch event");
				await listSubDevices(device, dbo).then(function(subDevice){
					subDevice.forEach(dataX => {	
						dbo.collection("status").find({ _id: dataX.id }).toArray(function(err, result) {
							if (err){
								reject(err);
							}else{
								data.push(result);
							}
						});
					});
				});
				console.log(JSON.stringify(data, null, 4));
			}
	    }catch(e){
			console.log('Error : ' + e);
		}
        //console.log('message received : ' + message);
});

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
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
	// Query database by iterating over
	let promises = [];

	devices.forEach(device => {
		promises.push(new Promise(async function(resolve, reject) {
			var subDevices = listSubDevices(device, dbo);
			subDevices.then(function(data){
				resolve(data);
			}, function(error){
				reject(error);
			});
    	}))
	});	
	return Promise.all(promises);
}

function listSubDevices(device, dbo){
	let promises = [];

	var query = { _id: device };
	dbo.collection("devices").find(query).toArray(function(err, result) {
		promises.push(new Promise(async function(resolve, reject) {
			if(err){
				reject(err);
			}else{
				resolve(result);
			}
		}));
	})
	
	return Promise.all(promises);
}

function prepareDeviceData(userEmail){
	return new Promise(function(resolve, reject) {
		var promiseMongo = initDBConnection();

		const devices = [];
		
		promiseMongo.then(function(dbo){
			//console.log("Connected to mongo database. " + dbo.domain);
			findDevices(userEmail, dbo).then(function(devicex){
				const subDevices = [];
				findSubDevices(devicex, dbo).then(function(subDevice){
					subDevice.forEach(dataX => {	
						dataX.subDevices.forEach(data => {	
							//console.log(JSON.stringify(data, null, 4));
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
		//console.log(JSON.stringify(myObject, null, 4));
		return myObject;
	}catch(e){
	  //console.log(e.getmessage);
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

	const { devices, execution } = await body.inputs[0].payload.commands[0];
	var dbo = await initDBConnection();

	var fineDevices = await devices.filter(function (el) {
		return el != null;
	});

	await asyncForEach(fineDevices, async (device) => {
		try{
			var state = await doExecute(device.id, execution[0], dbo);
			commands[0].ids.push(device.id);
			commands[0].states = {
				on: state[0].running,
				online: true
			};
			// Report state back to Homegraph
			app.reportState({
				agentUserId: userId,
				requestId: body.requestId,
				payload: {
					devices: {
						states: {
							[device.id]: commands[0].states,
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
	var data =  {
			requestId: body.requestId,
			payload: {
				commands,
			},
		  };
	return data;
});

function doExecute(deviceId, execution, dbo){
	return new Promise(function(resolve, reject) {
		// Query database
		var query = { _id: deviceId };
		dbo.collection("status").find(query).count(function(err, result) {
			if (err){
				reject(err);
			}else{
				switch (execution.command) {
					// action.devices.traits.ArmDisarm
					case 'action.devices.commands.OnOff':
						var newvalues = { $set: {lastonline: new Date().getTime(), running: execution.params.on } };
						dbo.collection("status").findOneAndUpdate(query, newvalues, {upsert:true,strict: false});
						client.publish('/device/status/' + deviceId, "status:" + execution.params.on);
						resolve(dbo.collection("status").find(query).toArray());
						break;
					// action.devices.traits.OpenClose
					default:
						reject(new Error('actionNotAvailable' + execution.command));
				}
			}
		})
    })
}

express().get('/status', function (req, res) {
	res.send('Hello World');
 })
 
 
express().use(bodyParser.json(), app).listen(port);
