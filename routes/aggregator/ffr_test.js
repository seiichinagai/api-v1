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

  console.log(JSON.stringify(req.body,null,2));

  if (!req.headers['content-length']){return next(createError(411, 'Content length required'));}
  if (req.headers['content-type'] != "application/json") {
    alert_slack('Failed API call; ffr_test.js; Invalid Content-Type header, ' + login);
    return next(createError(400, 'Invalid Content-Type header'));
  }
  if (login == "oati_api" && password == "LO$fk59#u@7M"){
    console.log('Receiving FFRTest from oati');
    fs.readFile('/var/www/html/api.shiftedenergy.com/reference/client_creds.db', 'utf8', function(err,stdout){
      if (err) {
        alert_slack('Failed OATI API call; ffr_test.js; error reading client_creds.db');
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
            alert_slack('Failed OATI API call; ffr_test.js; error reading creds.db');
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

function handlePOST(req, res, next, client_creds, email, pw) {
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
    console.log(new Date().toISOString(), 'Incomplete 1 ', JSON.stringify(req.body, null, 2));
    alert_slack('Failed OATI API call; ffr_test.js; JSON Header Attribute Incomplete');
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
    console.log(new Date().toISOString(), 'Incomplete 2 ', JSON.stringify(req.body, null, 2));
    alert_slack('Failed OATI API call; ffr_test.js; Missing Event Attribute');
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
    xmlString = '<root><method>initiate_metagroup_edr</method><user><email>' + email + '</email><password>' + pw
      + '</password></user><meta_group>'+event['Event'][0]['Zone']+'</meta_group><local_start_date_time>'
      + local_start_time_string + '</local_start_date_time><local_end_date_time>'
      + local_end_time_string + '</local_end_date_time><note>Test FFR</note><startRightAway>false</startRightAway></root>';

    var encryption = encrypt(xmlString);
    console.log('FFRTest payload valid, creating event...');
    forward(encryption, req, res, next, event['Event'][0]['Zone'], event['Event'][0]['Data'][0]['StartDateTime'], event['Event'][0]['Data'][0]['EndDateTime']);
    alert_slack_activity('OATI requesting FFR Test for ' + event['Event'][0]['Zone']);
  }
}

function validate_format(event, res, next){
  var result = true;
  event['Event'].forEach(function(event){
    if(!event['Zone'] || (event['Zone']!='OATI_Oahu_Test' && event['Zone']!='OATI_Oahu' && event['Zone']!='Oahu' && event['Zone']!='Oahu_Test_Fleet') 
      || !event['CustomerType'] || !event['GridService'] || (event['GridService']!='FFR' && event['GridService']!='FFRTest') || !event['Data']){
      console.log(new Date().toISOString(), 'Incomplete 3 ', JSON.stringify(req.body, null, 2));
      alert_slack('Failed OATI API call; ffr_test.js; Event Attribute Incomplete');
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
          alert_slack('Failed OATI API call; ffr_test.js; JSON Event Attribute Incomplete');
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
          EndDateTime = new Date(data['EndDateTime']);
        }
        if (!(StartDateTime > 0) || !(EndDateTime > 0)) {
          console.log('Invalid DateTime ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; ffr_test.js; Invalid DateTime');
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
          alert_slack('Failed OATI API call; ffr_test.js; StartDateTime must precede EndDateTime');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "StartDateTime must precede EndDateTime",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else if (StartDateTime - now <= 0) {
          console.log('Error: past dates ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; ffr_test.js; Event requests cannot be made for a past date');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "Event requests cannot be made for a past date",
            "eventTime": new Date().toISOString(),
            "objectId": event['Zone']
          });
          next();
          result = false;
        } else if (EndDateTime - StartDateTime > 28800000) {
          console.log('Invalid duration ' + JSON.stringify(event, null, 2));
          alert_slack('Failed OATI API call; ffr_test.js; Invalid duration');
          res.status(400).json({
            "returnResult": false,
            "returnReason": "FFRTest may last 0 to 8 hours",
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

/*
  
*/
function forward(encryption, req, res, next, zone, start, end){
  writeFFRTestFile(zone, start, end);
  // if (!res.headersSent){
  //   res.status(200).json({
  //     'message':'SUCCESS'
  //   });
  // }
  var command = 'sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh ' + encryption;
  exec(command,
    function (error, stdout, stderr) {
      var json;
      var decryption;
      try {
        json = JSON.parse(stdout);
      } catch (err) {
        alert_slack('Failed OATI API call; ffr_test.js; Error parsing WebDNA response');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable",
          "eventTime": new Date().toISOString(),
          "objectId":zone
        });
        next();
      }
      if (json && error !== null) {
        alert_slack('Failed OATI API call; ffr_test.js; exec error');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable",
          "eventTime": new Date().toISOString(),
          "objectId":zone
        });
        next();
      } else if (!res.headersSent && json && json.message === 'invalid'){
        alert_slack('Failed OATI API call; ffr_test.js; WebDNA response: invalid');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Internal server error",
          "eventTime": new Date().toISOString(),
          "objectId":zone
        });
        next();
      } else if (!res.headersSent && json && json.message === 'capactiy event request failed'){
        alert_slack('Failed OATI API call; ffr_test.js; WebDNA response: capactiy event request failed');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Unable to fulfill capacity event request",
          "eventTime": new Date().toISOString(),
          "objectId":zone
        });
        next();
      } else if (!res.headersSent){
        var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/run_get_forecast.sh oati ' + zone;
        exec(refresh_forecast_command, function(err,get_forecast_stdout){
          if(err){
            console.log(err);
            alert_slack('API error; ffr_test.js; Unable to refresh forecast');
          }
          if (!res.headersSent){
            console.log('Updating forecast... ');
            res.status(200).json(json);
          }
          setTimeout(function(){
            var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_ffr_forecast.sh oati ' + zone;
            exec(send_ffr_forecast_command, function(ffrerr,ffrstdout){
              if(ffrerr){
                console.log(ffrerr);
                alert_slack('API error; ffr_test.js; Unable to send ffr forecast');
                next();
              }
              console.log('Updated ffr forecast sent to OATI');
              next();
            });
          },30000);
          setTimeout(function(){
            var send_build_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_build_forecast.sh oati ' + zone;
            exec(send_build_forecast_command, function(builderr,stdout){
              if(builderr){
                console.log(builderr);
                alert_slack('API error; ffr_test.js; Unable to send build forecast');
                next();
              }
              console.log('Updated build forecast sent to OATI');
              next();
            });
          },30000);
          setTimeout(function(){
            var send_reduction_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_reduction_forecast.sh oati ' + zone;
            exec(send_reduction_forecast_command, function(reductionerr,stdout){
              if(reductionerr){
                console.log(reductionerr);
                alert_slack('API error; ffr_test.js; Unable to send reduction forecast');
                next();
              }
              console.log('Updated Reduction forecast sent to OATI');
              next();
            });
          },30000);
        });
      }
    }).message;
}

function writeFFRTestFile(zone, start, end){
  var logstream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/telemetry/ffr/ffr_test_schedule.db', {'flags': 'a'});
  logstream.write('\n' + zone + '\t' + start + '\t' + end);
  logstream.end();
}

function alert_slack(string){
  // alert slack
  var json = {
    "text": 'TEST'+string
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