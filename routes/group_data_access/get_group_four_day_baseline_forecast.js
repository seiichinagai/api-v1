const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');
const time = require('time');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

function log(err, alert_string){
  console.log(new Date().toISOString() + ' ' + err);
  alert_slack(' API get_group_four_day_baseline_forecast ' + alert_string);
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
function encrypt(email, password, date, group) {
  var XMLString = '<root><method>get_group_four_day_baseline_forecast</method><email>' + email + 
      "</email><password>" + password + "</password><requested_date>" +
      date + "</requested_date><group>" + group + "</group></root>";
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

// calls local get_forecast.sh script that POSTs to WebDNA server
function get_group_four_day_baseline_forecast_json(req, res) {
  var today = new Date();
  // var found = false;
  // if(!projects){
  //   res.status(503).json({
  //     error: 'Service temporarily unavailable'
  //   });
  // } else 
  if (typeof req.body.root.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object") { //  duplicate passwords, groups
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else if (validate_email(req.body.root.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.root.user.email)
    });
  } else if (validate_date(req.body.root.local_first_data_date) !== 'valid') {
    res.status(400).json({
      error: validate_date(req.body.root.local_first_data_date)
    });
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || 
      has_whitespace(req.body.root.local_first_data_date)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
    res.status(400).json({
      error: 'Invalid group'
    });
  } else {
    // for (var i = 0; i < projects.length; i++) {
    //   var localDate = new time.Date(req.body.root.local_first_data_date + 'T00:00', projects[i].timezone);
    //   if (projects[i].projectID == req.body.root.group && !res.headersSent) {
    //     if (projects[i].dateEnded) {
    //       res.status(400).json({
    //         error: 'Group unavailable'
    //       });
    //     } else if (new Date(projects[i].dateStarted) > localDate) { // make sure dateStarted is before buildStartDateLocal
    //       res.status(400).json({
    //         error: 'Invalid date. Group not opened'
    //       });
    //     } else {
          // found = true;
          // console.log(projects[i].dateEnded);
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.local_first_data_date, req.body.root.group);
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var baseline;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }*/
            try {
              baseline = JSON.parse(stdout);
              //baseline = JSON.parse(decryption);
            } catch (err) {
              log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
              res.status(503).json({
                error: 'Invalid POST body'
              });
            } 
            // Input validation
            if (baseline && error !== null) {
              log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            } else if (baseline && baseline.message == 'invalid') {
              log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
              res.status(401).json({
                error: 'Authentication invalid'
              });
            } else if (baseline && baseline.message == 'Forecast unavailable') {
              log(null, 'user: ' + req.body.root.user.email + ' forecast unavailable for group ' + req.body.root.group)
              // on forecast unavailable for date
              res.status(409).json({
                message: 'Forecast unavailable'
              });
            } else if (baseline && baseline.message == 'Group unavailable') {
              log(null, 'user: ' + req.body.root.user.email + ' group unavailable: ' + req.body.root.group)
              // on forecast unavailable for date
              res.status(409).json({
                message: 'Group unavailable'
              });
            } else if (baseline && baseline.message == 'Not Authorized') {
              log(null, 'user: ' + req.body.root.user.email + ' Not authorized for group ' + req.body.root.group)
              res.status(409).json({
                message: 'Not authorized'
              });
            } else if (baseline && !res.headersSent){
              res.status(201).json({
                response_format: 'json',
                message: baseline
              });
            } else {
              log(error, 'user: ' + req.body.root.user.email + ' endpoint down. check logs')
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }
          });
    //     }
        
    //   }
    // }
    // if (!found && !res.headersSent) {
    //   res.status(400).json({
    //     error: 'Group unavailable'
    //   });
    // }
  }
}

function get_group_four_day_baseline_forecast_xml(req, res) {
  var today = new Date();
  // var found = false;
  // res.type('application/xml');
  // if (!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503);
  //   res.send('<error>Service temporarily unavailable</error>');
  // } else if (validate_email(req.body.root.user.email) !== 'valid'){
  //   res.status(400);
  //   res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
  // } else 
  if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object") { //  duplicate passwords, groups
    res.status(400);
    res.send('<error>Duplicate fields</error>');
  } else if (typeof req.body.root.user.password != "string") {
    res.status(400);
    res.send('<error>Invalid password format</error>');
  } else if (validate_date(req.body.root.local_first_data_date) !== 'valid') {
    res.status(400)
    res.send('<error>' + validate_date(req.body.root.local_first_data_date) + '</error>');
  } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || 
      has_whitespace(req.body.root.local_first_data_date) || has_whitespace(req.body.root.group)){
    res.status(400);
    res.send('<error>Remove all whitespace from body</error>');
  } else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
    res.status(400);
    res.send('<error>Invalid group</error>');
  } else {
    // for (var i = 0; i < projects.length; i++) {
    //   var localDate = new time.Date(req.body.root.local_first_data_date + 'T00:00', projects[i].timezone);
    //   if (projects[i].projectID == req.body.root.group) {
    //     if (projects[i].dateEnded) {
    //       res.status(400);
    //       res.send('<error>Group unavailable</error>');
    //     } else if (new Date(projects[i].dateStarted) > localDate) { // make sure dateStarted is before buildStartDateLocal
    //       res.status(400);
    //       res.send('<error>Invalid date. Group not opened</error>');
    //     } else {
    //       found = true;
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.local_first_data_date, req.body.root.group);
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var baseline;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }*/
            try {
              baseline = JSON.parse(stdout);
              //baseline = JSON.parse(decryption);
            } catch (err) {
              if(!res.headersSent){
                res.status(503);
                res.send('<error>Invalid POST body</error>');
              }
            }
            if (!res.headersSent) {
              // Input validation
              if (baseline && error !== null) {
                console.log('exec error: ' + error);
                res.status(503);
                res.send('<error>Service temporarily unavailable</error>');
              } else if (baseline && baseline.message == 'invalid') {
                res.status(401);
                res.send('<error>Authentication invalid</error>');
              } else if (baseline && baseline.message == 'Forecast unavailable') {
                // on forecast unavailable for date
                res.status(409);
                res.send('<error>Forecast unavailable</error>');
              } else if (baseline && baseline.message == 'Group unavailable') {
                // on forecast unavailable for date
                res.status(409);
                res.send('<error>Group unavailable</error>');
              } else if (baseline && baseline.message == 'Not authorized') {
                res.status(409);
                res.send('<error>Not authorized</error>');
              } else if (baseline){
                res.status(201);
                res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',baseline).replace('<?xml version=\'1.0\'?>','') + '</root>');
              }
            } else {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }
          });
    //     }
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
  var response_format = req.query['response_format'];
  if (response_format == 'xml'){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_first_data_date || !req.body.root.group) {
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
      //     get_group_four_day_baseline_forecast_xml(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      get_group_four_day_baseline_forecast_xml(req, res);
    }
  } else if (response_format && response_format != 'xml' && response_format != 'json'){
    res.status(400).json({
      error: 'Invalid response_format parameter'
    });
  } else if (response_format == 'json' || !response_format) {
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_first_data_date || !req.body.root.group) {
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
      //     get_group_four_day_baseline_forecast_json(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      get_group_four_day_baseline_forecast_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;