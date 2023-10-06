const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const time = require('time');
const j2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;

function log(err, alert_string){
  console.log(err);
  alert_slack(' API get_group_load_shift_forecast ' + alert_string);
}

// Deals with padding to 8 bytes
function pad(text) {
  var pad_bytes = 8 - (text.length % 8);
  for (var x = 1 ; x <= pad_bytes; x++) {
    text = text + String.fromCharCode(0);
  }
  return text;
}

// Converts data received from user to XML format
// Encrypts and returns entire XML string
// Encryption may add on a few chars for padding but ignore anything after </root>
function encrypt(email, password, date, group, lb_start, lb_end, lr_start, lr_end, response_format) {
  var XMLString = '<root><method>get_load_shift_forecast</method><user><email>' + email + 
      "</email><password>" + password + "</password></user><local_date>" +
      date + "</local_date><group>" + group + "</group><load_build_start_time>" + lb_start + 
      "</load_build_start_time><load_build_end_time>" + lb_end + "</load_build_end_time><load_reduction_start_time>" + 
      lr_start + "</load_reduction_start_time><load_reduction_end_time>" + lr_end + "</load_reduction_end_time></root>";

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

// handles actual POST
router.post('/', (req, res, next) => {
  var response_format = req.query['response_format'];
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
      //     check_errors_xml(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      check_errors_xml(req, res);
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
      //     check_errors_json(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      check_errors_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

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
    return 'Duplicate date'
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

// validates time format
function validate_time(time) {
  re = /^(\d{2}):(\d{2})$/;
  if (typeof time == 'object') {
    return 'Duplicate field'
  } else {
    var fields = time.split(':');
    if (time.match(re)) {
      // limit hours, 00-24
      if(fields[0] < 0 || fields[0] >= 24) {
        return 'Invalid value for hours';
      }
      // limit minutes, 00-60
      else if (fields[1] < 0 || fields[1] > 59) {
        return 'Invalid value for minutes';
      } else {
        return 'valid';
      }
    } else {
      return 'Invalid time format. Use: HH:MM';
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

/*
    check errors: JSON
*/
function check_errors_json(req, res) {
  // var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503).json({
  //     error: 'Service temporarily unavailable'
  //   });
  // }
  // else 
  if(req.body.root.group){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_date || !req.body.root.group){
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object"
      || typeof req.body.root.local_date == "object" || typeof req.body.root.load_build_start_time == "object"
      || typeof req.body.root.load_build_end_time == "object" || typeof req.body.root.load_reduction_start_time == "object"
      || typeof req.body.root.load_reduction_end_time == "object") {
      //  duplicate passwords, groups, increments
      res.status(400).json({
        error: 'Duplicate fields'
      });
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group && !res.headersSent) {
      //     found = true;
          // this is the corresponding UTC time to the inputted local time
          var buildStartDateLocal;
          var reductionStartDateLocal;
          var scenario;
          if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 1; // all times present
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
            scenario = 2; // lb times present but not lr times
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
          } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 3; // lr time spresent but not lb times
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else {
            scenario = 4; // not one of the appropriate scenarios 
          }

          if (typeof req.body.root.user.password != "string") {
            res.status(400).json({
              error: 'Invalid password format'
            });
          } else if (validate_email(req.body.root.user.email) !== 'valid'){
            res.status(400).json({
              error: validate_email(req.body.root.user.email)
            });
          } else if (validate_date(req.body.root.local_date) !== 'valid') {
            res.status(400).json({
              error: validate_date(req.body.root.local_date)
            });
          } else if (scenario == 1){
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_start_time: ' + validate_time(req.body.root.load_build_start_time)
              });
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_end_time: ' + validate_time(req.body.root.load_build_end_time)
              });
            } else if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time)
              });
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time)
              });
            }
          } else if (scenario == 2) {
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_start_time: ' + validate_time(req.body.root.load_build_start_time)
              });
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_end_time: ' + validate_time(req.body.root.load_build_end_time)
              });
            }
          } else if (scenario == 3) {
            if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time)
              });
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time)
              });
            }
          } else if (scenario == 4) {
            res.status(400).json({
              error: 'Missing required build or reduction time(s)'
            });
          } 

          if (!res.headersSent){
            if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.local_date)){
              res.status(400).json({
                error: 'Remove all whitespace from body'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) < 0) {
              res.status(400).json({
                error: 'Invalid load build times; must be between 0 and 4 hours'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) < 0 ) {
              res.status(400).json({
                error: 'Overlapping build and reduction times'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) < 0) {
              res.status(400).json({
                error: 'Invalid load reduction times; must be between 0 and 4 hours'
              });
            } 
            // else if (projects[i].dateEnded) {
            //   res.status(400).json({
            //     error: 'Group unavailable'
            //   });
            // } 
            // else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            //   res.status(400).json({
            //     error: 'Invalid build start. Group not opened'
            //   });
            // } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            //   res.status(400).json({
            //     error: 'Invalid reduction start. Group not opened'
            //   });
            // } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            //   res.status(400).json({
            //     error: 'Load build forecast request must be made at least seven hours in advance, or for a historical date'
            //   });
            // } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            //   res.status(400).json({
            //     error: 'Load reduction forecast request must be made at least one hour in advance, or for a historical date'
            //   });
            // } 
            else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
              res.status(400).json({
                error: 'Invalid group'
              });
            } else {
              get_load_shift_forecast_json(req.body.root.user.email, req.body.root.user.password, req.body.root.local_date, req.body.root.group,
              req.body.root.load_build_start_time, req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, res);
            }
          }
      //   } 
      // }
      // if (!found && !res.headersSent) {
      //   res.status(400).json({
      //     error: 'Group unavailable'
      //   });
      // }
    }
  } else if (req.body.root.group_id){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_date || !req.body.root.group_id){
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group_id == "object"
      || typeof req.body.root.local_date == "object" || typeof req.body.root.load_build_start_time == "object"
      || typeof req.body.root.load_build_end_time == "object" || typeof req.body.root.load_reduction_start_time == "object"
      || typeof req.body.root.load_reduction_end_time == "object") {
      //  duplicate passwords, groups, increments
      res.status(400).json({
        error: 'Duplicate fields'
      });
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group_id && !res.headersSent) {
      //     found = true;
          // this is the corresponding UTC time to the inputted local time
          var buildStartDateLocal;
          var reductionStartDateLocal;
          var scenario;
          if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 1; // all times present
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
            scenario = 2; // lb times present but not lr times
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
          } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 3; // lr time spresent but not lb times
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else {
            scenario = 4; // not one of the appropriate scenarios 
          }

          if (typeof req.body.root.user.password != "string") {
            res.status(400).json({
              error: 'Invalid password format'
            });
          } else if (validate_email(req.body.root.user.email) !== 'valid'){
            res.status(400).json({
              error: validate_email(req.body.root.user.email)
            });
          } else if (validate_date(req.body.root.local_date) !== 'valid') {
            res.status(400).json({
              error: validate_date(req.body.root.local_date)
            });
          } else if (scenario == 1){
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_start_time: ' + validate_time(req.body.root.load_build_start_time)
              });
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_end_time: ' + validate_time(req.body.root.load_build_end_time)
              });
            } else if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time)
              });
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time)
              });
            }
          } else if (scenario == 2) {
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_start_time: ' + validate_time(req.body.root.load_build_start_time)
              });
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_build_end_time: ' + validate_time(req.body.root.load_build_end_time)
              });
            }
          } else if (scenario == 3) {
            if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time)
              });
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400).json({
                error: 'load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time)
              });
            }
          } else if (scenario == 4) {
            res.status(400).json({
              error: 'Missing required build or reduction time(s)'
            });
          } 

          if (!res.headersSent){
            if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.local_date)){
              res.status(400).json({
                error: 'Remove all whitespace from body'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) < 0) {
              res.status(400).json({
                error: 'Invalid load build times; must be between 0 and 4 hours'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) < 0 ) {
              res.status(400).json({
                error: 'Overlapping build and reduction times'
              });
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) < 0) {
              res.status(400).json({
                error: 'Invalid load reduction times; must be between 0 and 4 hours'
              });
            } 
            // else if (projects[i].dateEnded) {
            //   res.status(400).json({
            //     error: 'Group unavailable'
            //   });
            // } 
            // else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            //   res.status(400).json({
            //     error: 'Invalid build start. Group not opened'
            //   });
            // } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            //   res.status(400).json({
            //     error: 'Invalid reduction start. Group not opened'
            //   });
            // } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            //   res.status(400).json({
            //     error: 'Load build forecast request must be made at least seven hours in advance, or for a historical date'
            //   });
            // } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            //   res.status(400).json({
            //     error: 'Load reduction forecast request must be made at least one hour in advance, or for a historical date'
            //   });
            // } 
            else if (!String(req.body.root.group_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group_id))) {
              res.status(400).json({
                error: 'Invalid group'
              });
            } else {
              get_load_shift_forecast_json(req.body.root.user.email, req.body.root.user.password, req.body.root.local_date, req.body.root.group_id,
              req.body.root.load_build_start_time, req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, res);
            }
          }
      //   } 
      // }
      // if (!found && !res.headersSent) {
      //   res.status(400).json({
      //     error: 'Group unavailable'
      //   });
      // }
    }
  } else {
    res.status(400).json({
      error: 'Missing group_id'
    });
  }
}

