const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const time = require('time');
const j2xml = require('js2xmlparser');



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
function encrypt(email, password, date, group, lb_kw, lr_kw, lb_start, lb_end, lr_start, lr_end, response_format) {
  var XMLString = '<root><format>' + response_format + '</format><method>initiate_load_shift_event</method><email>' + email + 
      "</email><password>" + password + "</password><requested_date>" +
      date + "</requested_date><group>" + group + "</group><build_kw>" + lb_kw + "</build_kw><reduction_kw>" + lr_kw + "</reduction_kw><build_start>" + lb_start + 
      "</build_start><build_end>" + lb_end + "</build_end><reduction_start>" + 
      lr_start + "</reduction_start><reduction_end>" + lr_end + "</reduction_end></root>";

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

// handles actual POST
router.post('/', (req, res, next) => {
  var response_format = req.query['response_format'];
  
  if (response_format == 'xml'){
    if (!req.body.root || !req.body.root.user) {
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
          check_errors_xml(req, res, projects);
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
    if (!req.body.root || !req.body.root.user) {
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
          check_errors_json(req, res, projects);
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

// validates time format
function validate_time(time) {
  re = /^(\d{2}):(\d{2})$/;
  if (typeof time != "string") {
    return 'Invalid time format. Times must include quotation marks'
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
function check_errors_json(req, res, projects) {
  var found = 0;
  if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
    res.status(503).json({
      error: 'Service temporarily unavailable'
    });
  } else if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.date || !req.body.root.groups){
    res.status(400).json({
      error: 'Missing required field(s)'
    });
  } else if (typeof req.body.root.groups != "object") {
    res.status(400).json({
      error: 'Groups must be an array.'
    })
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.date == "object"
    || typeof req.body.root.load_build_start_time == "object" || typeof req.body.root.load_build_end_time == "object"
    || typeof req.body.root.load_reduction_start_time == "object" || typeof req.body.root.load_reduction_end_time == "object"
    || typeof req.body.root.requested_load_build_kw == "object" || typeof req.body.root.requested_load_reduction_kw == "object") {
    //  duplicate passwords, groups, increments
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else {
    /*
      This is checking if requested group exists in projects[i].projectID;
    */
    var groups = req.body.root.groups;
    for (var i = 0; i < projects.length; i++) {
      groups.forEach(function(group, j, array){
        if (projects[i].projectID == group) {
          found++;
        }
      });
      if (JSON.stringify(groups).indexOf(projects[i].projectID) >= 0) { // does the project in projects.db exist in the groups array requested?
        // this is the corresponding UTC time to the inputted local time
        var buildStartDateLocal;
        var reductionStartDateLocal;
        var scenario;
        if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
          scenario = 1; // all times present
          buildStartDateLocal = new time.Date(req.body.root.date + 'T' + req.body.root.load_build_start_time, projects[i].timezone);
          reductionStartDateLocal = new time.Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time, projects[i].timezone);
        } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
          scenario = 2; // lb times present but not lr times
          buildStartDateLocal = new time.Date(req.body.root.date + ' ' + req.body.root.load_build_start_time, projects[i].timezone);
        } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
          scenario = 3; // lr time spresent but not lb times
          reductionStartDateLocal = new time.Date(req.body.root.date + ' ' + req.body.root.load_reduction_start_time, projects[i].timezone);
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
        } else if (validate_date(req.body.root.date) !== 'valid') {
          res.status(400).json({
            error: validate_date(req.body.root.date)
          });
        } else if (req.body.root.groups.length != new Set(req.body.root.groups).size) {
          res.status(400).json({
            error: 'Duplicate groups'
          });
        }

        else if (scenario == 1){
          if (!req.body.root.requested_load_build_kw) {
            res.status(400).json({
              error: 'requested_load_build_kw required.'
            });
          } else if (!req.body.root.requested_load_reduction_kw) {
            res.status(400).json({
              error: 'requested_load_reduction_kw required.'
            });
          } else if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
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
          if (!req.body.root.requested_load_build_kw) {
            res.status(400).json({
              error: 'requested_load_build_kw required.'
            });
          } else if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
            res.status(400).json({
              error: 'load_build_start_time: ' + validate_time(req.body.root.load_build_start_time)
            });
          } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
            res.status(400).json({
              error: 'load_build_end_time: ' + validate_time(req.body.root.load_build_end_time)
            });
          }
        } else if (scenario == 3) {
          if (!req.body.root.requested_load_reduction_kw) {
            res.status(400).json({
              error: 'requested_load_reduction_kw required.'
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
        } else if (scenario == 4) {
          res.status(400).json({
            error: 'Missing required build or reduction time(s)'
          });
        }

        if (!res.headersSent){ 
          if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.date)){
            res.status(400).json({
              error: 'Remove all whitespace from body'
            });
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_start_time) > 14400000
              || new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_start_time) < 0) {
            res.status(400).json({
              error: 'Invalid load build times; must be between 0 and 4 hours'
            });
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) < 0 ) {
            res.status(400).json({
              error: 'Overlapping build and reduction times'
            });
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) > 14400000
              || new Date(req.body.root.date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) < 0) {
            res.status(400).json({
              error: 'Invalid load reduction times; must be between 0 and 4 hours'
            });
          } else if (projects[i].dateEnded) {
            res.status(400).json({
              error: 'Group(s) unavailable'
            });
          } else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            res.status(400).json({
              error: 'Invalid build start. Group not opened'
            });
          } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            res.status(400).json({
              error: 'Invalid reduction start. Group not opened'
            });
          } else if (buildStartDateLocal - new Date() < 0) {
            res.status(400).json({
              error: 'Load build event request cannot be made for a previous date'
            });
          } else if (reductionStartDateLocal - new Date() < 0) {
            res.status(400).json({
              error: 'Load reduction event request cannot be made for a previous date'
            });
          } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            res.status(400).json({
              error: 'Event request must be made at least seven hours in advance'
            });
          } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            res.status(400).json({
              error: 'Load reduction forecast request must be made at least one hour in advance'
            });
          }
        }
      }
    }
    if (!res.headersSent && found < groups.length) {
      res.status(400).json({
        error: 'Group(s) unavailable'
      });
    } else if (!res.headersSent) {
      var load_shifts = new Array();
      groups.forEach(function(group, i, array) {
        initiate_load_shift_event_json(group, req, res, load_shifts, projects);
      });
    }
  }
}

