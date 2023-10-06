const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

function log(err, alert_string){
  console.log(err);
  alert_slack(' API get_load_shift_event_details ' + alert_string);
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
function encrypt(email, password, ls_number, response_format) {
  var XMLString = '<root><format>' + response_format + '</format><method>get_load_shift_event_details</method><email>' + email + 
      "</email><password>" + password + "</password><load_shift_event_id>" + ls_number + "</load_shift_event_id></root>";
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

function get_load_shift_event_details_json(req, res) {
  // var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503).json({
  //     error: 'Service temporarily unavailable'
  //   });
  // }
  // else
  if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.load_shift_event_id){
    res.status(400).json({
      error: 'Missing required field(s)'
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
  } else if (!String(req.body.root.load_shift_event_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.load_shift_event_id))) {
    res.status(400).json({
      error: 'Invalid load_shift_event_id'
    });
  } else {
    // for (var i = 0; i < projects.length; i++) {
    //   if (projects[i].projectID == req.body.root.group && !res.headersSent) {
    //     found = true;
        var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.load_shift_event_id, 'json');
        exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var event_details;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }*/
            try {
              event_details = JSON.parse(stdout);
              //event_details = JSON.parse(decryption);
            } catch (err) {
              log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }
            if (event_details && error !== null) {
              log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            } else if (event_details && event_details.message == 'invalid') {
              log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
              res.status(401).json({
                error: 'Authentication invalid'
              });
            } else if (event_details && event_details.message == 'Load shift details unavailable') {
              log(null, 'user: ' + req.body.root.user.email + ' load shift details unavailable')
              res.status(409).json({
                message: 'Load shift details unavailable'
              });
            } else if (event_details && event_details.message == 'Not Authorized') {
              log(null, 'user: ' + req.body.root.user.email + ' Not authorized')
              res.status(409).json({
                message: 'Not authorized'
              });
            } else if (event_details){
              res.status(201).json({
                response_format: 'json',
                message: event_details
              });
            } else {
              log(null, 'user: ' + req.body.root.user.email + ' endpoint down. check logs')
                res.status(503).json({
                  error: 'Service temporarily unavailable'
                });
              }
          });
    //   }
    // }
    // if (!found && !res.headersSent) {
    //   res.status(400).json({
    //     error: 'Group unavailable'
    //   });
    // }
  }
}

function get_load_shift_event_details_xml(req, res) {
  res.type('application/xml');
  // var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503);
  //   res.send('<error>Service temporarily unavailable</error>');
  // } else 
  if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.load_shift_event_id){
    res.status(400)
    res.send('<error>Missing required field(s)</error>');
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400);
    res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.load_shift_event_id)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else if (!String(req.body.root.load_shift_event_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.load_shift_event_id))) {
    res.status(400);
    res.send('<error>Invalid load_shift_event_id</error>');
  } else {
    // for (var i = 0; i < projects.length; i++) {
    //   if (projects[i].projectID == req.body.root.group) {
    //     found = true;
        var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.load_shift_event_id, 'xml');
        
        exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var event_details;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }*/
            try {
              event_details = JSON.parse(stdout);
              //event_details = JSON.parse(decryption);
            } catch (err) {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }
            // Input validation
            if (event_details && error !== null) {
              console.log('exec error: ' + error);
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            } else if (event_details && event_details.message == 'invalid') {
              res.status(401);
              res.send('<error>Authentication invalid</error>');
            } else if (event_details && event_details.message == 'Load shift details unavailable') {
              res.status(409);
              res.send('<error>Load shift details unavailable</error>');
            } else if (event_details && event_details.message == 'Not Authorized') {
              res.status(409);
              res.send('<error>Not authorized</error>');
            } else if (event_details){
              res.status(201);
              res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',event_details).replace('<?xml version=\'1.0\'?>','') + '</root>');
            } else {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }
          });
    //   }
    // }
    // if (!found && !res.headersSent) {
    //   res.status(400);
    //   res.send('<error>Group unavailable</error>');
    // }
  }
}

// POST
router.post('/', (req, res, next) => {
  var valid = true; // what is this...?
  var response_format = req.query['response_format'];
  if (valid) {
    if (response_format == 'xml'){
      if (!req.body.root || !req.body.root.user) {
        res.status(400);
        res.send('<error>Missing required field(s)</error>')
      } else {
        // var projects;
        // fs.readFile('/var/www/html/api.shiftedenergy.com/projects.db', 'utf8', function read(err, data) {
        //   if(err) {
        //     throw err;
        //   }
        //   try {
        //     projects = JSON.parse(data);
        //     get_load_shift_event_details_xml(req, res, projects);
        //   } catch (err) {
        //     console.log(err);
        //   }
        // });
        get_load_shift_event_details_xml(req, res);
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
        // var projects;
        // fs.readFile('/var/www/html/api.shiftedenergy.com/projects.db', 'utf8', function read(err, data) {
        //   if(err) {
        //     throw err;
        //   }
        //   try {
        //     projects = JSON.parse(data);
        //     get_load_shift_event_details_json(req, res, projects);
        //   } catch (err) {
        //     console.log(err);
        //   }
        // });
        get_load_shift_event_details_json(req, res);
      }
    } else {
      res.status(400).json({
        error: 'Invalid request'
      });
    }
  }
});

module.exports = router;