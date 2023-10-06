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
function encrypt(email, password, group, start_date, end_date) {
  var XMLString = '<root><method>get_ffr_group_report</method><email>' + email + "</email><password>" + password + 
  "</password><group>" + group + "</group><start_date>" + start_date + "</start_date><end_date>" + end_date + "</end_date></root>";
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

function get_ffr_group_report_json(req, res, projects) {
  var found = false;
  if(!projects){
    res.status(503).json({
      error: 'Service temporarily unavailable'
    });
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.root.user.email)
    });
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.user.group == "object" || typeof req.body.root.start_date == "object" || typeof req.body.root.end_date == "object") {
    //  duplicate passwords, groups
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
  } else if (validate_date(req.body.root.start_date) !== 'valid') {
    res.status(400).json({
      error: "Start date: " + validate_date(req.body.root.start_date)
    });
  } else if (validate_date(req.body.root.end_date) !== 'valid') {
    res.status(400).json({
      error: "End date: " + validate_date(req.body.root.end_date)
    });
  } else if (new Date(req.body.root.start_date) > new Date(req.body.root.end_date)) {
    res.status(400).json({
      error: "Start date must precede end date or be the same"
    });
  } else if (new Date(req.body.root.end_date) - new Date(req.body.root.start_date) > 2592000000) {
    res.status(400).json({
      error: "End date must be within 30 days of start date"
    });
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
    res.status(400).json({
      error: 'Invalid group'
    });
  } else {
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].projectID == req.body.root.group && !res.headersSent) {
        found = true;
        var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group, req.body.root.start_date , req.body.root.end_date);
        exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
        function (error, stdout, stderr) {
          var controllers;
          var decryption;
          /*try {
            decryption = decrypt(stdout);
          } catch (err) {
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          }*/
          try {
            controllers = JSON.parse(stdout);
            //controllers = JSON.parse(decryption);
          } catch (err) {
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          }
          if (controllers && error !== null) {
            console.log('exec error: ' + error);
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          } else if (controllers && controllers.message == 'invalid') {
            res.status(401).json({
              error: 'Authentication invalid'
            });
          } else if (controllers && controllers.message == 'Group unavailable') {
            res.status(409).json({
              message: 'Group unavailable'
            });
          } else if (controllers && controllers.message == 'Not Authorized') {
            res.status(409).json({
              message: 'Not authorized'
            });
          } else if (!res.headersSent && controllers){
            res.status(201).json({
              response_format: 'json',
              message: controllers
            });
          } else {
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          }
        });
      }
    }
    if (!found && !res.headersSent) {
      res.status(400).json({
        error: 'Group unavailable'
      });
    }
  }
}

function get_ffr_group_report_xml(req, res, projects) {
  var found = false;
  res.type('application/xml');
  if (!projects){ // executed if call is made to server just after server restart, before projects is loaded
    res.status(503);
    res.send('<error>Service temporarily unavailable</error>');
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400);
    res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object" || typeof req.body.root.start_date == "object" || typeof req.body.root.end_date == "object") {
    //  duplicate passwords, groups, increments
    res.status(400);
    res.send('<error>Duplicate fields</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
  } else if (validate_date(req.body.root.start_date) !== 'valid') {
    res.status(400)
    res.send('<error>Start date: ' + validate_date(req.body.root.start_date) + '</error>');
  } else if (validate_date(req.body.root.end_date) !== 'valid') {
    res.status(400)
    res.send('<error>End date: ' + validate_date(req.body.root.end_date) + '</error>');
  } else if (new Date(req.body.root.start_date) > new Date(req.body.root.end_date)) {
    res.status(400)
    res.send('<error>Start date must precede end date or be the same</error>');
  } else if (new Date(req.body.root.end_date) - new Date(req.body.root.start_date) > 2592000000) {
    res.status(400)
    res.send('<error>End date must be within 30 days of start date</error>');
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.group)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
    res.status(400);
    res.send('<error>Invalid group</error>');
  } else {
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].projectID == req.body.root.group) {
        found = true;
        var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group, req.body.root.start_date , req.body.root.end_date);
        exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
        function (error, stdout, stderr) {
          var controllers;
          var decryption;
          /*try {
            decryption = decrypt(stdout);
          } catch (err) {
            res.status(503);
            res.send('<error>Service temporarily unavailable</error>');
          }*/
          try {
            controllers = JSON.parse(stdout);
            //controllers = JSON.parse(decryption);
          } catch (err) {
            res.status(503);
            res.send('<error>Service temporarily unavailable</error>');
          }
          // Input validation
          if (controllers && error !== null) {
            console.log('exec error: ' + error);
            res.status(503);
            res.send('<error>Service temporarily unavailable</error>');
          } else if (controllers && controllers.message == 'invalid') {
            res.status(401);
            res.send('<error>Authentication invalid</error>');
          } else if (controllers && controllers.message == 'Group unavailable') {
            res.status(409);
            res.send('<error>Group unavailable</error>');
          } else if (controllers && controllers.message == 'Not Authorized') {
            res.status(409);
            res.send('<error>Not authorized</error>');
          } else if (controllers){
            res.status(201);
            res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',controllers).replace('<?xml version=\'1.0\'?>','') + '</root>');
          } else {
            res.status(503);
            res.send('<error>Service temporarily unavailable</error>');
          }
        });
      }
    }
    if (!found && !res.headersSent) {
      res.status(400);
      res.send('<error>Group unavailable</error>');
    }
  }
}

// POST
router.post('/', (req, res, next) => {
  var valid = true; // what is this...?
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.group || !req.body.root.start_date || !req.body.root.end_date) {
      res.status(400);
      res.send('<error>Missing required field(s)</error>')
    } else {
      var projects;
      fs.readFile('/var/www/html/api.shiftedenergy.com/projects.db', 'utf8', function read(err, data) {
        if(err) {
          throw err;
        }
        try {
          projects = JSON.parse(data);
          get_ffr_group_report_xml(req, res, projects);
        } catch (err) {
          console.log(err);
        }
      });
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root || !req.body.root.user || !req.body.root.user.email || !req.body.root.user.password || !req.body.root.group || !req.body.root.start_date || !req.body.root.end_date) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else {
      var projects;
      fs.readFile('/var/www/html/api.shiftedenergy.com/projects.db', 'utf8', function read(err, data) {
        if(err) {
          throw err;
        }
        try {
          projects = JSON.parse(data);
          get_ffr_group_report_json(req, res, projects);
        } catch (err) {
          console.log(err);
        }
      });
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;