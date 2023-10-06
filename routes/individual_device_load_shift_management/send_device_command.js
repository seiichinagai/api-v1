const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;
const alert_slack_activity = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack_activity;

// Deals with padding to 8 bytes
function pad(text) {
   pad_bytes = 8 - (text.length % 8)
   for (var x=1; x<=pad_bytes;x++)
     text = text + String.fromCharCode(0)
   return text;
 }

/*

  TO DO: 
  1. set up AG api token refresh on API server
  2. upon receiving 'Authorized' from Olin, send command to device
    a. wait for response from device
    b. parse response and send 'success' or 'fail'
  3. upon success response from device, send Olin values to log

*/

// Converts data received from user to XML format
// Encrypts and returns entire XML string
// Encryption may add on a few chars for padding but ignore anything after </root>
// I only send Olin credentials and api_id so he can validate
function encrypt(email, password, api_id) {
  var XMLString = '<root><method>authorize_client_device</method><email>' + email + 
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

// POST
router.post('/', (req, res, next) => {
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!res.headersSent && !req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id || !req.body.root.command || !req.body.root.duration) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
      return next();
    } else {
      get_authorization_xml(req, res, next);
    }
  } else if (!res.headersSent && response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
        return next();
  } else if (!res.headersSent && response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.api_id || !req.body.root.command || !req.body.root.duration) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
        return next();
    } else {
      get_authorization_json(req, res, next);
    }
  } else if (!res.headersSent){
    res.status(400).json({
      error: 'Invalid request'
    });
        return next();
  }
});

function get_authorization_json(req, res, next) {
  if (!res.headersSent && validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.root.user.email)
    });
    return next();
  } else if (!res.headersSent && typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
    return next();
  } 
  // else if (!res.headersSent && has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
  //   res.status(400).json({
  //     error: 'Remove all whitespace from body'
  //   });
  //   return next();
  // } else if (!res.headersSent && req.body.root.limit && has_whitespace(req.body.root.limit)){
  //   res.status(400).json({
  //     error: 'Remove all whitespace from body'
  //   });
  //   return next()
  // } 
  else if (!res.headersSent && !String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400).json({
      error: 'Invalid api_id'
    });
    return next();
  } else if (!res.headersSent && !(req.body.root.command == "limit" ) && !(req.body.root.command == "off_for")) {
    res.status(400).json({
      error: 'Invalid command, only limit or off_for allowed'
    });
    return next();
  } else if (!res.headersSent && req.body.root.command == "limit" && (!req.body.root.limit && req.body.root.limit != 0)) {
    res.status(400).json({
      error: 'Missing required field, limit command requires limit value'
    });
    return next();
  } else if (!res.headersSent && (!String(req.body.root.duration).match("^[0-9]+$") || parseInt(req.body.root.duration)<=0)) {
    res.status(400).json({
      error: 'Invalid duration value'
    });
    return next();
  } else if (!res.headersSent && req.body.root.limit && (!String(req.body.root.limit).match("^[0-9]+$") || parseInt(req.body.root.limit)<=0)) {
    res.status(400).json({
      error: 'Invalid limit value'
    });
    return next();
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
      try {
        response = JSON.parse(stdout);
        //response = JSON.parse(decryption);
      } catch (err) {
        log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
        res.status(503).json({
          error: 'Service temporarily unavailable' // it's getting hung up here
        });
        return next();
      }
      if (response && error !== null) {
        log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
        return next();
      } else if (response && response.message == 'invalid') {
        log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
        res.status(401).json({
          error: 'Authentication invalid'
        });
        return next();
      } else if (response && response.error == 'Device unavailable') {
        log(null, 'user: ' + req.body.root.user.email + ' device unavailable: ' + req.body.root.api_id)
        res.status(409).json({
          message: 'Device unavailable'
        });
        return next();
      } else if (response && response.message == 'Not Authorized') {
        log(null, 'user: ' + req.body.root.user.email + ' not authorized for device: ' + req.body.root.api_id)
        res.status(409).json({
          message: 'Not authorized'
        });
        return next();
      } else if (!res.headersSent && response && response.message == 'valid'){
        fs.readFile("/var/www/html/api.shiftedenergy.com/reference/ag_token_v2.db", "utf8", function(err, stdout) {
          var token = stdout.replace(/\n$/, '');
          send_device_command_json(req, res, next, token);
        });
      } else {
        log(null, 'user: ' + req.body.root.user.email + ' endpoint unavailable. check logs')
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
        return next();
      }
    });
  }
}

