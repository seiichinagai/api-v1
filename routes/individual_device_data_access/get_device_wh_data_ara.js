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
// Encryption may add on a few chars for padding but ignore anything after <>
function encrypt(email, password, api_id) {
  var XMLString = '><method>authorize_client_device</method><email>' + email + 
      "</email><password>" + password + "</password><api_id>" + api_id + "</api_id><>";
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
  if (typeof date != "string") {
    return 'Invalid date format. Dates must be string'
  } else if(date === new Date(date).toISOString()) {
    return 'valid'
  } else {
    return 'Invalid Date';
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

function get_device_telemetry_json(req, res) {
  var reg = /^\d+$/;
  if (validate_email(req.body.user.email) !== 'valid'){
    res.status(400).json({
      error: validate_email(req.body.user.email)
    });
  } else if (typeof req.body.user.password == "object" || typeof req.body.user.api_id == "object") {
    //  duplicate passwords, api_id
    res.status(400).json({
      error: 'Duplicate fields'
    });
  } else if (typeof req.body.user.password != "string") {
    res.status(400).json({
      error: 'Invalid password format'
    });
  } else if (validate_date(req.body.start_date) !== 'valid') {
    res.status(400).json({
      error: "Start date: " + validate_date(req.body.start_date)
    });
  } else if (validate_date(req.body.end_date) !== 'valid') {
    res.status(400).json({
      error: "End date: " + validate_date(req.body.end_date)
    });
  } else if (new Date(req.body.start_date) > new Date(req.body.end_date)) {
    res.status(400).json({
      error: "Start date must precede end date or be the same"
    });
  } else if (new Date(req.body.end_date) - new Date(req.body.start_date) > 345600000) {
    res.status(400).json({
      error: "End date must be within 4 days of start date"
    });
  } else if (new Date(req.body.start_date) - new Date() > 0) {
    res.status(400).json({
      error: "Start date must be historical or current"
    });
  } else if (has_whitespace(req.body.user.email) || has_whitespace(req.body.user.password) || has_whitespace(req.body.api_id)){
    res.status(400).json({
      error: 'Remove all whitespace from body'
    });
  } else if (!String(req.body.api_id).match("^[a-zA-Z0-9_-]+$")) {
    res.status(400).json({
      error: 'Invalid api_id'
    });
  } else if (req.body.granularity && !reg.test(req.body.granularity)){
    res.status(400).json({
      error: 'Invalid granularity'
    });
  } else {
    var login_file_path = '/var/www/html/api.shiftedenergy.com/reference/login.db';
    var read_command = util.format('tail -n100 ' + login_file_path);

    exec(read_command,function(login_read_err,login_data){
      if(login_read_err){console.log(login_read_err)};

      var logged_in = false;
      var lines = login_data.split(/\r?\n/);

      lines.forEach(function(line){
        var splits = line.split('\t');
        if(new Date() - new Date(splits[0]) < 86400000 && req.body.user.email == splits[1] && req.body.api_id == splits[2]){
          logged_in = true;
        }
      });

      if(logged_in){
        // console.log(new Date().toISOString() + ' get_device_wh_data_ara: user ' + req.body.user.email + ' already authorized for device ' + req.body.api_id)
        get_wh_data(req,res);
      } else {
        console.log(new Date().toISOString() + ' get_device_wh_data_ara: authorizing user ' + req.body.user.email + ' for device ' + req.body.api_id)

        var encryption = encrypt(req.body.user.email, req.body.user.password, req.body.api_id, req.body.start_date, req.body.end_date);
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
            // console.log(stdout);
            //response = JSON.parse(decryption);
          } catch (err) {
            if(req.body.user.email != 'andrew.costinett@pnnl.gov'){
              alert_slack(err);
              console.log(stdout);
            }
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          }
          if (response && error !== null) {
            alert_slack('exec error: ' + error);
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          } else if (response && response.message == 'invalid') {
            console.log('WebDNA response: ' + JSON.stringify(response))
            res.status(401).json({
              error: 'Authentication invalid'
            });
          } else if (response && response.error && response.error == 'The ID you provided does not support this command') {
            res.status(409).json({
              message: 'The ID you provided does not support this command'
            });
          } else if (response && response.message == 'Not Authorized') {
            res.status(409).json({
              message: 'Not authorized'
            });
          } else if (!res.headersSent && response){
            var login_string = new Date().toISOString() + '\t' + req.body.user.email + '\t' + req.body.api_id + '\n'

            fs.appendFile(login_file_path, login_string, function(err){
              if(err){console.log(err)}
            })

            get_wh_data(req,res);
          } else if (!res.headersSent) {
            alert_slack('error in WebDNA response');
            console.log(response);
            res.status(503).json({
              error: 'Service temporarily unavailable'
            });
          }
        });
      }
    });
  }
}

function get_wh_data(req,res){
  // get data from AWS, format, return
  var payload = req.body;
  delete payload['user']
  if(!payload.granularity){
    payload['granularity'] = 5;
  } else {
    payload['granularity'] = parseInt(payload['granularity'])
  }
  // console.log(JSON.stringify(payload))
  var command = 'sh /var/www/html/api.shiftedenergy.com/aws/apricity_stats/get_wh_data_ara.sh' + " '" + JSON.stringify(payload) + "'";
  exec(command, function (error, stdout, stderr) {
    if(error){
      console.log(error);
    }
    res.status(201).json(JSON.parse(stdout.replace('result','wh_data')));
  });
}

function alert_slack(string){
  console.log('get_device_wh_data_ara error: ' + string);
  // alert slack
  var json = {
    "text": 'API - get_device_wh_data_ara error: ' + string
  }
  var slack_command = '/var/www/html/api.shiftedenergy.com/scripts/slack_err_alert.sh ' + "'" + JSON.stringify(json) + "'";
  exec(slack_command,function(slackerr,slackresponse){
    if(slackerr){
      console.log(slackerr);
    } else if(slackresponse){
      console.log(new Date().toISOString() + ', ' + string + ', slack response: ' + slackresponse);
    }
  });
}

// POST
router.post('/', (req, res, next) => {
  if(req.header('Content-Type') == 'application/json'){
    if (!req.body || !req.body.user || !req.body.user.email || !req.body.user.password || !req.body.api_id || !req.body.start_date || !req.body.end_date) {
      res.status(400).json({
        error: 'Missing required field(s)'
      });
      if(req.body && req.body.user){
        console.log(new Date().toISOString(), req.body.user.email, req.body.api_id, req.body.start_date, req.body.end_date)
      }
    } else {
        get_device_telemetry_json(req, res);
    }
  } else {
    res.status(401).json({
      error: 'Invalid Content-Type'
    });
  }
  
});

module.exports = router;