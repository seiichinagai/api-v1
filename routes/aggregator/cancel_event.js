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

  console.log(JSON.stringify(req.body,null,2));
  
  if (!req.headers['content-length']){return next(createError(411, 'Content length required'));}
  if (req.headers['content-type'] != "application/json") {
    alert_slack('Failed API call; cancel_event.js; Invalid Content-Type header, ' + login);
    return next(createError(400, 'Invalid Content-Type header'));
  }
  if (login == "oati_api" && password == "LO$fk59#u@7M"){
    console.log('Receiving cancelEvent from oati');
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
    var xmlString = '<root><method>cancel_metagroup_event</method><source>HECO GSDS</source><email>' + email + '</email><password>' + pw
      + '</password><EventId>'+cancelevent['CancelEvent'][0]['EventId']+'</EventId></root>';
    var encryption = encrypt(xmlString)
    forward(encryption, messageId, req, res, next, cancelevent['CancelEvent'][0]['Zone']);
    alert_slack_activity('OATI requesting Cancel Event\n' + JSON.stringify(cancelevent['CancelEvent'][0]));
    // res.status(400).json({
    //   "returnResult": xmlString
    // });
    // res.next();
  }
}

function validate(cancelevent, req, res, next, messageId){
  var result = true;
  cancelevent['CancelEvent'].forEach(function(event){
    if(!event['Zone'] || (event['Zone']!='OATI_Oahu' && event['Zone']!='OATI_Maui' && event['Zone']!='OATI_Oahu_Test' && event['Zone']!='OATI_Mg_Test' && event['Zone']!='OATI_Maui_Test') || !event['CustomerType'] || !event['GridService'] || (event['GridService']!='Capacity Build Aggregator' && event['GridService']!='Capacity Reduction Aggregator')){
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

function forward(encryption, event_id, req, res, next, zone){
  console.log(new Date().toISOString())
  exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      console.log('received response');
      var json;
      var decryption;
      try {
        json = JSON.parse(stdout);
      } catch (err) {
        console.log('Error parsing WebDNA response:\n' + stdout)
        alert_slack('Failed OATI API call; cancel_event.js; Error parsing WebDNA response');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable.",
          "eventTime": new Date().toISOString(),
          "objectId":event_id
        });
        next();
      }
      if (json && error !== null) {
        alert_slack('Failed OATI API call; cancel_event.js; exec error');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Service temporarily unavailable..",
          "eventTime": new Date().toISOString(),
          "objectId":event_id
        });
        next();
      } else if (!res.headersSent && json && json.message === 'invalid'){
        alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: invalid');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Internal server error",
          "eventTime": new Date().toISOString(),
          "objectId":event_id
        });
        next();
      } else if (!res.headersSent && json && json.message === 'id not found'){
        alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: Load shift id not found');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Load shift id not found",
          "eventTime": new Date().toISOString(),
          "objectId":event_id
        });
        next();
      } else if (!res.headersSent && json && json.message === 'cancel event request failed'){
        alert_slack('Failed OATI API call; cancel_event.js; WebDNA response: cancel_event request failed');
        res.status(503).json({
          "returnResult": false,
          "returnReason": "Unable to fulfill cancel event request",
          "eventTime": new Date().toISOString(),
          "objectId":event_id
        });
        next();
      } else if (!res.headersSent && (zone == 'OATI_Oahu' || zone == 'OATI_Maui')){
        // retrieve new forecast
        // refresh forecast
        var refresh_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/run_get_forecast.sh oati ' + zone;
        exec(refresh_forecast_command, function(err,get_forecast_stdout){
          if(err){
            alert_slack('API error; cancel_event.js; Unable to refresh forecast');
            console.log(err);
          }
          if (!res.headersSent){
            console.log('Updating forecast... ');
            res.status(200).json(json);
          }
          if(zone == 'OATI_Oahu'){
            setTimeout(function(){
              var send_ffr_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_ffr_forecast.sh oati ' + zone;
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
            var send_build_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_build_forecast.sh oati ' + zone;
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
            var send_reduction_forecast_command = '/var/www/html/api.shiftedenergy.com/scripts/send_reduction_forecast.sh oati ' + zone;
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
        res.status(200).json(json);
      } 
    }).message;
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