/*
    check errors: XML
*/
function check_errors_xml(req, res, projects) {
  res.type('application/xml');
  var found = 0;
  if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
    res.status(503);
    res.send('<error>Service temporarily unavailable</error>');
  } else if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.date || !req.body.root.groups){
    res.status(400);
    res.send('<error>Missing required field(s)</error>');
  } else if (typeof req.body.root.groups != "object") {
    res.status(400);
    res.send('<error>Groups must be an array</error>');
  } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.date == "object"
    || typeof req.body.root.load_build_start_time == "object" || typeof req.body.root.load_build_end_time == "object"
    || typeof req.body.root.load_reduction_start_time == "object" || typeof req.body.root.load_reduction_end_time == "object"
    || typeof req.body.root.requested_load_build_kw == "object" || typeof req.body.root.requested_load_reduction_kw == "object") { //  duplicate passwords, groups, increments
    res.status(400);
    res.send('<error>Duplicate fields</error>');
  } else {
    var groups = req.body.root.groups;
    for (var i = 0; i < projects.length; i++) {
      groups.forEach(function(group, j, array){
        if (projects[i].projectID == group) {
          found++;
        }
      });
      if (JSON.stringify(groups).indexOf(projects[i].projectID) >= 0) {
        // this is the corresponding UTC time to the inputted local time
        var buildStartDateLocal;
        var reductionStartDateLocal;
        var scenario;
        if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
          scenario = 1; // all times present
          buildStartDateLocal = new time.Date(req.body.root.date + 'T' + req.body.root.load_build_start_time, projects[i].timezone);
          reductionStartDateLocal = new time.Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time, projects[i].timezone);
        } else if (req.body.root.load_build_start_time && req.body.root.load_build_end_time && !req.body.root.load_reduction_start_time && !req.body.root.load_reduction_end_time) {
          scenario = 2; // lb times present but not lr times
          buildStartDateLocal = new time.Date(req.body.root.date + ' ' + req.body.root.load_build_start_time, projects[i].timezone);
        } else if (!req.body.root.load_build_start_time && !req.body.root.load_build_end_time && req.body.root.load_reduction_start_time && req.body.root.load_reduction_end_time) {
          scenario = 3; // lr time spresent but not lb times
          reductionStartDateLocal = new time.Date(req.body.root.date + ' ' + req.body.root.load_reduction_start_time, projects[i].timezone);
        } else {
          scenario = 4; // not one of the appropriate scenarios 
        }
        
        if (typeof req.body.root.user.password != "string") {
          res.status(400);
          res.send('<error>Invalid password format</error>');
        } else if (validate_email(req.body.root.user.email) !== 'valid'){
          res.status(400);
          res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
        } else if (validate_date(req.body.root.date) !== 'valid') {
          res.status(400);
          res.send('<error>' + validate_date(req.body.root.date) + '</error>');
        } else if (req.body.root.groups.length != new Set(req.body.root.groups).size) {
          res.status(400);
          res.send('<error>Duplicate groups</error>');
        }

        else if (scenario == 1) {
          if (!req.body.root.requested_load_build_kw) {
            res.status(400);
            res.send('<error>requested_load_build_kw required</error>');
          } else if (!req.body.root.requested_load_reduction_kw) {
            res.status(400);
            res.send('<error>requested_load_reduction_kw required</error>');
          } else if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
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
          if (!req.body.root.requested_load_build_kw) {
            res.status(400);
            res.send('<error>requested_load_build_kw required</error>');
          } else if (validate_time(req.body.root.load_build_start_time) !== 'valid') {
            res.status(400);
            res.send('<error>load_build_start_time: ' + validate_time(req.body.root.load_build_start_time) + '</error>');
          } else if (validate_time(req.body.root.load_build_end_time) !== 'valid') {
            res.status(400);
            res.send('<error>load_build_end_time: ' + validate_time(req.body.root.load_build_end_time) + '</error>');
          }
        } else if (scenario == 3) {
          if (!req.body.root.requested_load_reduction_kw) {
            res.status(400);
            res.send('<error>requested_load_reduction_kw required</error>');
          } else if (validate_time(req.body.root.load_reduction_start_time) !== 'valid') {
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

        if (!res.headersSent) {
          if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password) || has_whitespace(req.body.root.date)){
            res.status(400);
            res.send('<error>Remove all whitespace from body</error>');
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_start_time) > 14400000
              || new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_start_time) < 0) {
            res.status(400);
            res.send('<error>Invalid load build times; must be between 0 and 4 hours</error>');
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) - new Date(req.body.root.date + 'T' + req.body.root.load_build_end_time) < 0 ) {
            res.status(400);
            res.send('<error>Overlapping build and reduction times</error>');
          } else if (new Date(req.body.root.date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) > 14400000
              || new Date(req.body.root.date + 'T' + req.body.root.load_reduction_end_time) - new Date(req.body.root.date + 'T' + req.body.root.load_reduction_start_time) < 0) {
            res.status(400);
            res.send('<error>Invalid load reduction times; must be between 0 and 4 hours</error>');
          } else if (projects[i].dateEnded) {
            res.status(400);
            res.send('<error>Group(s) unavailable</error>');
          } else if (new Date(projects[i].dateStarted) > buildStartDateLocal) { // make sure dateStarted is before buildStartDateLocal
            res.status(400);
            res.send('<error>Invalid build start. Group not opened</error>');
          } else if (new Date(projects[i].dateStarted) > reductionStartDateLocal) { // make sure dateStarted is before reductionStartDateLocal
            res.status(400);
            res.send('<error>Invalid reduction start. Group not opened</error>');
          } else if (buildStartDateLocal - new Date() < 0) {
            res.status(400);
            res.send('<error>Load build event request cannot be made for a previous date</error>');
          } else if (reductionStartDateLocal - new Date() < 0) {
            res.status(400);
            res.send('<error>Load reduction event request cannot be made for a previous date</error>');
          } else if (buildStartDateLocal - new Date() < 25200000 && buildStartDateLocal - new Date() > 0) {
            res.status(400);
            res.send('<error>Event request must be made at least seven hours in advance</error>');
          } else if (reductionStartDateLocal - new Date() < 3600000 && reductionStartDateLocal - new Date() > 0) {
            res.status(400);
            res.send('<error>Load reduction forecast request must be made at least one hour in advance</error>');
          } 
        }
      } 
    }
    if (!res.headersSent && found < groups.length) {
      res.status(400);
          res.send('<error>Group(s) unavailable</error>');
    } else if (!res.headersSent) {
      var load_shifts = new Array();
      groups.forEach(function(group, i, array) {
        initiate_load_shift_event_xml(group, req, res, load_shifts, projects);
      });
    }
  }
}

