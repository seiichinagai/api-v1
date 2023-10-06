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


// Deals with padding to 8 bytes
function pad(text) {
   pad_bytes = 8 - (text.length % 8)
   for (var x=1; x<=pad_bytes;x++)
     text = text + String.fromCharCode(0)
   return text;
}

// Converts data received from user to XML format
// Encrypts and returns entire XML string
// Encryption may add on a few chars for padding but ignore anything after </root>
function encrypt(string) {
  var XMLString = string;
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(XMLString), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
}

// handles actual POST
router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':'); 
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  console.log(new Date().toISOString() + '\tIncoming request:\n'+JSON.stringify(req.body,null,2));
  
  if (!req.headers['content-length']){return next(createError(411, 'Content length required'));}
  if (req.headers['content-type'] != "application/json") {return next(createError(400, 'Invalid Content-Type header'));
    alert_slack('Failed API call; event.js; Invalid Content-Type header, ' + login);
  }
  if (login == "oati_api" && password == "LO$fk59#u@7M"){
    console.log('Receiving event request from oati');
    fs.readFile('/var/www/html/api.shiftedenergy.com/reference/client_creds.db', 'utf8', function(err,stdout){
      if (err) {
        alert_slack('Failed OATI API call; event.js; error reading client_creds.db');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable",
          "eventTime": new Date().toISOString(),
          "objectId":""
        });
        next();
      } else {
        fs.readFile('/var/www/html/api.shiftedenergy.com/reference/creds.db', 'utf8', function(cred_err,creds){
          if (cred_err) {
            alert_slack('Failed OATI API call; event.js; error reading creds.db');
            var stream = fs.createWriteStream(error_log, {'flags': 'a'});
            stream.write(new Date() + '\t' + err + '\n');
            stream.end();
            res.status(503).json({
              "returnResult": false,
              "returnReason": "Service temporarily unavailable",
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

async function handlePOST(req, res, next, client_creds, email, pw) {
  var header, source, destination, message, messageId, timestamp, xmlString;
  var event = {
    "Event":[]
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
    console.log('missing data 1 ' + JSON.stringify(event, null, 2));
    alert_slack('Failed OATI API call; event.js; JSON Header Attribute Incomplete');
    res.status(400).json({
      "returnResult": false,
      "returnReason": "JSON Header Attribute Incomplete",
      "eventTime": new Date().toISOString(),
      "objectId": messageId
    });
    next();
  }
  if(req.body.Event){
    event['Event'] = req.body.Event;
  } else {
    console.log('missing data 2 ' + JSON.stringify(event, null, 2));
    alert_slack('Failed OATI API call; event.js; Missing Event Attribute');
    res.status(400).json({
      "returnResult": false,
      "returnReason": "Missing Event Attribute",
      "eventTime": new Date().toISOString(),
      "objectId": messageId
    });
    next();
  }
  
  if(validate_format(event, res, next)){
    LocalStartDateTime= new time.Date(event['Event'][0]['Data'][0]['StartDateTime']).setTimezone(client_creds['timezone']);
    LocalEndDateTime= new time.Date(event['Event'][0]['Data'][0]['EndDateTime']).setTimezone(client_creds['timezone']);
    local_start_time_string = LocalStartDateTime.getFullYear() + '-' + ('0' + (LocalStartDateTime.getMonth()+1)).slice(-2) + '-' + ('0' + LocalStartDateTime.getDate()).slice(-2) + 'T' + ("0" + LocalStartDateTime.getHours()).slice(-2) + ':' + ("0" + LocalStartDateTime.getMinutes()).slice(-2);
    local_end_time_string = LocalEndDateTime.getFullYear() + '-' + ('0' + (LocalEndDateTime.getMonth()+1)).slice(-2) + '-' + ('0' + LocalEndDateTime.getDate()).slice(-2) + 'T' + ("0" + LocalEndDateTime.getHours()).slice(-2) + ':' + ("0" + LocalEndDateTime.getMinutes()).slice(-2);
    var eventid;
    if(event['Event'][0]['EventId']){
      eventid=event['Event'][0]['EventId'].toString();
    } else {
      eventid="";
    }

    console.log('Forwarding valid event: ' + JSON.stringify(event, null, 2));
    // console.log(xmlString);

    /*
      if no event id, send to aws
      if event id check which to send extension to
    */
    var awsJSON = {}

    if(!eventid || parseEventID(eventid)){
      extension = false;

      // V2 convert event to AWS format
      try {
        var awsGridService = "";
        if(event['Event'][0]['GridService'] == 'Capacity Build Aggregator') {
          awsGridService = 'build'
        } else {
          awsGridService = 'reduction'
        }

        var duration = parseInt((LocalEndDateTime.getTime() - LocalStartDateTime.getTime()) / 60000)

        if(eventid){
          extension = true;
          awsJSON = {
            "eventID": convertEventID(eventid, event['Event'][0]['Zone']),
            "newLocalEndDateTime": local_end_time_string
          }
        } else {
          awsJSON = {
            "metaGroupID": event['Event'][0]['Zone'],
            "gridService": awsGridService,
            "localStartDateTime": local_start_time_string,
            "durationMinutes": duration,
            "coldWaterDetect": false
          }
        }
      } catch (awsError){
        console.log('V2 Event Error: ' + awsError)
        res.status(503).json({
            "returnResult": false,
            "returnReason": "Service temporarily unavailable",
            "eventTime": new Date().toISOString(),
            "objectId": event['Event'][0]['Zone']
          });
        next();
      }
      console.log('Forwarding to AWS');

    } 
    // else {
      xmlString = '<root><method>initiate_metagroup_loadshift</method><user><email>' + email + '</email><password>' + pw
        + '</password></user><meta_group>'+event['Event'][0]['Zone']+'</meta_group><grid_service>'
        + event['Event'][0]['GridService']+ '</grid_service><event_id>' + eventid
          + '</event_id><local_start_date_time>'
        + local_start_time_string + '</local_start_date_time><local_end_date_time>'
        + local_end_time_string + '</local_end_date_time>' + '</root>';

      var encryption = encrypt(xmlString);

      console.log('Forwarding to WebDNA')

    forward(awsJSON, xmlString, encryption, req, res, next, event['Event'][0]['Zone'], extension, event['Event'][0]['GridService'])
  }
}

/**
 * V2 parse Event ID
 * */
function parseEventID(eventID){
  try {
    if (parseInt(eventID.toString().substring(0,4)) > 2050){
      return false;
    } else {
      return true;
    }
  } catch (error){
    console.log(error);
    alert_slack('Failed OATI API call; cancel_event.js; Event ID unparsable');
  }
}

function convertEventID(eventId, zone){
  var eIdString = eventId.toString();

  var awsIdString = eIdString.substring(0,4) + '-' + eIdString.substring(4,6) + '-' + eIdString.substring(6,8) + 'T' + eIdString.substring(8,10) + ':' + eIdString.substring(10,12) + '_' + zone;

  return awsIdString
}

function forward(awsJSON, xmlString, encryption, req, res, next, zone, extension, grid_service){
  // xmlString, encryption, req, res, next, zone, grid_service
  // forward(awsJSON, xmlString, encryption, req, res, next, zone, extension, grid_service)
  const p1 = forwardAWS(awsJSON, req, res, next, zone, extension)
  const p2 = forwardWebDNA(xmlString, encryption, req, res, next, zone, grid_service)

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

function validate_format(event, res, next){
  var result = true;
  event['Event'].forEach(function(event){
    if(!event['Zone'] || (event['Zone']!='OATI_Oahu' && event['Zone']!='OATI_Maui' && event['Zone']!='OATI_Oahu_Test' && event['Zone']!='OATI_Mg_Test' && event['Zone']!='OATI_Maui_Test' && event['Zone']!='Oahu_Test_Fleet' && event['Zone']!='OATI_Oahu_no_psa') || !event['CustomerType'] || !event['GridService'] || (event['GridService']!='Capacity Build Aggregator' && event['GridService']!='Capacity Reduction Aggregator') || !event['Data']){
      console.log('missing data 3 ' + JSON.stringify(event, null, 2));
      alert_slack('Failed OATI API call; event.js; Event Attribute Incomplete 1');
      res.status(400).json({
        "returnResult": false,
        "returnReason": "Event Attribute Incomplete",
        "eventTime": new Date().toISOString(),
        "objectId": event['Zone']
      });
      next();
      result = false;
    } else if (event['Data']){

      var now = new Date();
      var StartDateTime;
      var EndDateTime;

      event['Data'].forEach(function(data){
        if(!data['StartDateTime'] || !data['EndDateTime']){
          console.log('missing data 4 ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; JSON Event Attribute Incomplete 2');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "JSON Event Attribute Incomplete",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else {
          StartDateTime = new Date(data['StartDateTime']);
          EndDateTime = new Date(data['EndDateTime'])
        }
        if (!(StartDateTime > 0) || !(EndDateTime > 0)) {
          console.log('Invalid DateTime ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; Invalid DateTime');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "Invalid DateTime",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else if (EndDateTime - StartDateTime <= 0) {
          console.log('Invalid start/end ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; StartDateTime must precede EndDateTime');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "StartDateTime must precede EndDateTime",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else if ((new Date()).getTime() > StartDateTime.getTime() + 3600000) {
          // v2 update
          console.log('Event request exceeded late start allowance ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; Event request exceeded late start allowance');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "Event request exceeded late start allowance",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } 
        // else if (StartDateTime - now <= 0) {
        //   console.log('Error: past dates ' + JSON.stringify(event, null, 2));
        //   alert_slack('Failed OATI API call; event.js; Event requests cannot be made for a past date');
        //   res.status(400).json({
        //     "returnResult": false,
        //     "returnReason": "Event requests cannot be made for a past date",
        //     "eventTime": new Date().toISOString(),
        //     "objectId": event['Zone']
        //   });
        //   next();
        //   result = false;
        // } 
        else if (StartDateTime - now < 10800000 && event['GridService'] == 'Capacity Build Aggregator') {
          console.log('Error: Not 3hrs in advance ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; Capacity Build Events must be made at least three hours in advance');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "Capacity Build Events must be made at least three hours in advance",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else if (EndDateTime - StartDateTime > 14400000) {
          console.log('Invalid duration ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; event.js; Invalid duration');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "Capacity Events may last 0 to 4 hours",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        }
      });
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
    console.log('Unexpected zone. ' + zone)
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

// V2

function forwardAWS(awsJSON, req, res, next, zone, extension){
  return new Promise((resolve,reject)=>{
    // setTimeout(function () {
    //   resolve(503)
    // }, 1000)

    fs.readFile('/var/www/html/api.shiftedenergy.com/apiv2/id_token.db', 'utf-8', function(err,token){
      var file = extension ? 'extension.sh' : 'api_call_aws.sh';
      var command = '/var/www/html/api.shiftedenergy.com/aws/apiv2/' + file + ' ' + token + " '" + JSON.stringify(awsJSON) + "'"
      console.log('AWSJSON: ' + JSON.stringify(awsJSON))

      exec(command, function (error, stdout, stderr) {
        console.log('AWS response: ' + stdout)
        var json;
        try {
          json = JSON.parse(stdout);
        } catch (err) {
          alert_slack('Failed OATI API call; event.js; Error parsing V2 response');
          console.log('Failed OATI API call; event.js; Error parsing V2 response');

          resolve(503)
        }
        if (json && error !== null) {
          alert_slack('Failed OATI API call; event.js; exec error');
          console.log('Failed OATI API call; event.js; exec error');
          resolve(503)
        }
        else if (!res.headersSent && json && json.error){
          alert_slack('Failed OATI API call; event.js; V2 error response');
          console.log('V2 error response: ' + json.error)
          resolve(503)
        }
        else if (!res.headersSent && json && !json.eventID){
          alert_slack('Failed OATI API call; event.js; V2 no eventID');
          console.log('Failed OATI API call; event.js; V2 no eventID');
          resolve(503)
        } 
        else if (!res.headersSent && (zone == 'OATI_Oahu' || zone == 'OATI_Maui')){
          // retrieve new forecast
          // refresh forecast
          var oatiJSON = convertAWSFormat(json, zone);

          alert_slack_activity("" + '*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + oatiJSON.objectID);
          console.log('*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + oatiJSON.objectID)

          var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/run_get_forecasts.sh';
          exec(refresh_forecast_command, function(err,get_forecast_stdout){
            if(err){
              console.log(err);
              alert_slack('API error; event.js; Unable to refresh forecast');
            }
            if (!res.headersSent){
              console.log('Updating forecast... ');
              console.log('API Server Response: ' + JSON.stringify(oatiJSON))
              resolve(convertAWSFormat(json, zone));
            }
            if(zone == 'OATI_Oahu'){
              setTimeout(function(){
                var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/send_ffr_forecast.sh ' + zone;
                exec(send_ffr_forecast_command, function(ffrerr,ffrstdout){
                  if(ffrerr){
                    console.log(ffrerr);
                    alert_slack('API error; event.js; Unable to send ffr forecast');
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
                  alert_slack('API error; event.js; Unable to send build forecast');
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
                  alert_slack('API error; event.js; Unable to send reduction forecast');
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

/*
  Forward event to WebDNA
*/
function forwardWebDNA(xmlString, encryption, req, res, next, zone, grid_service){
  return new Promise((resolve,reject)=>{
    // setTimeout(function () {
    //   resolve(503)
    // }, 1500)


    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption, function (error, stdout, stderr) {
      var json;
      var decryption;
      try {
        json = JSON.parse(stdout);
        // alert_slack_activity('*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + stdout);
        console.log('*OATI event processed:*\n' + JSON.stringify(req.body) + '\nEventID:\n' + stdout)
      } catch (err) {
        alert_slack('Failed OATI API call; event.js; Error parsing WebDNA response');
        resolve(503)
      }
      if (json && error !== null) {
        alert_slack('Failed OATI API call; event.js; exec error');
        resolve(503)
      } else if (!res.headersSent && json && json.message === 'invalid'){
        alert_slack('Failed OATI API call; event.js; WebDNA response: invalid');
        resolve(503)
      } else if (!res.headersSent && json && json.message === 'capactiy event request failed'){
        alert_slack('Failed OATI API call; event.js; WebDNA response: capactiy event request failed');
        resolve(503)
      } else if (!res.headersSent && (zone == 'OATI_Oahu' || zone == 'OATI_Maui')){
        // retrieve new forecast
        // refresh forecast
        var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/oati/v2_forecast/src/run_get_forecast.sh ' + zone;
        exec(refresh_forecast_command, function(err,get_forecast_stdout){
          if(err){
            console.log(err);
            alert_slack('API error; event.js; Unable to refresh forecast');
          }
          if (!res.headersSent){
            console.log('Updating forecast... ');
            resolve(json);
          }
          if(zone == 'OATI_Oahu'){
            setTimeout(function(){
              var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_ffr_forecast.sh ' + zone;
              exec(send_ffr_forecast_command, function(ffrerr,ffrstdout){
                if(ffrerr){
                  console.log(ffrerr);
                  alert_slack('API error; event.js; Unable to send ffr forecast');
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
                alert_slack('API error; event.js; Unable to send build forecast');
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
                alert_slack('API error; event.js; Unable to send reduction forecast');
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

function alert_slack(string){
  // alert slack
  var json = {
    "text": '<@URNTVNK7E> ' + string
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