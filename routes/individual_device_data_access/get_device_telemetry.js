const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');


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
function encrypt(email, password, api_id, local_start_date, local_end_date) {
  var XMLString = '<root><method>get_device_telemetry</method><email>' + email + 
      "</email><password>" + password + "</password><api_id>" + api_id + "</api_id><local_start_date>" + local_start_date + 
      "</local_start_date><local_end_date>" + local_end_date + "</local_end_date></root>";
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(XMLString), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
}

// Decrypt data
function decrypt(encryption) {
  var decipher = crypto.createDecipheriv('bf-ecb','2W^a9@kj', '');
  decipher.setAutoPadding(false);
  var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');
  return decryption;
  // console.log("decryption:\n" + decryption + "\n");
}

// checks if email is in correct format
function validate_email(email) {
  var format = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof email == 'object') {
    return 'Duplicate fields';
  } else if (typeof email !== 'string') {
    return 'Invalid email format';
  } else { 
    return format.test(email) ? 'valid' : 'Invalid email format';
  }
}

// validates date format
function validate_date(date) {
  re = /^\d{4}\-\d{2}\-\d{2}$/;
  if (typeof date == 'object') {
    return 'Duplicate fields'
  } else if (typeof date != "string") {
    return 'Invalid date format. Dates must include quotation marks'
  } else {
    var fields = date.split('-');
    if (date.match(re)) {
      // limit month to 1-12
      if(fields[1] < 1 || fields[1] > 12) {
        return 'Invalid value for month';
      }
      // limit day 1-31
      if (fields[2] < 1 || fields[2] > 31) {
        return 'Invalid value for day';
      } else {
        return 'valid';
      }
    } else {
      return 'Invalid date format. Use: yyyy-mm-dd';
    }
  }
}

// checks for white space
function has_whitespace(entry) {
  if(entry.includes(" ")) {
    return true;
  } else {
    return false;
  }
}

function get_device_telemetry_json(req, res) {
  if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.root.user.email)
    });
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.user.api_id == "object") {
    //  duplicate passwords, api_id
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
  } else if (validate_date(req.body.root.local_start_date) !== 'valid') {
    res.status(400).json({
      error: "Start date: " + validate_date(req.body.root.local_start_date)
    });
  } else if (validate_date(req.body.root.local_end_date) !== 'valid') {
    res.status(400).json({
      error: "End date: " + validate_date(req.body.root.local_end_date)
    });
  } else if (new Date(req.body.root.local_start_date) > new Date(req.body.root.local_end_date)) {
    res.status(400).json({
      error: "Start date must precede end date or be the same"
    });
  } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 345600000) {
    res.status(400).json({
      error: "End date must be within 4 days of start date"
    });
  } else if (new Date(req.body.root.local_start_date) - new Date() > 0) {
    res.status(400).json({
      error: "Start date must be historical or current"
    });
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else if (!String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400).json({
      error: 'Invalid api_id'
    });
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.api_id, req.body.root.local_start_date, req.body.root.local_end_date);
    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var response;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }*/
      try {
        response = JSON.parse(stdout);
        //response = JSON.parse(decryption);
      } catch (err) {
        console.log(stdout);
        console.log('user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
      if (response && error !== null) {
        alert_slack('get_device_telemetry exec error: ' + error);
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } else if (response && response.message == 'invalid') {
        console.log(encryption)
        console.log(JSON.stringify(response,null,2))
        res.status(401).json({
          error: 'Authentication invalid'
        });
      } else if (response && response.message == 'Device unavailable') {
        res.status(409).json({
          message: 'Device unavailable'
        });
      } else if (response && response.message == 'Not Authorized') {
        res.status(409).json({
          message: 'Not authorized'
        });
      } else if (!res.headersSent && response){
        res.status(201).json({
          response_format: 'json',
          message: response
        });
      } else if (!res.headersSent) {
        alert_slack('get_device_telemetry: error in WebDNA response');
        // console.log(response);
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    });
  }
}

function get_device_telemetry_xml(req, res) {
  res.type('application/xml');
  if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400);
    res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.api_id == "object") {
    //  duplicate passwords, api_id, increments
    res.status(400);
    res.send('<error>Duplicate fields</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
  } else if (validate_date(req.body.root.local_start_date) !== 'valid') {
    res.status(400)
    res.send('<error>Start date: ' + validate_date(req.body.root.local_start_date) + '</error>');
  } else if (validate_date(req.body.root.local_end_date) !== 'valid') {
    res.status(400)
    res.send('<error>End date: ' + validate_date(req.body.root.local_end_date) + '</error>');
  } else if (new Date(req.body.root.local_start_date) > new Date(req.body.root.local_end_date)) {
    res.status(400)
    res.send('<error>Start date must precede end date or be the same</error>');
  } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 345600000) {
    res.status(400)
    res.send('<error>End date must be within 4 days of start date</error>');
  } else if (new Date(req.body.root.local_start_date) - new Date() > 0) {
    res.status(400)
    res.send('<error>Start date must be historical or current</error>');
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else if (!String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400);
    res.send('<error>Invalid api_id</error>');
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.api_id, req.body.root.local_start_date, req.body.root.local_end_date);
    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var response;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }*/
      try {
        response = JSON.parse(stdout);
        //response = JSON.parse(decryption);
      } catch (err) {
        alert_slack(err);
        console.log(stdout);
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>' + stdout);
      }
      // Input validation
      if (response && error !== null) {
        alert_slack('get_device_telemetry exec error: ' + err);
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      } else if (response && response.message == 'invalid') {
        alert_slack('Authentication invalid');
        res.status(401);
        res.send('<error>Authentication invalid</error>');
      } else if (response && response.message == 'Device unavailable') {
        res.status(409);
        res.send('<error>Device unavailable</error>');
      } else if (response && response.message == 'Not Authorized') {
        res.status(409);
        res.send('<error>Not authorized</error>');
      } else if (response){
        res.status(201);
        res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',response).replace('<?xml version=\'1.0\'?>','') + '</root>');
      } else if (!res.headersSent){
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
    });
  }
}

function alert_slack(string){
  console.log('get_device_telemetry error: ' + string);
  // alert slack
  var json = {
    "text": 'API: get_device_telemetry error: ' + string
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

// POST
router.post('/', (req, res, next) => {
  var valid = true; // what is this...?
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id || !req.body.root.local_start_date || !req.body.root.local_end_date) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>');
    } else {
      get_device_telemetry_xml(req, res);
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id || !req.body.root.local_start_date || !req.body.root.local_end_date) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else {
        get_device_telemetry_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;