/*
    get load shift Event: JSON
*/
function initiate_load_shift_event_json(group, req, res, load_shifts, projects) {
  var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.date, group,
      req.body.root.requested_load_build_kw, req.body.root.requested_load_reduction_kw, req.body.root.load_build_start_time,
      req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, 'json');
  exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var loadshift;
      var decryption;
      /*try {
        decryption = decrypt(stdout); // now change all 'stdout' in this function to decryption
      } catch (err) {
        res.status(503).json({
          error: 'Service temporarily unavailable'
        });
      }*/
      try {
        loadshift = JSON.parse(stdout);
        //loadshift = JSON.parse(decryption);
      } catch (err) {
        if (!res.headersSent) {
          res.status(503).json({
            error: 'Service temporarily unavailable'
          });
        }
        
      }
      if (!res.headersSent) {
        if (loadshift && error !== null) {
          console.log('exec error: ' + error);
        } else if(loadshift && loadshift.message == 'invalid') {
          res.status(401).json({
            error: 'Authentication invalid'
          });
        } else if(loadshift && loadshift.message == 'Group unavailable') {
          res.status(409).json({
            error: 'Group(s) unavailable'
          });
        } else if(loadshift && loadshift.message == 'Event unavailable') {
          // on Event unavailable for date
          res.status(409).json({
            error: 'Unable to initiate load shift event'
          });
        } else if(loadshift && loadshift.message == 'Not Authorized') {
          res.status(409).json({
            error: 'Not authorized'
          })
        } else if(loadshift && loadshift.message == 'Load shift event already scheduled for requested day') {
          res.status(409).json({
            error: 'Load shift event already scheduled for requested day'
          })
        } else if (loadshift && !res.headersSent) {
          load_shifts.push(loadshift);
          if (load_shifts.length == req.body.root.groups.length) {
            get_sums(req, res, load_shifts, projects);
          }
        } else if (!res.headersSent) {
          res.status(503).json({
            error: 'Service temporarily unavailable'
          });
        }
      }
    });
}