function get_authorization_xml(req, res,next) {
  res.type('application/xml');
  if (!res.headersSent && validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400);
    res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
        return next();
  } else if (!res.headersSent && typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
        return next();
  } else if (!res.headersSent && has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.api_id)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
        return next();
  } else if (!res.headersSent && req.body.root.limit && has_whitespace(req.body.root.limit)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
        return next();
  } else if (!res.headersSent && !String(req.body.root.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400);
    res.send('<error>Invalid api_id</error>');
        return next();
  } else if (!res.headersSent && !(req.body.root.command == "limit" ) && !(req.body.root.command == "off_for")) {
    res.status(400);
    res.send('<error>Invalid command, only limit or off_for allowed</error>');
        return next();
  } else if (!res.headersSent && req.body.root.command == "limit" && !req.body.root.limit) {
    res.status(400);
    res.send('<error>Missing required field, limit command requires limit value</error>');
        return next();
  } else if (!res.headersSent && (!String(req.body.root.duration).match("^[0-9]+$") || parseInt(req.body.root.duration)<=0)) {
    res.status(400);
    res.send('<error>Invalid duration value</error>');
        return next();
  } else if (!res.headersSent && req.body.root.limit && (!String(req.body.root.limit).match("^[0-9]+$") || parseInt(req.body.root.limit)<=0)) {
    res.status(400);
    res.send('<error>Invalid limit value</error>');
        return next();
  } else {
    var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.api_id, req.body.root.command, req.body.root.duration, req.body.root.limit);
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
        log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }
      // Input validation
      if (!res.headersSent && response && error !== null) {
        log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
        return next();
      } else if (!res.headersSent && response && response.message == 'invalid') {
        log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
        console.log(new Date().toISOString() + '\tAuthentication invalid');
        res.status(401);
        res.send('<error>Authentication invalid</error>');
        return next();
      } else if (!res.headersSent && response && response.error == 'Device unavailable') {
        log(null, 'user: ' + req.body.root.user.email + ' device unavailable: ' + req.body.root.api_id)
        console.log(new Date().toISOString() + '\tDevice unavailable');
        res.status(409);
        res.send('<error>Device unavailable</error>');
        return next();
      } else if (!res.headersSent && response && response.message == 'Not Authorized') {
        log(null, 'user: ' + req.body.root.user.email + ' aot authorized for device: ' + req.body.root.api_id)
        console.log(new Date().toISOString() + '\tNot Authorized');
        res.status(409);
        res.send('<error>Not authorized</error>');
        return next();
      } else if (!res.headersSent && response && response.message == 'valid'){
        fs.readFile("/var/www/html/api.shiftedenergy.com/reference/ag_token_v2.db", "utf8", function(err, stdout) {
          var token = stdout.replace(/\n$/, '');
          send_device_command_xml(req, res, next, token);
        });
      } else if (!res.headersSent){
        log(new Date().toISOString() + '\tsend_device_command error', 'user: ' + req.body.root.user.email + ' endpoint unavailable. check logs')
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
        return next();
      }
    });
  }
}

