const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const time = require('time');
const j2xml = require('js2xmlparser');
const createError = require('http-errors');
const alert_slack_activity = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack_activity_gspa;

// handles actual POST
router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':');
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  console.log('\n' + new Date().toISOString() + ' Receiving cancelEvent');
  console.log(JSON.stringify(req.body,null,2));
  
  if (!req.headers['content-length']){return next(createError(411, 'Content length required'));}
  if (req.headers['content-type'] != "application/json") {
    alert_slack('Failed API call; cancel_event.js; Invalid Content-Type header, ' + login);
    return next(createError(400, 'Invalid Content-Type header'));
  }
  if (login == "oati_api" && password == "LO$fk59#u@7M"){
    fs.readFile('/var/www/html/api.shiftedenergy.com/reference/client_creds.db', 'utf8', function(err,stdout){
      if (err) {
        alert_slack('Failed OATI API call; cancel_event.js; error reading client_creds.db');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable...",
          "eventTime": new Date().toISOString(),
          "objectId":""
        });
        next();
      } else {
        fs.readFile('/var/www/html/api.shiftedenergy.com/reference/creds.db', 'utf8', function(cred_err,creds){
          if (cred_err) {
            alert_slack('Failed OATI API call; cancel_event.js; error reading creds.db');
            var stream = fs.createWriteStream(error_log, {'flags': 'a'});
            stream.write(new Date() + '\t' + err + '\n');
            stream.end();
            res.status(503).json({
              "returnResult": false,
              "returnReason": "Service temporarily unavailable....",
              "eventTime": new Date().toISOString(),
              "objectId":""
            });
            next();
          } else {
            email = JSON.parse(creds)['email'];
            pw = JSON.parse(creds)['password'];
            var client_creds = JSON.parse(stdout)['oati'];
            handlePOST(req, res, next, client_creds, email, pw);
          }
        });
      }
    });
  } else {
    return next(createError(401, "Unauthorized"));
  }
});

function handlePOST(req, res, next, client_creds, email, pw) {
  // check if each necessary field exists
  // if so, set variables; otherwise, send error
  // encrypt and send to olin
  // send success or fail response back to OATI
  var header, source, destination, message, messageId, timestamp;
  var cancelevent = {
    "CancelEvent":[]
  };

  if(req.body.Header && req.body.Header.Source && req.body.Header.Destination && req.body.Header.Message
    && req.body.Header.MessageId && req.body.Header.TimeStamp){
    header = req.body.Header;
    source = req.body.Header.Source;
    destination = req.body.Header.Destination;
    message = req.body.Header.Message;
    messageId = req.body.Header.MessageId;
    timestamp = req.body.Header.TimeStamp;
  } else {
    console.log(new Date().toISOString(), 'Incomplete 1 ', JSON.stringify(req.body, null, 2));
    alert_slack('Failed OATI API call; cancel_event.js; JSON Header Attribute Incomplete');
    res.status(400).json({
      "returnResult": false,
      "returnReason": "JSON Header Attribute Incomplete",
      "eventTime": new Date().toISOString(),
      "objectId": "MessageId: " + req.body.Header.MessageId
    });
    next();
  }
  if(req.body.CancelEvent){
    cancelevent['CancelEvent'] = req.body.CancelEvent;
  } else {
    console.log(new Date().toISOString(), 'Incomplete 2 ', JSON.stringify(req.body, null, 2));
    alert_slack('Failed OATI API call; cancel_event.js; Missing CancelEvent Attribute');
    res.status(400).json({
      "returnResult": false,
      "returnReason": "Missing CancelEvent Attribute",
      "eventTime": new Date().toISOString(),
      "objectId": messageId
    });
    next();
  }
  if(validate(cancelevent, req, res, next, messageId)){
    var awsJSON, encryption;
    /**
     * V2 if awsID forwardAWS() else forward()
     * */
    var awsID = parseEventID(cancelevent['CancelEvent'][0]['EventId'])
    if(awsID < 0){ // parseEventID == -1
      console.log('WebDNA Event ID found')
      var xmlString = '<root><method>cancel_metagroup_event</method><source>HECO GSDS</source><email>' + email + '</email><password>' + pw
        + '</password><EventId>'+cancelevent['CancelEvent'][0]['EventId']+'</EventId></root>';
      encryption = encrypt(xmlString)

      // forward(encryption, messageId, req, res, next, cancelevent['CancelEvent'][0]['Zone']);

    } else {
      console.log('AWS Event ID found')
    }
    // else {  // parseEventID == 1

      awsJSON = convertToAWSFormat(cancelevent['CancelEvent'][0]['EventId'], cancelevent['CancelEvent'][0]['Zone'])

      // forwardAWS(awsJSON, req, res, next, cancelevent['CancelEvent'][0]['Zone'])

      forward(awsJSON, encryption, req, res, next, cancelevent['CancelEvent'][0]['Zone'], cancelevent['CancelEvent'][0]['EventId'])
    // }
  }
}

