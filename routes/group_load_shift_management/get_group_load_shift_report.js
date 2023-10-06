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
  alert_slack(' API get_group_load_shift_forecast ' + alert_string);
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
function encrypt(email, password, group, local_start_date, local_end_date, response_format) {
  var XMLString = '<root><method>get_group_load_shift_report</method><email>' + email + 
      "</email><password>" + password + "</password><group>" + group + "</group><local_start_date>" + local_start_date + 
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

function get_group_load_shift_report_json(req, res) {
  // var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503).json({
  //     error: 'Service temporarily unavailable'
  //   });
  // } else 
  if(req.body.root.group){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.group || !req.body.root.local_start_date || !req.body.root.local_end_date){
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object") {
      //  duplicate passwords, groups, increments
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
    } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 2678400000) {
      res.status(400).json({
        error: "End date must be within 31 days of start date"
      });
    } else if (validate_email(req.body.root.user.email) !== 'valid'){
      res.status(400).json({
        error: validate_email(req.body.root.user.email)
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
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group && !res.headersSent) {
      //     found = true;
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group, req.body.root.local_start_date, req.body.root.local_end_date);
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var group_ls_report;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }*/
            try {
              group_ls_report = JSON.parse(stdout);
              //group_ls_report = JSON.parse(decryption);
            } catch (err) {
              log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
              if (!res.headersSent) {
                res.status(503).json({
                  error: 'Service temporarily unavailable'+stdout
                }); 
              }
              
            }
            if (!res.headersSent) {
              if (group_ls_report && error !== null) {
                log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
                res.status(503).json({
                  error: 'Service temporarily unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'invalid') {
                log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
                res.status(401).json({
                  error: 'Authentication invalid'
                });
              } else if (group_ls_report && group_ls_report.message == 'Group unavailable') {
                log(null, 'user: ' + req.body.root.user.email + ' group unavailable: ' + req.body.root.group)
                res.status(409).json({
                  message: 'Group unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'Group load shift report unavailable') {
                log(null, 'user: ' + req.body.root.user.email + ' load shift report unavailable unavailable for group ' + req.body.root.group)
                res.status(409).json({
                  message: 'Group load shift report unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'Not Authorized') {
                log(null, 'user: ' + req.body.root.user.email + ' Not authorized for group ' + req.body.root.group)
                res.status(409).json({
                  message: 'Not authorized'
                });
              } else if (group_ls_report){
                res.status(201).json({
                  response_format: 'json',
                  message: group_ls_report
                });
              } else if (!res.headersSent){
                log(null, 'user: ' + req.body.root.user.email + ' endpoint down. check logs')
                res.status(503).json({
                  error: 'Service temporarily unavailable'
                });
              }
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
  } else if (req.body.root.group_id) {
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.group_id || !req.body.root.local_start_date || !req.body.root.local_end_date){
      res.status(400).json({
        error: 'Missing required field(s)'
      });
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group_id == "object") {
      //  duplicate passwords, groups, increments
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
    } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 2678400000) {
      res.status(400).json({
        error: "End date must be within 31 days of start date"
      });
    } else if (validate_email(req.body.root.user.email) !== 'valid'){
      res.status(400).json({
        error: validate_email(req.body.root.user.email)
      });
    } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
      res.status(400).json({
        error: 'Remove all whitespace from body'
      });
    } else if (!String(req.body.root.group_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group_id))) {
      res.status(400).json({
        error: 'Invalid group'
      });
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group_id && !res.headersSent) {
      //     found = true;
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group_id, req.body.root.local_start_date, req.body.root.local_end_date);
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var group_ls_report;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503).json({
                error: 'Service temporarily unavailable'
              });
            }*/
            try {
              group_ls_report = JSON.parse(stdout);
              //group_ls_report = JSON.parse(decryption);
            } catch (err) {
              log(err, 'user: ' + req.body.root.user.email + ' error parsing WebDNA Response');
              if (!res.headersSent) {
                res.status(503).json({
                  error: 'Service temporarily unavailable'+stdout
                }); 
              }
              
            }
            if (!res.headersSent) {
              if (group_ls_report && error !== null) {
                log('exec error: ' + error, 'user: ' + req.body.root.user.email + ' error calling WebDNA');
                res.status(503).json({
                  error: 'Service temporarily unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'invalid') {
                log(null, 'user: ' + req.body.root.user.email + ' authentication invalid')
                res.status(401).json({
                  error: 'Authentication invalid'
                });
              } else if (group_ls_report && group_ls_report.message == 'Group unavailable') {
                log(null, 'user: ' + req.body.root.user.email + ' group unavailable: ' + req.body.root.group_id)
                res.status(409).json({
                  message: 'Group unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'Group load shift report unavailable') {
                log(null, 'user: ' + req.body.root.user.email + ' load shift report unavailable unavailable for group ' + req.body.root.group_id)
                res.status(409).json({
                  message: 'Group load shift report unavailable'
                });
              } else if (group_ls_report && group_ls_report.message == 'Not Authorized') {
                log(null, 'user: ' + req.body.root.user.email + ' Not authorized for group ' + req.body.root.group_id)
                res.status(409).json({
                  message: 'Not authorized'
                });
              } else if (group_ls_report){
                res.status(201).json({
                  response_format: 'json',
                  message: group_ls_report
                });
              } else if (!res.headersSent){
                log(null, 'user: ' + req.body.root.user.email + ' endpoint down. check logs')
                res.status(503).json({
                  error: 'Service temporarily unavailable'
                });
              }
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
  } else {
    res.status(400).json({
      error: 'Missing group_id'
    });
  }
}

function get_group_load_shift_report_xml(req, res) {
  res.type('application/xml');
  var found = false;
  // if(!projects){ // executed if call is made to server just after server restart, before projects is loaded
  //   res.status(503);
  //   res.send('<error>Service temporarily unavailable</error>');
  // } else 
  if(req.body.root.group){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.group|| !req.body.root.local_start_date || !req.body.root.local_end_date){
      res.status(400)
      res.send('<error>Missing required field(s)</error>');
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group == "object") { //  duplicate passwords, groups, increments
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
    } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 2678400000) {
      res.status(400)
      res.send('<error>End date must be within 31 days of start date</error>');
    } else if (validate_email(req.body.root.user.email) !== 'valid'){
      res.status(400);
      res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
    } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
      res.status(400);
      res.send('<error>Remove all whitespace from body</error>');
    } else if (!String(req.body.root.group).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group))) {
      res.status(400);
      res.send('<error>Invalid group</error>');
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group) {
          // found = true;
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group, req.body.root.local_start_date, req.body.root.local_end_date);
          
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var group_ls_report;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }*/
            try {
              group_ls_report = JSON.parse(stdout);
              //group_ls_report = JSON.parse(decryption);
            } catch (err) {
              if (!res.headersSent) {
                res.status(503);
                res.send('<error>Service temporarily unavailable</error> '+stdout);
              }
            }
            // Input validation
            if (!res.headersSent) {
              if (group_ls_report && error !== null) {
                console.log('exec error: ' + error);
                res.status(503);
                res.send('<error>Service temporarily unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'invalid') {
                res.status(401);
                res.send('<error>Authentication invalid</error>');
              } else if (group_ls_report && group_ls_report.message == 'Group unavailable') {
                res.status(409);
                res.send('<error>Group unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'Group load shift report unavailable') {
                res.status(409);
                res.send('<error>Group load shift report unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'Not Authorized') {
                res.status(409);
                res.send('<error>Not authorized</error>');
              } else if (group_ls_report){
                res.status(201);
                res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',group_ls_report).replace('<?xml version=\'1.0\'?>','') + '</root>');
              } else {
                res.status(503);
                res.send('<error>Service temporarily unavailable</error>');
              }
            }
          });
      //   }
      // }
      // if (!found && !res.headersSent) {
      //   res.status(400);
      //   res.send('<error>Group unavailable</error>');
      // }
    }
  } else if(req.body.root.group_id){
    if (!req.body.root.user.email || !req.body.root.user.password || !req.body.root.group_id|| !req.body.root.local_start_date || !req.body.root.local_end_date){
      res.status(400)
      res.send('<error>Missing required field(s)</error>');
    } else if (typeof req.body.root.user.password == "object" || typeof req.body.root.group_id == "object") { //  duplicate passwords, groups, increments
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
    } else if (new Date(req.body.root.local_end_date) - new Date(req.body.root.local_start_date) > 2678400000) {
      res.status(400)
      res.send('<error>End date must be within 31 days of start date</error>');
    } else if (validate_email(req.body.root.user.email) !== 'valid'){
      res.status(400);
      res.send('<error>' + validate_email(req.body.root.user.email) + '</error>');
    } else if (has_whitespace(req.body.root.user.email) || has_whitespace(req.body.root.user.password)){
      res.status(400);
      res.send('<error>Remove all whitespace from body</error>');
    } else if (!String(req.body.root.group_id).match("^[0-9]+$") || !Number.isInteger(parseInt(req.body.root.group_id))) {
      res.status(400);
      res.send('<error>Invalid group</error>');
    } else {
      // for (var i = 0; i < projects.length; i++) {
      //   if (projects[i].projectID == req.body.root.group_id) {
          // found = true;
          var encryption = encrypt(req.body.root.user.email, req.body.root.user.password, req.body.root.group_id, req.body.root.local_start_date, req.body.root.local_end_date);
          
          exec('sh /var/www/html/api.shiftedenergy.com/scripts/api_call.sh' + " " + encryption,
          function (error, stdout, stderr) {
            var group_ls_report;
            var decryption;
            /*try {
              decryption = decrypt(stdout);
            } catch (err) {
              res.status(503);
              res.send('<error>Service temporarily unavailable</error>');
            }*/
            try {
              group_ls_report = JSON.parse(stdout);
              //group_ls_report = JSON.parse(decryption);
            } catch (err) {
              if (!res.headersSent) {
                res.status(503);
                res.send('<error>Service temporarily unavailable</error> '+stdout);
              }
            }
            // Input validation
            if (!res.headersSent) {
              if (group_ls_report && error !== null) {
                console.log('exec error: ' + error);
                res.status(503);
                res.send('<error>Service temporarily unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'invalid') {
                res.status(401);
                res.send('<error>Authentication invalid</error>');
              } else if (group_ls_report && group_ls_report.message == 'Group unavailable') {
                res.status(409);
                res.send('<error>Group unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'Group load shift report unavailable') {
                res.status(409);
                res.send('<error>Group load shift report unavailable</error>');
              } else if (group_ls_report && group_ls_report.message == 'Not Authorized') {
                res.status(409);
                res.send('<error>Not authorized</error>');
              } else if (group_ls_report){
                res.status(201);
                res.send('<root><response_format>xml</response_format>' + js2xml.parse('message',group_ls_report).replace('<?xml version=\'1.0\'?>','') + '</root>');
              } else {
                res.status(503);
                res.send('<error>Service temporarily unavailable</error>');
              }
            }
          });
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

// POST
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
      //     get_group_load_shift_report_xml(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      get_group_load_shift_report_xml(req, res);
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
      //     get_group_load_shift_report_json(req, res, projects);
      //   } catch (err) {
      //     console.log(err);
      //   }
      // });
      get_group_load_shift_report_json(req, res);
    }
  } else {
    res.status(400).json({
      error: 'Invalid request'
    });
  }
});

module.exports = router;