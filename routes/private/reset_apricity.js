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
const send_command = require('/var/www/html/api.shiftedenergy.com/apricity/send_command').send_command;

router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':'); 
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  if (login == "webDNA" && password == "de0xyr!bonucleic4c!d"){
    console.log(new Date().toISOString())
    try {
      fs.readFile('/var/www/html/api.shiftedenergy.com/apricity/access_token.db','utf8',function(token_err,data){
        if(token_err){
          console.log(token_err);
        }
        const token = (JSON.parse(data)).AuthenticationResult.AccessToken;

        const body = {
          "commands": [
            {
              "type": "reset",
              "devId": req.body.api_id
            }
          ]
        }

        var command = "/var/www/html/api.shiftedenergy.com/apricity/send_v2.sh '" + token + "' '" + JSON.stringify(body) + "'";

        console.log('\n' + JSON.stringify(body));

        exec(command, function(err, stdout){
          console.log(stdout);
          try{
            if(err){
              console.log(err);
            }
            if(stdout.indexOf('Commands accepted for processing.')>=0){
              res.status(200).json({
                message: 'Commands accepted for processing.'
              });
              // sendLogs(req, res, next, true, lim);
            } else {
              console.log('Apricity Response: ' + stdout, 'Ara command request failed. Device unreachable ' + req.body.api_id);
              res.status(400).json({
                message: 'Unable to reach device'
              });
              // sendLogs(req, res, next, false, lim);
              return next();
            }
          } catch (command_err){
            console.log(new Date().toISOString() + '\n' + command_err, 'error sending ara device command ' + req.body);
          }
        })
      })
    } catch (err) {
      console.log(err);
      if(!res.headerSent){
        res.status(500).send(err);
        next();
      }
    }
  } else {
    return next(createError(400, 'Unauthorized'));
  }
});


module.exports = router;