function forward(awsJSON, encryption, req, res, next, zone, event_id){
  const p1 = forwardAWS(awsJSON, req, res, next, zone)
  const p2 = forwardWebDNA(encryption, event_id, req, res, next, zone)

  Promise.all([p1,p2]).then((responses) => {

    console.log(JSON.stringify(responses))

    // respond with 503 if both fail
    if(responses[0] == 503 && responses[1] == 503){
      res.status(503).json({
        "returnResult": false,
        "returnReason": "Unable to fulfill capacity event request",
        "eventTime": new Date().toISOString(),
        "objectId":zone
      });
      next();
    } else if (typeof responses[0] == 'object'){
      res.status(200).json(responses[0]);
    } else if (typeof responses[1] == 'object'){
      res.status(200).json(responses[1]);
    } else {
      res.status(503).json({
        "returnResult": false,
        "returnReason": "Unable to fulfill capacity event request",
        "eventTime": new Date().toISOString(),
        "objectId":zone
      });
      next();
    }
  }).catch(()=>{
    res.status(503).json({
      "returnResult": false,
      "returnReason": "Unable to fulfill capacity event request",
      "eventTime": new Date().toISOString(),
      "objectId":zone
    });
    next();
  })
}

function convertToAWSFormat(eventId, zone){
  var eIdString = eventId.toString();

  //json.eventID.substring(0, json.eventID.indexOf('_')).split('-').join('').split('T').join('').split(':').join('') + metagroupId
  var awsIdString = eIdString.substring(0,4) + '-' + eIdString.substring(4,6) + '-' + eIdString.substring(6,8) + 'T' + eIdString.substring(8,10) + ':' + eIdString.substring(10,12) + '_' + zone;

  return {
    "eventID": awsIdString
  }
}

/**
 * V2 parse Event ID
 * */
function parseEventID(eventID){
  try {
    if (parseInt(eventID.toString().substring(0,4)) > 2050){
      return -1;
    } else {
      return eventID;
    }
  } catch (error){
    console.log(error);
    alert_slack('<@Seiichi> Failed OATI API call; cancel_event.js; Event ID unparsable');
  }
}


function validate(cancelevent, req, res, next, messageId){
  var result = true;
  cancelevent['CancelEvent'].forEach(function(event){
    if(!event['Zone'] || (event['Zone']!='OATI_Oahu' && event['Zone']!='OATI_Maui' && event['Zone']!='OATI_Oahu_Test' && event['Zone']!='OATI_Mg_Test' && event['Zone']!='OATI_Maui_Test' && event['Zone']!='Oahu_Test_Fleet' && event['Zone']!='OATI_Oahu_no_psa') || !event['CustomerType'] || !event['GridService'] || (event['GridService']!='Capacity Build Aggregator' && event['GridService']!='Capacity Reduction Aggregator')){
      console.log(new Date().toISOString(), 'Incomplete 3 ', JSON.stringify(req.body, null, 2));
      alert_slack('Failed OATI API call; cancel_event.js; CancelEvent Attribute Incomplete');
      res.status(400).json({
        "returnResult": false,
        "returnReason": "CancelEvent Attribute Incomplete",
        "eventTime": new Date().toISOString(),
        "objectId":event['EventId']
      });
      next();
      result = false;
    }
  });
  return result;
}

// V2