function send_device_command_json(req, res, next, token){
  switch (req.body.root.command) {
    case 'off_for':
      var execute_command = 'sh /var/www/html/api.shiftedenergy.com/scripts/off_for_v2.sh ' + req.body.root.api_id + ' ' + token + ' ' + req.body.root.duration;
      exec(execute_command,function(off_for_err, off_for_res){
        try {
          if (JSON.parse(off_for_res)['codes'] > 0){
            alert_slack_activity('off_for successful ' + req.body.root.api_id + ' user: ' + req.body.root.user.email)
            res.status(200).json({
              response_format: 'json',
              message: 'Call successful'
            });
            sendLogs(req, res, next, true);
            return next();
          } else {
            log(null, 'off_for request failed. Device unreachable ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
            res.status(400).json({
              message: 'Unable to reach device'
            });
            sendLogs(req, res, next, false);
            return next();
          }
        } catch (response_err){
          log(null, 'off_for request failed. Check logs. ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
          res.status(400).json({
            message: 'Unable to reach device'
          });
          sendLogs(req, res, next, false);
          return next();
        }
      })
    break;
    case 'limit':
      var execute_command = 'sh /var/www/html/api.shiftedenergy.com/scripts/limit_v2.sh ' + req.body.root.api_id + ' ' + token + ' ' + req.body.root.limit + ' ' + req.body.root.duration;
      exec(execute_command,function(off_for_err, off_for_res){
        try {
          if (JSON.parse(off_for_res)['codes'] > 0){
            alert_slack_activity('limit successful ' + req.body.root.api_id + ' user: ' + req.body.root.user.email)
            res.status(200).json({
              response_format: 'json',
              message: 'Call successful'
            });
            sendLogs(req, res, next, true);
            return next();
          } else {
            log(null, 'limit request failed. Device unreachable ' + req.body.root.api_id + ' user: ' + req.body.root.user.email + ' limit: ' + req.body.root.limit);
            res.status(400).json({
              message: 'Device unavailable'
            });
            sendLogs(req, res, next, false);
            return next();
          }
        } catch (response_err){
          log(null, 'limit request failed. Check logs. ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
          res.status(400).json({
            message: 'Device unavailable'
          });
          sendLogs(req, res, next, false);
          return next();
        }
      })
    break;
  }
}

function send_device_command_xml(req, res, next, token) {
  switch (req.body.root.command) {
    case 'off_for':
      var execute_command = 'sh /var/www/html/api.shiftedenergy.com/scripts/off_for_v2.sh ' + req.body.root.api_id + ' ' + token + ' ' + req.body.root.duration;
      exec(execute_command,function(off_for_err, off_for_res){
        try {
          if (JSON.parse(off_for_res)['codes'] > 0){
            alert_slack_activity('off_for successful ' + req.body.root.api_id + ' user: ' + req.body.root.user.email)
            res.status(200);
            res.send('<response_format>xml</response_format><message>Call successful</message>');
            sendLogs(req, res, next, true);
            return next();
          } else {
            log(null, 'off_for request failed. Device unreachable ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
            res.status(503);
            res.send('<error>Device unavailable</error>');
            sendLogs(req, res, next, false);
            return next();
          }
        } catch (response_err){
          log(null, 'off_for request failed. Check logs. ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
          res.status(503);
          res.send('<error>Device unavailable</error>');
          sendLogs(req, res, next, false);
          return next();
        }
      })
    break;
    case 'limit':
      var execute_command = 'sh /var/www/html/api.shiftedenergy.com/scripts/limit_v2.sh ' + req.body.root.api_id + ' ' + token + ' ' + req.body.root.limit + ' ' + req.body.root.duration;
      exec(execute_command,function(off_for_err, off_for_res){
        try {
          if (JSON.parse(off_for_res)['codes'] > 0){
            alert_slack_activity('limit successful ' + req.body.root.api_id + ' user: ' + req.body.root.user.email)
            res.status(200);
            res.send('<response_format>xml</response_format><message>Call successful</message>');
            sendLogs(req, res, next, true);
            return next();
          } else {
            log(null, 'limit request failed. Device unreachable ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
            res.status(503);
            res.send('<error>Unable to reach device</error>');
            sendLogs(req, res, next, false);
            return next();
          }
        } catch (response_err){
          log(null, 'limit request failed. Check logs. ' + req.body.root.api_id + ' user: ' + req.body.root.user.email);
          res.status(503);
          res.send('<error>Unable to reach device</error>');
          sendLogs(req, res, next, false);
          return next();
        }
      })
    break;
  }
}

function log(err, alert_string){
  console.log(err);
  alert_slack('API send_device_command ' + alert_string);
}

function sendLogs(req, res, next, actuated){
  var xml_string
  switch (req.body.root.command) {
    case 'off_for':
      xml_string = '<root><method>log_api_call</method><email>' + req.body.root.user.email + "</email><password>" + 
        req.body.root.user.password + "</password><api_id>" + req.body.root.api_id + "</api_id><command>" + 
        req.body.root.command + "</command><duration>" + req.body.root.duration + "</duration><actuated>" + actuated + "</actuated></root>";
    break;
    case 'limit':
      xml_string = '<root><method>log_api_call</method><email>' + req.body.root.user.email + "</email><password>" + 
        req.body.root.user.password + "</password><api_id>" + req.body.root.api_id + "</api_id><command>" + 
        req.body.root.command + "</command><duration>" + req.body.root.duration + "</duration><limit>" + 
        req.body.root.limit + "</limit><actuated>" + actuated + "</actuated></root>";
    break;
  }
  var command = 'sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh ' + '"' + encrypt_logs(xml_string) + '"';
  exec(command, function(err, stdout){
    if(err){
      console.log(err)
    }
    else {
      var stream = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/logs/device_command_sent.log', {flags:'a'});
      stream.write(stdout);
      stream.end();
    }
  });
}

function encrypt_logs(xml_string) {
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(xml_string), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
}

module.exports = router;