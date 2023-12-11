const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

/*
  
  this was copied from get_response_in_group
  need to fix --> change all "group" to "api_id" where fitting

*/


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
function encrypt(email, password, api_id) {
  var XMLString = '<root><method>get_device_info</method><email>' + email + 
      "</email><password>" + password + "</password><api_id>" + api_id + "</api_id></root>";
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

// checks for white space
function has_whitespace(entry) {
  if(entry.includes(" ")) {
    return true;
  } else {
    return false;
  }
}

function get_device_info_json(req, res) {
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
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else if (!String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400).json({
      error: 'Invalid api_id'
    });
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.api_id);
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
      // console.log(stdout);
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
        log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
        console.log('exec error: ' + error);
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } else if (response && response.message == 'invalid') {
        console.log('API get_device_info user: ' + req.body.root.user.email + ' authentication invalid')
        res.status(401).json({
          error: 'Authentication invalid'
        });
      } else if (response && response.error && response.error == 'Device unavailable') {
        log(null, 'user: ' + req.body.root.user.email + ' device unavailable: ' + req.body.root.api_id)
        res.status(409).json({
          message: 'Device unavailable'
        });
      } else if (response && response.message == 'Not Authorized') {
        log(null, 'user: ' + req.body.root.user.email + ' not authorized for device: ' + req.body.root.api_id)
        res.status(409).json({
          message: 'Not authorized'
        });
      } else if (!res.headersSent && response){
        res.status(201).json({
          response_format: 'json',
          message: response
        });
      } else if(!res.headersSent) {
        log(null, 'user: ' + req.body.root.user.email + ' endpoint unavailable. check logs')
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    });
  }
}

function get_device_info_xml(req, res) {
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
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else if (!String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400);
    res.send('<error>Invalid api_id</error>');
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.api_id);
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
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
      // Input validation
      if (response && error !== null) {
        console.log('exec error: ' + error);
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      } else if (response && response.message == 'invalid') {
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
      } else {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
    });
  }
}

function log(err, alert_string){
  console.log(err);
  alert_slack('API get_device_info ' + alert_string);
}

// POST
router.post('/', (req, res, next) => {
  var valid = true; // what is this...?
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
    } else {
      get_device_info_xml(req, res);
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else {
        get_device_info_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;