function convertAWSFormat(json, zone){
  var metagroupId, eventIdString;

  if (zone == 'OATI_Oahu') {
    metagroupId = '1'
  } else if (zone == 'OATI_Maui') {
    metagroupId = '2';
  } else {
    metagroupId = '0';
    console.log('Zone not known. ' + zone)
  }

  eventIdString = json.eventID.substring(0, json.eventID.indexOf('_')).split('-').join('').split('T').join('').split(':').join('') + metagroupId

  if(parseInt(eventIdString) == NaN){
    console.log('eventIdString is not a number:' + eventIdString)
  }

  return {
    "eventTime": new Date().toISOString(),
    "objectID": eventIdString,
    "returnReason": "SUCCESS",
    "returnResult": true
  }
}


function forwardAWS(awsJSON, req, res, next, zone){
  console.log('Forwarding cancel event to AWS.')
  return new Promise((resolve,reject)=>{
    
    fs.readFile('/var/www/html/api.shiftedenergy.com/apiv2/id_token.db', 'utf-8', function(err,token){
      if(err){
        console.log('cancelevent id token err: ' + err)
      }

      var command = '/var/www/html/api.shiftedenergy.com/aws/apiv2/aws_cancel_event.sh ' + token + " '" + JSON.stringify(awsJSON) + "'"
      console.log('AWS outgoing JSON body: ' + JSON.stringify(awsJSON))

      exec(command, function (error, stdout, stderr) {
        console.log('AWS response: ' + stdout)
        var json;
        try {
          json = JSON.parse(stdout);
        } catch (err) {
          console.log('Failed OATI API call; cancel_event.js; Error parsing V2 response')
          alert_slack('<@Seiichi> Failed OATI API call; cancel_event.js; Error parsing V2 response');
          resolve(503)
        }
        if (json && error !== null) {
          console.log('Failed OATI API call; cancel_event.js; exec error')
          alert_slack('<@Seiichi> Failed OATI API call; cancel_event.js; exec error');
          resolve(503)
        }
        else if (!res.headersSent && json && json.error){
          console.log('Failed OATI API call; cancel_event.js; V2 error response')
          alert_slack('<@Seiichi> Failed OATI API call; cancel_event.js; V2 error response');
          resolve(503)
        }
        else if (!res.headersSent && json && !json.eventID){
          console.log('cancelevent no eventID in aws response: ' + JSON.stringify(json))
          alert_slack('<@Seiichi> Failed OATI API call; cancel_event.js; V2 no eventID');
          resolve(503)
        } 
        else if (!res.headersSent && (zone == 'OATI_Oahu' || zone == 'OATI_Maui')){
          // retrieve new forecast
          // refresh forecast
          var oatiJSON = convertAWSFormat(json, zone);

          alert_slack_activity("<@Seiichi> " + '*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + oatiJSON.objectID);
          console.log('*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + oatiJSON.objectID)

          var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/run_get_forecasts.sh';
          exec(refresh_forecast_command, function(err,get_forecast_stdout){
            if(err){
              console.log(err);
              alert_slack('API error; cancel_event.js; Unable to refresh forecast');
            }
            if (!res.headersSent){
              console.log('Updating forecast... ');
              console.log('API Server Response: ' + JSON.stringify(oatiJSON))
              resolve(oatiJSON);
            }
            if(zone == 'OATI_Oahu'){
              setTimeout(function(){
                var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_ffr_forecast.sh ' + zone;
                exec(send_ffr_forecast_command, function(ffrerr,ffrstdout){
                  if(ffrerr){
                    console.log(ffrerr);
                    alert_slack('API error; cancel_event.js; Unable to send ffr forecast');
                    next();
                  }
                  console.log('Updated ffr forecast sent to OATI');
                  next();
                });
              },30000);
            }
            setTimeout(function(){
              var send_build_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_build_forecast.sh ' + zone;
              exec(send_build_forecast_command, function(builderr,stdout){
                if(builderr){
                  console.log(builderr);
                  alert_slack('API error; cancel_event.js; Unable to send build forecast');
                  next();
                }
                console.log('Updated build forecast sent to OATI');
                next();
              });
            },30000);
            setTimeout(function(){
              var send_reduction_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_reduction_forecast.sh ' + zone;
              exec(send_reduction_forecast_command, function(reductionerr,stdout){
                if(reductionerr){
                  console.log(reductionerr);
                  alert_slack('API error; cancel_event.js; Unable to send reduction forecast');
                  next();
                }
                console.log('Updated Reduction forecast sent to OATI');
                next();
              });
            },30000);
          });
        } 
        // if event was scheduled for a TEST metagroup or nonOATI metagroup
        else if (!res.headersSent){
          resolve(convertAWSFormat(json, zone));
        }
      }).message;
    })
  })
}

function forwardWebDNA(encryption, event_id, req, res, next, zone){
  console.log('Forwarding cancel event to WebDNA. EventID: ' + event_id)
  return new Promise((resolve,reject)=>{
    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
      function (error, stdout, stderr) {
        console.log('WebDNA response:\n' + stdout);
        var json;
        var decryption;
        try {
          json = JSON.parse(stdout);
        } catch (err) {
          console.log('Error parsing WebDNA response')
          alert_slack('Failed OATI API call; cancel_event.js; Error parsing WebDNA response');
          resolve(503)
        }
        if (json && error !== null) {
          alert_slack('Failed OATI API call; cancel_event.js; exec error');
          resolve(503)
        } else if (!res.headersSent && json && json.message === 'invalid'){
          alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: invalid');
          resolve(503)
        } else if (!res.headersSent && json && json.message === 'id not found'){
          alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: Load shift id not found');
          resolve(503)
        } else if (!res.headersSent && json && json.message === 'cancel event request failed'){
          alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: cancel_event request failed');
          resolve(503)
        } else if (!res.headersSent && (zone == 'OATI_Oahu' || zone == 'OATI_Maui')){
          // retrieve new forecast
          // refresh forecast
          var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/run_get_forecast.sh ' + zone;
          exec(refresh_forecast_command, function(err,get_forecast_stdout){
            if(err){
              alert_slack('API error; cancel_event.js; Unable to refresh forecast');
              console.log(err);
            }
            if (!res.headersSent){
              console.log('Updating forecast... ');
              resolve(json);
            }
            if(zone == 'OATI_Oahu'){
              setTimeout(function(){
                var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_ffr_forecast.sh ' + zone;
                exec(send_ffr_forecast_command, function(ffrerr,ffrstdout){
                  if(ffrerr){
                    console.log(ffrerr);
                    alert_slack('API error; cancel_event.js; Unable to send ffr forecast');
                    next();
                  }
                  console.log('Updated ffr forecast sent to OATI');
                  next();
                });
              },30000);
            }
            setTimeout(function(){
              var send_build_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_build_forecast.sh ' + zone;
              exec(send_build_forecast_command, function(builderr,stdout){
                if(builderr){
                  console.log(builderr);
                  alert_slack('API error; cancel_event.js; Unable to send build forecast');
                  next();
                }
                console.log('Updated build forecast sent to OATI');
                next();
              });
            },30000);
            setTimeout(function(){
              var send_reduction_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_reduction_forecast.sh ' + zone;
              exec(send_reduction_forecast_command, function(reductionerr,stdout){
                if(reductionerr){
                  console.log(reductionerr);
                  alert_slack('API error; cancel_event.js; Unable to send reduction forecast');
                  next();
                }
                console.log('Updated Reduction forecast sent to OATI');
                next();
              });
            },30000);
          });
        } else if (!res.headersSent){
          resolve(json);
        } 
      }).message;
  })
}

function encrypt(string) {
  var XMLString = string;
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(XMLString), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
}

function pad(text) {
   pad_bytes = 8 - (text.length % 8)
   for (var x=1; x<=pad_bytes;x++)
     text = text + String.fromCharCode(0)
   return text;
}

function alert_slack(string){
  // alert slack
  var json = {
    "text": string
  }
  var slack_command = '/var/www/html/api.shiftedenergy.com/scripts/slack_err_alert.sh ' + "'" + JSON.stringify(json) + "'";
  exec(slack_command,function(slackerr,slackresponse){
    if(slackerr){
      console.log(slackerr);
    } else if(slackresponse){
      console.log(new Date().toISOString() + ', ' + string + ', slack response: ' + slackresponse);
    }
  });
}

module.exports = router;