/*
    check errors: XML
*/
function check_errors_xml(req, res) {
  res.type('application/xml');
  var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503);
  //   res.send('<error>Service temporarily unavailable</error>');
  // } else 
  if(req.body.root.group){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_date || !req.body.root.group){
      res.status(400);
      res.send('<error>Missing required field(s)</error>');
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object"
      || typeof req.body.root.local_date == "object" || typeof req.body.root.load_build_start_time == "object"
      || typeof req.body.root.load_build_end_time == "object" || typeof req.body.root.load_reduction_start_time == "object"
      || typeof req.body.root.load_reduction_end_time == "object") { //  duplicate passwords, groups, increments
      res.status(400);
      res.send('<error>Duplicate fields</error>');
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group) {
      //     found = true;
          // this is the corresponding UTC time to the inputted local time
          var buildStartDateLocal;
          var reductionStartDateLocal;
          var scenario;
          if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 1; // all times present
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
            scenario = 2; // lb times present but not lr times
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
          } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 3; // lr time spresent but not lb times
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else {
            scenario = 4; // not one of the appropriate scenarios 
          }

          if (typeof req.body.root.user.password != "string") {
            res.status(400);
            res.send('<error>Invalid password format</error>');
          } else if (validate_email(req.body.root.user.email) !== 'valid'){
            res.status(400);
            res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
          } else if (validate_date(req.body.root.local_date) !== 'valid') {
            res.status(400);
            res.send('<error>' + validate_date(req.body.root.local_date) + '</error>');
          } else if (scenario == 1) {
              if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_start_time: ' + validate_time(req.body.root.load_build_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_end_time: ' + validate_time(req.body.root.load_build_end_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time) + '</error>');
            }
          } else if (scenario == 2) {
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_start_time: ' + validate_time(req.body.root.load_build_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_end_time: ' + validate_time(req.body.root.load_build_end_time) + '</error>');
            }
          } else if (scenario == 3) {
            if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time) + '</error>');
            }
          } else if (scenario == 4) {
            res.status(400);
            res.send('<error>Missing required build or reduction time(s)</error>');
          } 

          if (!res.headersSent){
            if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.local_date)){
              res.status(400);
              res.send('<error>Remove all whitespace from body</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) < 0) {
              res.status(400);
              res.send('<error>Invalid load build times; must be between 0 and 4 hours</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) < 0 ) {
              res.status(400);
              res.send('<error>Overlapping build and reduction times</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) < 0) {
              res.status(400);
              res.send('<error>Invalid load reduction times; must be between 0 and 4 hours</error>');
            } 
            // else if (projects[i].dateEnded) {
            //   res.status(400);
            //   res.send('<error>Group unavailable</error>');
            // } 
            // else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            //   res.status(400);
            //   res.send('<error>Invalid build start. Group not opened</error>');
            // } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            //   res.status(400);
            //   res.send('<error>Invalid reduction start. Group not opened</error>');
            // } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            //   res.status(400);
            //   res.send('<error>Load build forecast request must be made at least seven hours in advance, or for a historical date</error>');
            // } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            //   res.status(400);
            //   res.send('<error>Load reduction forecast request must be made at least one hour in advance, or for a historical date</error>');
            // } 
            else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
              res.status(400);
              res.send('<error>Invalid group</error>');
            } else {
              get_load_shift_forecast_xml(req.body.root.user.email, req.body.root.user.password, req.body.root.local_date, req.body.root.group,
              req.body.root.load_build_start_time, req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, res);
            }
          }
      //   }
      // }
      // if (!found && !res.headersSent) {
      //   res.status(400);
      //   res.send('<error>Group unavailable</error>');
      // }
    }
  } else if (req.body.root.group_id){
      if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.local_date || !req.body.root.group_id){
      res.status(400);
      res.send('<error>Missing required field(s)</error>');
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group_id == "object"
      || typeof req.body.root.local_date == "object" || typeof req.body.root.load_build_start_time == "object"
      || typeof req.body.root.load_build_end_time == "object" || typeof req.body.root.load_reduction_start_time == "object"
      || typeof req.body.root.load_reduction_end_time == "object") { //  duplicate passwords, groups, increments
      res.status(400);
      res.send('<error>Duplicate fields</error>');
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group_id) {
      //     found = true;
          // this is the corresponding UTC time to the inputted local time
          var buildStartDateLocal;
          var reductionStartDateLocal;
          var scenario;
          if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 1; // all times present
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
            scenario = 2; // lb times present but not lr times
            buildStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_build_start_time;
          } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
            scenario = 3; // lr time spresent but not lb times
            reductionStartDateLocal = req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time;
          } else {
            scenario = 4; // not one of the appropriate scenarios 
          }

          if (typeof req.body.root.user.password != "string") {
            res.status(400);
            res.send('<error>Invalid password format</error>');
          } else if (validate_email(req.body.root.user.email) !== 'valid'){
            res.status(400);
            res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
          } else if (validate_date(req.body.root.local_date) !== 'valid') {
            res.status(400);
            res.send('<error>' + validate_date(req.body.root.local_date) + '</error>');
          } else if (scenario == 1) {
              if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_start_time: ' + validate_time(req.body.root.load_build_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_end_time: ' + validate_time(req.body.root.load_build_end_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time) + '</error>');
            }
          } else if (scenario == 2) {
            if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_start_time: ' + validate_time(req.body.root.load_build_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_build_end_time: ' + validate_time(req.body.root.load_build_end_time) + '</error>');
            }
          } else if (scenario == 3) {
            if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_start_time: ' + validate_time(req.body.root.load_reduction_start_time) + '</error>');
            } else if (validate_time(req.body.root.load_reduction_end_time) !== 'valid') {
              res.status(400);
              res.send('<error>load_reduction_end_time: ' + validate_time(req.body.root.load_reduction_end_time) + '</error>');
            }
          } else if (scenario == 4) {
            res.status(400);
            res.send('<error>Missing required build or reduction time(s)</error>');
          } 

          if (!res.headersSent){
            if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.local_date)){
              res.status(400);
              res.send('<error>Remove all whitespace from body</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_start_time) < 0) {
              res.status(400);
              res.send('<error>Invalid load build times; must be between 0 and 4 hours</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_build_end_time) < 0 ) {
              res.status(400);
              res.send('<error>Overlapping build and reduction times</error>');
            } else if (new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) > 14400000
                || new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.local_date + 'T' + req.body.root.load_reduction_start_time) < 0) {
              res.status(400);
              res.send('<error>Invalid load reduction times; must be between 0 and 4 hours</error>');
            } 
            // else if (projects[i].dateEnded) {
            //   res.status(400);
            //   res.send('<error>Group unavailable</error>');
            // } 
            // else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            //   res.status(400);
            //   res.send('<error>Invalid build start. Group not opened</error>');
            // } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            //   res.status(400);
            //   res.send('<error>Invalid reduction start. Group not opened</error>');
            // } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            //   res.status(400);
            //   res.send('<error>Load build forecast request must be made at least seven hours in advance, or for a historical date</error>');
            // } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            //   res.status(400);
            //   res.send('<error>Load reduction forecast request must be made at least one hour in advance, or for a historical date</error>');
            // } 
            else if (!String(req.body.root.group_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group_id))) {
              res.status(400);
              res.send('<error>Invalid group</error>');
            } else {
              get_load_shift_forecast_xml(req.body.root.user.email, req.body.root.user.password, req.body.root.local_date, req.body.root.group_id,
              req.body.root.load_build_start_time, req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, res);
            }
          }
      //   }
      // }
      // if (!found && !res.headersSent) {
      //   res.status(400);
      //   res.send('<error>Group unavailable</error>');
      // }
    }
  } else {
    res.status(400)
    res.send('<error>Missing group_id</error>');
  }
}

