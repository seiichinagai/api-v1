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
    try {
      fs.readFile('/var/www/html/api.shiftedenergy.com/reference/ag_token_v2.db','utf8',function(token_err,data){
        if(token_err){
          console.log(token_err);
        }
        token = data;

        var command = '/var/www/html/api.shiftedenergy.com/scripts/reset_ag_v2.sh ' + req.body.api_id + ' ' + token;
        // console.log(command);

        exec(command, function(err, stdout){
          console.log(stdout);
          res.status(200).json({
            message: 'reset sent to ag'
          });
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