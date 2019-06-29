const express = require('express');
const bodyParser = require('body-parser');

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

const getEmail = async (headers) => {
  const accessToken = headers.authorization.substr(7);
  const {email} = await auth0.getProfile(accessToken);
  return email;
}

db.settings({timestampsInSnapshots: true});

var port = process.env.PORT || 3000;
app = express();

app.get('/', async function (req, res) {
  const data = "";
  const state = await doCheck("sanjeet.pathak990@gmail.com", "Device 1");
  res.send("Hello worldx " + JSON.stringify(state, null, 4));
});

const doCheck = async (userId, deviceId) => {
	  const doc = await db.collection('users').doc(userId).collection('devices').doc(deviceId).get();
	  if (!doc.exists) {
        throw new Error('deviceNotFound' + deviceId);
      }else{
		return doc.data().states;
	  }
}

app.get('/update', function (req, res) {
    
});

app.listen(port, () => console.log(`App listening on port ${port}!`))
