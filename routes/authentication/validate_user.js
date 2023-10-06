const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

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
  var XMLString = '<root><method>validate_user</method><email>' + email + 
      '</email><password>' + password + '</password></root>';
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
  return decryption;
  //console.log("decryption:\n" + decryption + "\n");
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

function is_valid_json(req, res) {
  if (!req.body.root.user.email || !req.body.root.user.password){
    res.status(400).json({
      error: 'Email and password required'
    });
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
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
      var json;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        console.log(stdout);
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }*/
      try {
        json = JSON.parse(stdout);
        //json = JSON.parse(decryption);
      } catch (err) {
        log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } 
      if (json && error !== null) {
        log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      } else if (!res.headersSent && json && json.message === 'valid') {
        res.status(200).json({
          response_format: 'json',
          message: 'Login successful.',
          user: {
            email: req.body.root.user.email
          }
        });
      } else if (!res.headersSent && json) {
        log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
        res.status(409).json({
          error: 'Authentication invalid'
        });
      } else if (!res.headersSent){
        log(null, 'user: ' + req.body.root.user.email + ' endpoint unavailable. check logs')
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    }).message;
  }  
}

function log(err, alert_string){
  console.log(err);
  alert_slack('API validate_user ' + alert_string);
}

function is_valid_xml(req, res) {
  res.type('application/xml');
  if (!req.body.root.user.email || !req.body.root.user.password){
    res.status(400);
    res.send('<error>Email and password required</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
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
      var json;
      var decryption;
      /*try {
        decryption = decrypt(stdout);
      } catch (err) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }*/
      try {
        json = JSON.parse(stdout);
        //json = JSON.parse(decryption);
      } catch (err) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      } 
      if (!res.headersSent && json && error !== null) {
        console.log('exec error: ' + error);
      } else if (json && json.message === 'valid') {
        res.status(200);
        res.send(
          '<root><response_format>xml</response_format><message>Login successful</message>' + 
          '<user><email>'+req.body.root.user.email+'</email></user></root>'
        );
      } else if (!res.headersSent && json) {
        res.status(409);
        res.send('<error>Authentication invalid</error>');
      } else if (!res.headersSent) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
    }).message;
  }
}

// POST
router.post("/", (req, res, next) => {
  var response_format;
  response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
    } else {
      is_valid_xml(req, res);
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
      is_valid_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;