/*
    get load shift Event: XML
*/
function initiate_load_shift_event_xml(group, req, res, load_shifts, projects) {
  var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.date, group,
      req.body.root.requested_load_build_kw, req.body.root.requested_load_reduction_kw, req.body.root.load_build_start_time,
      req.body.root.load_build_end_time, req.body.root.load_reduction_start_time, req.body.root.load_reduction_end_time, 'xml');
  exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
    function (error, stdout, stderr) {
      var loadshift;
      var decryption;
      /*try {
        decryption = decrypt(stdout); // now change all 'stdout' in this function to decryption
      } catch (err) {
        res.status(503);
        res.send('<error>Service temporarily unavailable</error>');
      }*/
      try {
        loadshift = JSON.parse(stdout);
        //loadshift = JSON.parse(decryption);
      } catch (err) {
        if (!res.headersSent) {
          res.status(503);
          res.send('<error>Service temporarily unavailable</error>');
        }
      }
      if (!res.headersSent) {
        if (loadshift && error !== null) {
          console.log('exec error: ' + error);
        } else if(loadshift && loadshift.message == 'invalid') {
          res.status(401);
          res.send('<error>Authentication invalid</error>');
        } else if(loadshift && loadshift.message == 'Group unavailable') {
          res.status(409);
          res.send('<error>Group(s) unavailable</error>');
        } else if(loadshift && loadshift.message == 'Event unavailable') {
          // on Event unavailable for date
          res.status(409);
          res.send('<error>Unable to initiate load shift event</error>');
        } else if(loadshift && loadshift.message == 'Not Authorized') {
          res.status(409);
          res.send('<error>Not authorized</error>');
        } else if(loadshift && loadshift.message == 'Load shift event already scheduled for requested day') {
          res.status(409);
          res.send('<error>Load shift event already scheduled for requested day</error>');
        } else if (loadshift && !res.headersSent) {
          load_shifts.push(loadshift);
          if (load_shifts.length == req.body.root.groups.length) {
            get_sums(req, res, load_shifts, projects);
          }
        } else {
          res.status(503);
          res.send('<error>Service temporarily unavailable</error>');
        }
      }
      
    });
}

