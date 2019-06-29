const express = require('express');
const bodyParser = require('body-parser');
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

app.onSync(async (body, headers) => {
	const userEmail = await getEmail(headers);
	const userDevices = [];
	MongoClient.connect(url, { useNewUrlParser: true }, async function(err, db) {
		
		if (err){
			return {
				requestId: body.requestId,
				payload: {
					agentUserId: userEmail,
					userDevices
				}
			}
		}
		
		//select the database
		var dbo = db.db("smarthome");
		//check if user exists
		var query = { _id: userEmail };
		await dbo.collection("users").find(query).toArray(async function(err, result) {
			if (err) throw err;
			if(result[0]._id != userEmail){
				console.log("User not found" + userEmail);
				//user not found! No device in the database
				return {
				  requestId: body.requestId,
				  payload: {
					agentUserId: userEmail,
					userDevices
				  }
				}
			}else{
				//User found. Proceed returning the user devices
				console.log("Step 1");
				var devices = result[0].devices;
				const start = async () => {
					await asyncForEach(devices, async (device) => {
						console.log("Step 2");
						var query = { _id: device };
						await dbo.collection("devices").find(query).toArray(async function(err, deviceList) {
							console.log("Step 3");
							if (err) throw err;
							await asyncForEach(deviceList, async (singleDevice) => {
								console.log("Step 4");
								var subDevices = singleDevice.subDevices;
								await asyncForEach(subDevices, async (data) => {
									console.log("Step 5");
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
									await userDevices.push(deviceData);
									console.log("Step 6");
									//db.close();
								});
								
							});
						});
					});
				} 
				console.log("Step 7");
				await start();
				console.log("Step 8");
					
				//method end. Time to return good things back
				var response = {
					requestId: body.requestId,
					payload: {
					  agentUserId: userEmail,
					  userDevices
					}
				}
				
				console.log(JSON.stringify(response, null, 4));
				console.log("Step 9");
				
				return response;//console.log(JSON.stringify(userDevices, null, 4));
			}
		});
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