/*
    get load shift forecast: JSON
*/
function get_load_shift_forecast_json(email, password, date, group, lb_start, lb_end, lr_start, lr_end, res) {
  var encryption = encrypt(email, password, date, group, lb_start, lb_end, lr_start, lr_end);
  exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
  function (error, stdout, stderr) {
    var loadshift;
    var decryption;
    /*try {
      decryption = decrypt(stdout);
    } catch (err) {
      res.status(503).json({
        error: 'Service temporarily unavailable'
      });
    }*/
    try {
      loadshift = JSON.parse(stdout);
      //loadshift = JSON.parse(decryption);
    } catch (err) {
      log(stdout)
      log(err, 'user: ' + email + ' error parsing WebDNA Response');
      if(!res.headersSent){
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    }
    if (loadshift && error !== null) {
      log('exec error: ' + error, 'user: ' + email + ' error calling WebDNA');
      console.log('exec error: ' + error);
    } else if(loadshift && loadshift.message == 'invalid') {
      log(null, 'user: ' + email + ' authentication invalid')
      res.status(401).json({
        error: 'Authentication invalid'
      });
    } else if(loadshift && loadshift.message == 'Group unavailable') {
      log(null, 'user: ' + email + ' group unavailable: ' + group)
      res.status(409).json({
        error: 'Group unavailable'
      });
    } else if(loadshift && loadshift.message == 'Forecast unavailable') {
      log(null, 'user: ' + email + ' forecast unavailable for group ' + group)
      // on forecast unavailable for date
      res.status(409).json({
        error: 'Forecast unavailable'
      });
    } else if(loadshift && loadshift.message == 'Not Authorized') {
      log(null, 'user: ' + email + ' Not authorized for group ' + group)
      res.status(409).json({
        error: 'Not authorized'
      })
    } else if (loadshift && !res.headersSent) {
      res.status(201).json({
        response_format: 'json',
        message: loadshift
      });
    } else if (error) {
      log(error)
      console.log(encryption)
      if(!res.headersSent){
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    } else {
      log(stdout)
      log(null, 'user: ' + email + ' endpoint down. check logs')
      if(!res.headersSent){
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }
    }
  });
}

/*
    get load shift forecast: XML
*/
function get_load_shift_forecast_xml(email, password, date, group, lb_start, lb_end, lr_start, lr_end, res) {
  var encryption = encrypt(email, password, date, group, lb_start, lb_end, lr_start, lr_end);
  exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
  function (error, stdout, stderr) {
    var loadshift;
    var decryption;
    /*try {
      decryption = decrypt(stdout);
    } catch (err) {
      res.status(503);
      res.send('<error>Service temporarily unavailable</error>');
    }*/
    try {
      loadshift = JSON.parse(stdout);
      //loadshift = JSON.parse(decryption);
    } catch (err) {
      res.status(503);
      res.send('<error>Service temporarily unavailable</error>');
    }
    if (loadshift && error !== null) {
      console.log('exec error: ' + error);
    } else if(loadshift && loadshift.message == 'invalid') {
      res.status(401);
      res.send('<error>Authentication invalid</error>');
    } else if(loadshift && loadshift.message == 'Group unavailable') {
      res.status(409);
      res.send('<error>Group unavailable</error>');
    } else if(loadshift && loadshift.message == 'Forecast unavailable') {
      // on forecast unavailable for date
      res.status(409);
      res.send('<error>Forecast unavailable</error>');
    } else if(loadshift && loadshift.message == 'Not Authorized') {
      res.status(409);
      res.send('<error>Not authorized</error>');
    } else if (loadshift && !res.headersSent) {
      res.status(201);
      res.send('<root><response_format>xml</response_format>' + j2xml.parse('message',loadshift).replace('<?xml version=\'1.0\'?>','') + '</root>');
    } else {
      res.status(503);
      res.send('<error>Service temporarily unavailable</error>');
    }
  });
}

module.exports = router;