function get_sums(req, res, load_shifts, projects) {
  var response_format = req.query['response_format'];
  var aggregate = {   
    "Event_for_Date": "",
    "Event_Generated_UTC": "",
    "Timezone": "",
    "Aggregate_Number_Heaters_Online": 0,
    "Load_Build_Start": "",
    "Load_Build_End": "",
    "Load_Reduction_Start": "",
    "Load_Reduction_End": "",
    "Aggregate_Load_Build_kw_Capacity": 0,
    "Aggregate_Load_Reduction_kw_Capacity": 0,
    "Group_Events":[],
    "Aggregate_Event":[]
  }
  load_shifts.forEach(function(load_shift){
    if (!aggregate.Event_for_Date) {aggregate.Event_for_Date = load_shift.Event_for_Date} // when underscores added
    if (!aggregate.Event_Generated_UTC) {aggregate.Event_Generated_UTC = load_shift.Event_Generated_UTC} // when underscores added
    if (!aggregate.Timezone) {
      aggregate.Timezone = load_shift.Timezone
    }
    if (!aggregate.Load_Build_Start) {
      aggregate.Load_Build_Start = load_shift.Load_Build_Start;
    }
    if (!aggregate.Load_Build_End) {
      aggregate.Load_Build_End = load_shift.Load_Build_End;
    }
    if (!aggregate.Load_Reduction_Start) {
      aggregate.Load_Reduction_Start = load_shift.Load_Reduction_Start;
    }
    if (!aggregate.Load_Reduction_End) {
      aggregate.Load_Reduction_End = load_shift.Load_Reduction_End;
    }
    aggregate.Aggregate_Number_Heaters_Online += parseInt(load_shift.Number_Heaters_Online);
    aggregate.Aggregate_Load_Build_kw_Capacity += load_shift.Load_Build_kw_Capacity;
    aggregate.Aggregate_Load_Reduction_kw_Capacity += load_shift.Load_Reduction_kw_Capacity;
    aggregate.Group_Events.push({
      "GroupID": load_shift.Group,
      "Number_Heaters_Online": load_shift.Number_Heaters_Online,
      "Load_Build_kw_Capacity": load_shift.Load_Build_kw_Capacity,
      "Load_Reduction_kw_Capacity": load_shift.Load_Reduction_kw_Capacity
    });
    if (aggregate.Aggregate_Event.length == 0) {
      for (var j = 0; j < load_shift.Event.length; j++) {
        aggregate.Aggregate_Event.push(load_shift.Event[j]);
      }
    } else {
      for (var j = 0; j < load_shift.Event.length; j++) {
        aggregate.Aggregate_Event[j].Load_shift_event_kw += (load_shift.Event[j].Load_shift_event_kw);
      }
    }
  });
  if (response_format == 'xml') {
    res.status(201);
    res.send('<root><response_format>xml</response_format>' + j2xml.parse('message',aggregate).replace('<?xml version=\'1.0\'?>','') + '</root>');
  } else {
    res.status(201).json({
      response_format: 'json',
      message: aggregate
    });
  }
}

module.exports = router;