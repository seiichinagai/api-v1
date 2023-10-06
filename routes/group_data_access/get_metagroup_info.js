const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const j2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

function log(err, alert_string){
  console.log(err);
  alert_slack('API get_metagroup_info ' + alert_string);
}

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
function encrypt(email, password) {
  var XMLString = '<root><method>get_metagroup_info</method><email>' + email + 
      '</email><password>' + password + '</password></root>';
      // console.log(XMLString);
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(XMLString), 'utf8', 'hex') + cipher.final('hex');
  
  return encryption;
}

// Decrypt data, mostly used for testing
function decrypt(encryption) {
  var decipher = crypto.createDecipheriv('bf-ecb','2W^a9@kj', '');
  decipher.setAutoPadding(false);
  var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');

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

function get_all_project_info_json(req, res) {
  if (typeof req.body.root.user.password == "object") { //  duplicate passwords
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
  } else if (!req.body.root.user.email || !req.body.root.user.password){
    res.status(400).json({
      error: 'Email and password required'
    });
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.root.user.email)
    });
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password);
    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var project_info;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }*/
      try {
        project_info = JSON.parse(stdout);
        //project_info = JSON.parse(decryption);
      } catch (err) {
        console.log(stdout);
        log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } 
      if (!res.headersSent && project_info && error !== null) {
        log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
        console.log('exec error: ' + error);
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } else if (!res.headersSent && project_info && project_info.message == 'Project information unavailable') {
        log(null, ' project info unavailable for user: ' + req.body.root.user.email)
        res.status(503).json({
          message: 'Project information unavailable'
        });
      } else if (!res.headersSent && project_info && project_info.message === 'invalid') {
        log(null, 'user: ' + req.body.root.user.email + ' authentication invalid.')
        res.status(401).json({
          error: 'Invalid email or password'
        });
      } else if (!res.headersSent && project_info) {
        res.status(201).json({
          response_format: 'json',
          message: project_info
        });
      } else if(!res.headersSent){
        log(null, 'user: ' + req.body.root.user.email + ' endpoint down. check logs')
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    }).message;
  }
  
}

function get_all_project_info_xml(req, res) {
  res.type('application/xml');
  if (typeof req.body.root.user.password == "object") { //  duplicate passwords
    res.status(400);
    res.send('<error>Duplicate fields</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
  } else if (!req.body.root.user.email || !req.body.root.user.password){
    res.status(400);
    res.send('<error>Email and password required</error>');
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400);
    res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password);
    exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var project_info;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }*/
      try {
        project_info = JSON.parse(stdout);
        //project_info = JSON.parse(decryption);
      } catch (err) {
        console.log(err);
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      } 
      if (!res.headersSent && project_info && error !== null) {
        console.log('exec error: ' + error);
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      } else if (!res.headersSent && project_info && project_info.message == 'Project information unavailable') {
        res.status(503);
        res.send('<error>Project information unavailable</error>');
      } else if (!res.headersSent && project_info && project_info.message === 'invalid') {
        res.status(401);
        res.send('<error>Invalid email or password</error>');
      } else if (!res.headersSent && project_info) {
        res.status(201);
        res.send('<root><response_format>xml</response_format>' + j2xml.parse('message',project_info).replace('<?xml version=\'1.0\'?>','') + '</root>');
      } else if (!res.headersSent){
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
    }).message;
  }
}

// handles actual POST
router.post('/', (req, res, next) => {
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
    } else {
      get_all_project_info_xml(req, res);
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else {
      get_all_project_info_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;